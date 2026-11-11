import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Only this isolated entry uses legacy synthetic token storage and a mocked HTTP transport.
process.env.VITE_CHAT_MUSIC_QUEUE_ENABLED = 'true';
process.env.VITE_AUTH_DIRECT_V2_ENABLED = 'false';
process.env.VITE_API_BASE_URL = '';
process.env.VITE_API_PROXY_TARGET = 'http://127.0.0.1:1';
const output = resolve('node_modules/.tmp/chat-music-video-request-verification/browser');
await mkdir(output, { recursive: true });
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, hmr: false },
  clearScreen: false,
});
await server.listen();
const address = server.httpServer.address();
const base = `http://127.0.0.1:${address.port}`;
let browser;
const results = [];
const item = (id, status = 'WAITING') => ({
  queue_item_id: id,
  music_id: id,
  sequence_no: id,
  added_by_user_id: 8,
  status,
  title: id === 1 ? '긴 제목도 보기 편하게 표시되는 이웃의 신청곡' : '함께 걷는 노래 ' + id,
  artist_name: '동네의 음악가',
  album_cover_url: null,
  youtube_video_id: 'abcdefghijk',
});
const song = (id) => ({
  music_id: id,
  title: '함께 걷는 노래 ' + id,
  artist_name: '동네의 음악가',
  album_cover_url: null,
  youtube_video_id: null,
  duration_millis: null,
  is_queueable: false,
  sources: ['RECORDED', 'RECOMMENDED'],
});
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.env.CHAT_BROWSER_CHANNEL ?? 'chrome',
  });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
    { width: 320, height: 568 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let version = 1,
      items = [item(1)],
      lost = false;
    const writes = [];
    const bodies = [];
    let videoSearches = 0;
    await page.route('**/api/v1/auth/flow', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'synthetic', data: { flow: 'legacy' } }),
      }),
    );
    await page.route('**/api/v1/chat-rooms/700/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.searchParams.get('membership_id') !== '900') throw Error('missing member');
      if (!request.headers().authorization?.startsWith('Bearer '))
        throw Error('missing owner token');
      const respond = (data, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'synthetic', data }),
        });
      if (url.pathname.endsWith('/requestable-music')) {
        const query = url.searchParams.get('query');
        const offset = Number(url.searchParams.get('cursor') ?? 0);
        return respond({
          items:
            query === '없음'
              ? []
              : Array.from({ length: Math.min(20, 44 - offset) }, (_, i) => song(offset + i + 1)),
          next_cursor: query === '없음' || offset + 20 >= 44 ? null : String(offset + 20),
        });
      }
      if (url.pathname.endsWith('/video-searches')) {
        videoSearches++;
        const id = Number(url.pathname.match(/music\/(\d+)\/video-searches/)[1]);
        const expires = new Date(Date.now() + 3600000).toISOString();
        return respond({
          search_id: '550e8400-e29b-41d4-a716-446655440050',
          music_id: id,
          result_kind: 'READY',
          expires_at: expires,
          items: [1, 2].map((index) => ({
            candidate_id: `550e8400-e29b-41d4-a716-44665544005${index}`,
            music_id: id,
            video_id: index === 1 ? 'abcdefghijk' : 'ABCDEFGHIJK',
            title: `선택 영상 ${index}`,
            channel_id: 'channel',
            channel_title: '이웃의 음악 채널',
            thumbnail_url: null,
            duration_millis: 120000,
            playback_status: 'PLAYABLE',
            official_status: index === 1 ? 'UNREVIEWED' : 'CONFIRMED',
            expires_at: expires,
          })),
        });
      }
      if (request.method() === 'POST') {
        bodies.push(request.postData());
        writes.push(request.headers()['idempotency-key']);
        if (!lost) {
          lost = true;
          version++;
          return route.abort('failed');
        }
        return respond(
          {
            queue_item_id: 2,
            music_id: JSON.parse(request.postData()).music_id,
            sequence_no: 2,
            status: 'WAITING',
            version,
          },
          201,
        );
      }
      if (request.method() === 'DELETE') {
        items = [];
        version++;
        return route.fulfill({ status: 204 });
      }
      return respond({
        items,
        next_cursor: null,
        version,
        state: 'PLAYING',
        current: item(99, 'PLAYING'),
        position_seconds: 0,
        state_changed_at: '2026-11-09T05:00:00Z',
        server_time: '2026-11-09T05:00:01Z',
      });
    });
    try {
      await page.goto(base + '/tests/fixtures/chatMusic.html');
      await expect(page.getByRole('button', { name: /음악 신청/ })).toBeVisible();
      const composer = page.getByRole('textbox', { name: '메시지' });
      await composer.fill('/신청');
      await composer.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      if (viewport.width > 480) {
        const box = await dialog.boundingBox();
        await writeFile(
          resolve(output, `bounds-${viewport.width}.json`),
          JSON.stringify(
            await page.evaluate(() => {
              const el = document.querySelector('dialog'),
                app = el.closest('.chat-entry-shell'),
                css = getComputedStyle(el);
              return {
                dialog: el.getBoundingClientRect().toJSON(),
                app: app.getBoundingClientRect().toJSON(),
                css: {
                  left: css.left,
                  top: css.top,
                  width: css.width,
                  margin: css.margin,
                  transform: css.transform,
                  position: css.position,
                },
                inline: el.getAttribute('style'),
              };
            }),
            null,
            2,
          ),
        );
        const appBox = await page.locator('.chat-entry-shell').boundingBox();
        expect(Math.abs(box.x + box.width / 2 - appBox.x - appBox.width / 2)).toBeLessThan(2);
      }
      await expect(dialog.getByRole('searchbox')).not.toBeFocused();
      await expect(
        dialog.getByRole('button', { name: '함께 걷는 노래 1 영상 선택', exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: resolve(output, `search-${viewport.width}.png`) });
      expect(videoSearches).toBe(0);
      const list = dialog.getByLabel('지역 음악 목록', { exact: true });
      await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await expect(
        dialog.getByRole('button', { name: '함께 걷는 노래 21 영상 선택', exact: true }),
      ).toBeAttached();
      await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
      const choose = dialog.getByRole('button', {
        name: '함께 걷는 노래 44 영상 선택',
        exact: true,
      });
      await expect(choose).toBeAttached();
      await choose.scrollIntoViewIfNeeded();
      const scroll = await list.evaluate((el) => el.scrollTop);
      await choose.click();
      await expect(
        dialog.getByRole('button', { name: '선택 영상 1 영상 신청', exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: resolve(output, `videos-${viewport.width}.png`) });
      await dialog.getByRole('button', { name: '← 지역 음악', exact: true }).click();
      await expect(choose).toBeFocused();
      expect(Math.abs((await list.evaluate((el) => el.scrollTop)) - scroll)).toBeLessThan(2);
      await choose.click();
      await dialog.getByRole('button', { name: '선택 영상 1 영상 신청', exact: true }).click();
      await dialog.getByRole('button', { name: '신청 결과 다시 확인' }).click();
      await expect(dialog.getByText('곡 신청을 확인했어요.', { exact: true })).toBeVisible();
      expect(writes).toHaveLength(2);
      expect(writes[0]).toBe(writes[1]);
      expect(bodies[0]).toBe(bodies[1]);
      expect(JSON.parse(bodies[0])).toMatchObject({
        music_id: 44,
        candidate_id: '550e8400-e29b-41d4-a716-446655440051',
      });
      expect(await page.evaluate(() => window.musicFixture.sent)).toEqual([]);
      await dialog.getByRole('button', { name: '대기열', exact: true }).click();
      const cancel = dialog.getByRole('button', {
        name: '긴 제목도 보기 편하게 표시되는 이웃의 신청곡 신청 취소',
      });
      await expect(cancel).toBeEnabled({ timeout: 3000 });
      await page.screenshot({ path: resolve(output, `queue-${viewport.width}.png`) });
      await cancel.click();
      await expect(dialog.getByText('대기 중인 곡이 없어요.', { exact: false })).toBeVisible();
      await page.evaluate(() => window.musicFixture.connection(false));
      await expect(
        dialog.getByText('연결을 확인하고 있어요. 연결 후 다시 이용해 주세요.'),
      ).toBeVisible();
      await page.evaluate(() => window.musicFixture.connection(true));
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(composer).toBeFocused();
      await page.getByRole('button', { name: /음악 신청/ }).click();
      await dialog.getByRole('searchbox').fill('없음');
      await expect(
        dialog.getByText('검색 결과가 없어요. 다른 제목이나 가수로 찾아보세요.'),
      ).toBeVisible();
      const bounds = await dialog.boundingBox();
      const app = await page.locator('.chat-entry-shell').boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(app.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(app.x + app.width + 1);
      // Synthetic visual viewport shrink/pan exercises the same event path as a soft keyboard.
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 300 });
        Object.defineProperty(window.visualViewport, 'offsetTop', {
          configurable: true,
          value: 60,
        });
        window.visualViewport.dispatchEvent(new Event('resize'));
      });
      const keyboardBox = await dialog.boundingBox();
      expect(keyboardBox.y).toBeGreaterThanOrEqual(60);
      expect(keyboardBox.y + keyboardBox.height).toBeLessThanOrEqual(360);
      await page.screenshot({ path: resolve(output, `keyboard-${viewport.width}.png`) });
      await page.keyboard.press('Tab');
      const focusInside = await page.evaluate(() =>
        document.querySelector('dialog').contains(document.activeElement),
      );
      expect(focusInside).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(errors).toEqual([]);
      results.push({
        viewport,
        passed: true,
        unknownResultSameUuid: true,
        commandNotSent: true,
        cancelNeighbor: true,
        nativeDialogFocus: true,
        reconnectDisabled: true,
        noHorizontalOverflow: true,
        nullVideoList: true,
        automatic44Songs: true,
        selectedCandidateSameUuid: true,
        appAndKeyboardBounds: true,
        backRestoresFocusAndScroll: true,
      });
    } finally {
      await context.close();
    }
  }
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      { transport: 'mock HTTP; real React/Chromium/auth session fetch', results },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser?.close();
  await server.close();
}
