import { test, expect, type Page, type Browser } from '@playwright/test';
import type { ChatRoomMembership } from '../../src/api/chatRooms';

function observe(page: Page) {
  const joins: ChatRoomMembership[] = [];
  const departures: string[] = [];
  const connectedViews: string[] = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', (frame) => {
      const text = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString();
      if (text.startsWith('CONNECT\n')) {
        const view = text
          .split('\n')
          .find((line) => line.startsWith('view_session_id:'))
          ?.slice(16);
        if (view) connectedViews.push(view);
      }
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
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && request.url().includes('/members/me?')) {
      departures.push(new URL(request.url()).searchParams.get('view_session_id') ?? '');
    }
  });
  return { joins, departures, connectedViews };
}
async function ready(page: Page) {
  await expect(page.getByLabel('메시지', { exact: true })).toBeEnabled();
}
async function send(page: Page, content: string) {
  // The real server accepts at most one message per account per second.
  await page.waitForTimeout(1100);
  await page.getByLabel('메시지', { exact: true }).fill(content);
  await page.getByRole('button', { name: '전송', exact: true }).click();
  const message = page
    .getByRole('log')
    .getByRole('article')
    .filter({ has: page.getByText(content, { exact: true }) });
  await expect(message.getByText('전송 완료', { exact: true })).toBeVisible();
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
async function revoked(page: Page, membership: ChatRoomMembership) {
  const result = await page.evaluate((member) => window.__chatTabE2E.probe(member), membership);
  expect(result).toEqual({ historyStatus: 403, closeCode: 4103 });
}
async function observer(browser: Browser, baseURL: string) {
  const context = await browser.newContext({
    baseURL,
    permissions: ['geolocation'],
    geolocation: { latitude: 37.3595704, longitude: 127.105399, accuracy: 10 },
  });
  const page = await context.newPage();
  await page.goto('/chat?actor=observer');
  await ready(page);
  return {
    page,
    close: async () => {
      await leave(page);
      await context.close();
    },
  };
}

test.afterEach(async ({ context }) => {
  // Explicit navigation completes the per-tab DELETE before the test context is disposed.
  for (const page of context.pages()) {
    if (page.isClosed()) continue;
    if (await page.getByLabel('메시지', { exact: true }).count()) {
      await leave(page);
    }
  }
});

test('메뉴 이동은 해당 탭만 종료하고 같은 sid 재입장에서 부재 메시지를 제외한다', async ({
  page,
  context,
}) => {
  const first = observe(page);
  const secondPage = await context.newPage();
  const second = observe(secondPage);
  await page.goto('/chat');
  await secondPage.goto('/chat');
  await ready(page);
  await ready(secondPage);
  await expect.poll(() => first.joins.length).toBe(1);
  await expect.poll(() => second.joins.length).toBe(1);
  expect(first.joins[0].membershipId).toBe(second.joins[0].membershipId);
  expect(first.joins[0].viewSessionId).not.toBe(second.joins[0].viewSessionId);
  await expect(secondPage.getByLabel('현재 접속 인원')).toHaveText('1 / 25명');
  const seen = `함께 본 대화 ${test.info().project.name}`;
  await send(secondPage, seen);
  await expect(page.getByRole('log').getByText(seen, { exact: true })).toBeVisible();
  await leave(page);
  expect(first.departures).toEqual([first.joins[0].viewSessionId]);
  await revoked(secondPage, first.joins[0]);
  await expect(secondPage.getByLabel('현재 접속 인원')).toHaveText('1 / 25명');
  const absent = `퇴장 중 대화 ${test.info().project.name}`;
  await send(secondPage, absent);
  await page.getByRole('button', { name: '채팅 탭', exact: true }).click();
  await ready(page);
  await expect.poll(() => first.joins.length).toBe(2);
  expect(first.joins[1].viewSessionId).not.toBe(first.joins[0].viewSessionId);
  await expect(page.getByRole('log').getByText(seen, { exact: true })).toBeVisible();
  await expect(page.getByRole('log').getByText(absent, { exact: true })).toHaveCount(0);
  await send(page, `재입장 후 전송 ${test.info().project.name}`);
});

test('마지막 탭 퇴장 때 계정 인원이 줄고 다른 계정은 계속 전송한다', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const watcher = await observer(browser, baseURL!);
  try {
    const second = await context.newPage();
    await page.goto('/chat');
    await second.goto('/chat');
    await ready(page);
    await ready(second);
    await expect(watcher.page.getByLabel('현재 접속 인원')).toHaveText('2 / 25명');
    await leave(page);
    await expect(watcher.page.getByLabel('현재 접속 인원')).toHaveText('2 / 25명');
    await leave(second);
    await expect(watcher.page.getByLabel('현재 접속 인원')).toHaveText('1 / 25명');
    await send(watcher.page, `마지막 탭 퇴장 후 ${test.info().project.name}`);
  } finally {
    await watcher.close();
  }
});

test('실제 탭 닫기 후에도 남은 탭의 채팅과 계정 인원을 유지한다', async ({ page, context }) => {
  const first = observe(page);
  const second = await context.newPage();
  await page.goto('/chat');
  await second.goto('/chat');
  await ready(page);
  await ready(second);
  await expect.poll(() => first.joins.length).toBe(1);
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => page.isClosed()).toBe(true);
  await expect(second.getByLabel('현재 접속 인원')).toHaveText('1 / 25명');
  await send(second, `탭 닫기 후 전송 ${test.info().project.name}`);
});

test('새로고침은 새 view로 입장하고 남은 탭을 유지한다', async ({ page, context }) => {
  const first = observe(page);
  const second = await context.newPage();
  await page.goto('/chat');
  await second.goto('/chat');
  await ready(page);
  await ready(second);
  await expect.poll(() => first.joins.length).toBe(1);
  const previous = first.joins[0];
  await page.reload();
  await ready(page);
  await expect.poll(() => first.joins.length).toBe(2);
  expect(first.joins[1].viewSessionId).not.toBe(previous.viewSessionId);
  // Unload keepalive delivery is best effort. Only confirmed DELETE promises view revocation.
  await expect(second.getByLabel('현재 접속 인원')).toHaveText('1 / 25명');
  const cached = await page.evaluate(() =>
    sessionStorage.getItem('meomuneum:chat-conversations:v1'),
  );
  expect(cached ?? '').not.toContain(previous.viewSessionId);
  await test.info().attach('reload-boundary', {
    body: JSON.stringify({
      departureObserved: first.departures.includes(previous.viewSessionId),
      newViewAllocated: first.joins[1].viewSessionId !== previous.viewSessionId,
    }),
    contentType: 'application/json',
  });
  await send(second, `새로고침 후 전송 ${test.info().project.name}`);
  await expect(
    page
      .getByRole('log')
      .getByText(`새로고침 후 전송 ${test.info().project.name}`, { exact: true }),
  ).toBeVisible();
});

test('입장 응답 대기 중 메뉴 이탈은 늦은 view만 정리한다', async ({ page, context }) => {
  const second = await context.newPage();
  await second.goto('/chat');
  await ready(second);
  let held!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    held = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = observe(page);
  await page.route('**/api/v1/chat-rooms/*/members', async (route) => {
    const response = await route.fetch();
    held();
    await released;
    await route.fulfill({ response });
  });
  try {
    await page.goto('/chat');
    await waiting;
    await page.getByRole('button', { name: '지도 탭', exact: true }).click();
    release();
    await expect.poll(() => first.joins.length).toBe(1);
    await expect.poll(() => first.departures).toEqual([first.joins[0].viewSessionId]);
    await revoked(second, first.joins[0]);
    await expect(page.getByRole('heading', { name: '지도 화면' })).toBeVisible();
    await send(second, `지연된 입장 정리 후 ${test.info().project.name}`);
  } finally {
    release();
  }
});

test('한 탭의 짧은 단절 중 다른 탭이 나가도 같은 view의 누락 복구를 유지한다', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const watcher = await observer(browser, baseURL!);
  try {
    const first = observe(page);
    const second = await context.newPage();
    await page.goto('/chat');
    await second.goto('/chat');
    await ready(page);
    await ready(second);
    await expect.poll(() => first.joins.length).toBe(1);
    await page.evaluate(() => window.__chatTabE2E.disconnect());
    await expect(page.getByLabel('메시지', { exact: true })).toBeDisabled();
    await leave(second);
    const missing = `짧은 단절 중 대화 ${test.info().project.name}`;
    await send(watcher.page, missing);
    await page.evaluate(() => window.__chatTabE2E.resume());
    await ready(page);
    expect(first.joins).toHaveLength(1);
    expect(first.departures).toHaveLength(0);
    expect(first.connectedViews.length).toBeGreaterThanOrEqual(2);
    expect(new Set(first.connectedViews)).toEqual(new Set([first.joins[0].viewSessionId]));
    await expect(page.getByRole('log').getByText(missing, { exact: true })).toHaveCount(1);
    await send(page, `복구 후 전송 ${test.info().project.name}`);
  } finally {
    await watcher.close();
  }
});
