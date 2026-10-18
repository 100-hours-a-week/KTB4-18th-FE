import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { ChatRoomMembership } from '../../src/api/chatRooms';

interface Device {
  page: Page;
  joins: ChatRoomMembership[];
  connectedViews: string[];
  identity: { sub: string; sid: string };
}
type OpenDevice = (options?: { observer?: boolean; wait?: boolean }) => Promise<Device>;
const test = base.extend<{ openDevice: OpenDevice }>({
  openDevice: async ({ browser, baseURL, viewport, isMobile, hasTouch }, runDevices) => {
    const contexts: BrowserContext[] = [];
    await runDevices(async (options = {}) => {
      const context = await browser.newContext({
        baseURL,
        viewport,
        isMobile,
        hasTouch,
        permissions: ['geolocation'],
        geolocation: { latitude: 37.3595704, longitude: 127.105399, accuracy: 10 },
      });
      contexts.push(context);
      const page = await context.newPage();
      const joins: ChatRoomMembership[] = [];
      const connectedViews: string[] = [];
      page.on('websocket', (socket) =>
        socket.on('framesent', (frame) => {
          const text = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString();
          if (!text.startsWith('CONNECT\n')) return;
          const view = text
            .split('\n')
            .find((line) => line.startsWith('view_session_id:'))
            ?.slice(16);
          if (view) connectedViews.push(view);
        }),
      );
      page.on('response', async (response) => {
        if (
          response.request().method() !== 'POST' ||
          !response.url().endsWith('/members') ||
          !response.ok()
        )
          return;
        const { data } = await response.json();
        joins.push({
          membershipId: data.membership_id,
          roomId: data.room_id,
          regionId: data.region_id,
          joinedAt: data.joined_at,
          viewSessionId: data.view_session_id,
        });
      });
      const actor = options.observer ? 'observer' : `device-${randomUUID()}`;
      await page.goto(`/?actor=${actor}`);
      expect(
        await page.evaluate(() => sessionStorage.getItem('meomuneum:chat-conversations:v1')),
      ).toBeNull();
      const identity = await page.evaluate(async (actor) => {
        const { token } = await (await fetch(`/__chat-e2e/config?actor=${actor}`)).json();
        const { sub, sid } = JSON.parse(
          atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
        );
        return { sub, sid } as { sub: string; sid: string };
      }, actor);
      const device = { page, joins, connectedViews, identity };
      if (options.wait !== false) await enter(device);
      return device;
    });
    try {
      for (const context of contexts) {
        for (const page of context.pages()) {
          if (!page.isClosed() && (await page.getByLabel('메시지', { exact: true }).count()))
            await leave(page);
        }
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
});

const input = (page: Page) => page.getByLabel('메시지', { exact: true });
const message = (page: Page, content: string) =>
  page.getByRole('log').getByText(content, { exact: true });
const unique = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;
async function ready(page: Page) {
  await expect(input(page)).toBeEnabled();
}
async function enter(device: Device) {
  const count = device.joins.length;
  await device.page.getByRole('button', { name: '채팅 탭', exact: true }).click();
  await ready(device.page);
  await expect.poll(() => device.joins.length).toBe(count + 1);
}
async function leave(page: Page) {
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' && response.url().includes('/members/me?'),
  );
  await page.getByRole('button', { name: '지도 탭', exact: true }).click();
  expect((await response).status()).toBe(204);
  await expect(page.getByRole('heading', { name: '지도 화면' })).toBeVisible();
}
async function send(page: Page, content: string) {
  await page.waitForTimeout(1100); // Actual server rate limit is per account.
  await input(page).fill(content);
  await page.getByRole('button', { name: '전송', exact: true }).click();
  await expect(
    page
      .getByRole('article')
      .filter({ has: page.getByText(content, { exact: true }) })
      .getByText('전송 완료', { exact: true }),
  ).toBeVisible();
}
function distinctSessions(first: Device, second: Device) {
  expect(first.identity.sub).toBe(second.identity.sub);
  expect(first.identity.sid).not.toBe(second.identity.sid);
  expect(first.joins[0].membershipId).not.toBe(second.joins[0].membershipId);
  expect(first.joins[0].viewSessionId).not.toBe(second.joins[0].viewSessionId);
}

test('빈 저장소의 다른 기기는 계정 이력을 복원하고 다른 계정에는 공개하지 않는다', async ({
  openDevice,
}) => {
  const first = await openDevice();
  const past = unique('기기 A 참여 대화');
  await send(first.page, past);
  const second = await openDevice();
  distinctSessions(first, second);
  await expect(message(second.page, past)).toHaveCount(1);
  await expect(second.page.getByLabel('현재 접속 인원')).toHaveText('1 / 25명');
  const observer = await openDevice({ observer: true });
  expect(observer.identity.sub).not.toBe(first.identity.sub);
  await expect(message(observer.page, past)).toHaveCount(0);
  const live = unique('기기 B 실시간 대화');
  await send(second.page, live);
  await expect(message(first.page, live)).toHaveCount(1);
  await expect(message(observer.page, live)).toHaveCount(1);
});

test('한 기기 퇴장 중 다른 기기의 참여 이력은 복원하고 모든 기기 부재 대화는 제외한다', async ({
  openDevice,
}) => {
  const observer = await openDevice({ observer: true });
  const first = await openDevice();
  const second = await openDevice();
  distinctSessions(first, second);
  await leave(first.page);
  const participated = unique('기기 B만 참여한 대화');
  await send(second.page, participated);
  await enter(first);
  await expect(message(first.page, participated)).toHaveCount(1);
  await leave(first.page);
  await leave(second.page);
  await expect(observer.page.getByLabel('현재 접속 인원')).toHaveText('1 / 25명');
  const absent = unique('모든 기기 부재 대화');
  await send(observer.page, absent);
  const fresh = await openDevice();
  expect(fresh.identity.sid).not.toBe(first.identity.sid);
  await expect(message(fresh.page, participated)).toHaveCount(1);
  await expect(message(fresh.page, absent)).toHaveCount(0);
  await expect(observer.page.getByLabel('현재 접속 인원')).toHaveText('2 / 25명');
  await send(fresh.page, unique('새 인증 세션 전송'));
});

test('한 기기 단절 중 다른 기기는 전송을 유지하고 재연결 누락 메시지는 한 번만 복구한다', async ({
  openDevice,
}) => {
  const first = await openDevice();
  const second = await openDevice();
  distinctSessions(first, second);
  const view = first.joins[0].viewSessionId;
  await first.page.evaluate(() => window.__chatTabE2E.disconnect());
  await expect(input(first.page)).toBeDisabled();
  const missing = unique('다른 기기에서 보낸 누락 대화');
  await send(second.page, missing);
  await first.page.evaluate(() => window.__chatTabE2E.resume());
  await ready(first.page);
  expect(first.joins).toHaveLength(1);
  expect(first.joins[0].viewSessionId).toBe(view);
  expect(first.connectedViews.length).toBeGreaterThanOrEqual(2);
  expect(new Set(first.connectedViews)).toEqual(new Set([view]));
  await expect(message(first.page, missing)).toHaveCount(1);
  await expect(message(second.page, missing)).toHaveCount(1);
  const resumed = unique('복구된 기기에서 전송');
  await send(first.page, resumed);
  await expect(message(second.page, resumed)).toHaveCount(1);
});

test('서버 이력 응답 대기 중 수신한 실시간 메시지를 이력과 중복 없이 병합한다', async ({
  openDevice,
}) => {
  const first = await openDevice();
  const past = unique('응답 전 과거 대화');
  await send(first.page, past);
  const second = await openDevice({ wait: false });
  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await second.page.route('**/messages?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('mode') !== 'history')
      return route.continue();
    const response = await route.fetch();
    captured();
    await released;
    await route.fulfill({ response });
  });
  try {
    await second.page.getByRole('button', { name: '채팅 탭', exact: true }).click();
    await held;
    await expect(input(second.page)).toBeDisabled();
    const live = unique('이력 대기 중 실시간 대화');
    await send(first.page, live);
    release();
    await ready(second.page);
    await expect(message(second.page, past)).toHaveCount(1);
    await expect(message(second.page, live)).toHaveCount(1);
    await second.page.unrouteAll({ behavior: 'wait' });
    await leave(second.page);
    await enter(second);
    await expect(message(second.page, past)).toHaveCount(1);
    await expect(message(second.page, live)).toHaveCount(1);
  } finally {
    release();
  }
});

test('다른 기기 이력 조회 실패 시 전송을 막고 수동 재시도 후 복원한다', async ({ openDevice }) => {
  const first = await openDevice();
  const past = unique('재시도로 복원할 대화');
  await send(first.page, past);
  const second = await openDevice({ wait: false });
  let failed = false;
  await second.page.route('**/messages?**', async (route) => {
    if (!failed && new URL(route.request().url()).searchParams.get('mode') === 'history') {
      failed = true;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"test unavailable"}',
      });
    }
    return route.continue();
  });
  await second.page.getByRole('button', { name: '채팅 탭', exact: true }).click();
  const retry = second.page.getByRole('button', { name: '복구 다시 시도', exact: true });
  await expect(retry).toBeVisible();
  await expect(input(second.page)).toBeDisabled();
  await expect(message(second.page, past)).toHaveCount(0);
  await retry.focus();
  await second.page.keyboard.press('Enter');
  await ready(second.page);
  expect(failed).toBe(true);
  await expect(message(second.page, past)).toHaveCount(1);
  await send(second.page, unique('수동 복원 후 전송'));
});

test('복원 응답보다 먼저 퇴장하면 늦은 응답으로 대화 화면을 되살리지 않는다', async ({
  openDevice,
}) => {
  const first = await openDevice();
  const past = unique('늦은 응답의 대화');
  await send(first.page, past);
  const second = await openDevice({ wait: false });
  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await second.page.route('**/messages?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('mode') !== 'history')
      return route.continue();
    const response = await route.fetch();
    captured();
    await released;
    await route.fulfill({ response });
  });
  try {
    await second.page.getByRole('button', { name: '채팅 탭', exact: true }).click();
    await held;
    await leave(second.page);
    release();
    await second.page.unrouteAll({ behavior: 'wait' });
    await expect(second.page.getByRole('heading', { name: '지도 화면' })).toBeVisible();
    await expect(second.page.getByRole('log')).toHaveCount(0);
    await send(first.page, unique('다른 기기는 계속 전송'));
    await enter(second);
    await expect(message(second.page, past)).toHaveCount(1);
  } finally {
    release();
  }
});
