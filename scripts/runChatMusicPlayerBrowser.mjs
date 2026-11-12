import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
process.env.VITE_CHAT_MUSIC_QUEUE_ENABLED = 'true';
process.env.VITE_CHAT_MUSIC_PLAYER_ENABLED = 'true';
process.env.VITE_AUTH_DIRECT_V2_ENABLED = 'false';
process.env.VITE_API_BASE_URL = '';
process.env.VITE_API_PROXY_TARGET = 'http://127.0.0.1:1';
const isSyncSuite = process.argv.includes('--sync');
const output = resolve(
  `/tmp/meomuneum-music-browser/${isSyncSuite ? 'chat-music-sync' : 'chat-music-player'}-verification/browser`,
);
await mkdir(output, { recursive: true });
const server = await createServer({
  cacheDir: `/tmp/meomuneum-${process.pid}-vite-cache`,
  server: { host: '127.0.0.1', port: 0, hmr: false },
  clearScreen: false,
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
const results = [];
const item = (id = 99) => ({
  queue_item_id: id,
  music_id: id,
  sequence_no: id,
  added_by_user_id: 8,
  status: 'PLAYING',
  title: '함께 걷는 노래',
  artist_name: '동네의 음악가',
  album_cover_url: null,
  youtube_video_id: 'abcdefghijk',
});
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.env.CHAT_BROWSER_CHANNEL ?? 'chrome',
  });
  if (process.argv.includes('--live')) {
    await probeYouTube(browser, base, output);
  }
  for (const viewport of process.argv.includes('--live')
    ? []
    : [
        { width: 390, height: 844 },
        { width: 1280, height: 900 },
        { width: 320, height: 568 },
      ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const calls = [];
      let instance;
      let shouldBlock = true;
      class Player {
        constructor(element, options) {
          this.options = options;
          this.state = 2;
          this.position = 0;
          this.at = performance.now();
          const iframe = document.createElement('iframe');
          iframe.title = 'YouTube 음악 영상';
          iframe.srcdoc =
            '<html lang="ko"><body style="margin:0;display:grid;place-items:center;height:100vh;background:#182322;color:#fff;font:16px sans-serif">YouTube 플레이어 검증 대역</body></html>';
          element.replaceWith(iframe);
          this.iframe = iframe;
          instance = this;
          queueMicrotask(() => options.events.onReady({ target: this }));
        }
        loadVideoById(video) {
          calls.push(['load', video]);
          this.position = video.startSeconds;
          this.at = performance.now();
          if (shouldBlock) {
            shouldBlock = false;
            this.state = 2;
            this.options.events.onAutoplayBlocked();
          } else this.playVideo();
        }
        cueVideoById(video) {
          calls.push(['cue', video]);
          this.position = video.startSeconds;
          this.state = 5;
        }
        playVideo() {
          calls.push(['play']);
          this.at = performance.now();
          this.state = 1;
          this.options.events.onStateChange({ data: 1 });
        }
        pauseVideo() {
          calls.push(['pause']);
          this.position = this.getCurrentTime();
          this.state = 2;
          this.options.events.onStateChange({ data: 2 });
        }
        stopVideo() {
          calls.push(['stop']);
          this.state = 0;
        }
        seekTo(value) {
          calls.push(['seek', value]);
          this.position = value;
          this.at = performance.now();
        }
        getCurrentTime() {
          return this.position + (this.state === 1 ? (performance.now() - this.at) / 1000 : 0);
        }
        getPlayerState() {
          return this.state;
        }
        setVolume(value) {
          calls.push(['volume', value]);
        }
        mute() {
          calls.push(['mute']);
        }
        unMute() {
          calls.push(['unmute']);
        }
        destroy() {
          calls.push(['destroy']);
          this.iframe.remove();
        }
      }
      window.YT = { Player };
      window.ytFixture = {
        calls,
        drift: () => {
          instance.position = 0;
          instance.at = performance.now();
        },
        error: (code) => instance.options.events.onError({ data: code }),
        ended: () => instance.options.events.onStateChange({ data: 0 }),
      };
    });
    let version = 1,
      state = 'PLAYING',
      current = item(),
      position = 0;
    let clock = '2026-11-09T05:00:05Z';
    let failQueueReads = 0;
    const commands = [];
    const snapshot = () => ({
      version,
      state,
      current,
      current_queue_item_id: current?.queue_item_id ?? null,
      source_video_id: current ? 'abcdefghijk' : null,
      duration_millis: current ? 120000 : null,
      position_seconds: position,
      state_changed_at: '2026-11-09T05:00:00Z',
      server_time: clock,
    });
    const hint = async () =>
      page.evaluate((payload) => window.musicFixture.event(payload), {
        type: 'PLAYBACK_SYNC',
        data: {
          room_id: 700,
          epoch: 1,
          version,
          event_id: null,
          event_version: null,
          queue_refresh_required: true,
          playback: snapshot(),
        },
      });
    await page.route('**/api/v1/auth/flow', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'synthetic', data: { flow: 'legacy' } }),
      }),
    );
    await page.route('**/api/v1/chat-rooms/700/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (failQueueReads > 0 && request.method() === 'GET' && path.endsWith('/queue-items')) {
        failQueueReads--;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'synthetic fault', data: { code: 'CHAT_UNAVAILABLE' } }),
        });
        return;
      }
      let data;
      if (path.endsWith('/playback/commands')) {
        const command = JSON.parse(request.postData());
        commands.push(command);
        expect(command.expected_version).toBe(version);
        expect(command.queue_item_id).toBe(current?.queue_item_id ?? null);
        expect(request.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
        version++;
        if (command.action === 'PAUSE') {
          state = 'PAUSED';
          position = 5;
        } else if (command.action === 'RESUME') state = 'PLAYING';
        else if (command.action === 'SKIP') {
          state = 'IDLE';
          current = null;
          position = 0;
        }
        data = snapshot();
        await hint();
      } else data = { ...snapshot(), items: [], next_cursor: null };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'synthetic', data }),
      });
    });
    try {
      await page.goto(base + '/tests/fixtures/chatMusic.html');
      await expect(page.getByRole('textbox', { name: '메시지' })).toBeVisible();
      await page.getByRole('button', { name: '음악 플레이어 열기' }).click();
      const region = page.getByRole('region', { name: '공동 음악 재생' });
      await expect(region.getByRole('button', { name: '브라우저 재생 허용' })).toBeVisible();
      expect(commands).toHaveLength(0);
      await region.getByRole('button', { name: '브라우저 재생 허용' }).click();
      await expect(region.getByRole('status').first()).toContainText('내 기기에서 재생 중');
      const video = page.getByTitle('YouTube 음악 영상');
      const box = await video.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(200);
      expect(box.height).toBeGreaterThanOrEqual(200);
      await region.getByRole('slider', { name: '내 음량' }).fill('25');
      await region.getByRole('button', { name: '내 음소거' }).click();
      await expect(region.getByRole('button', { name: '내 음소거' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(commands).toHaveLength(0);
      const iframeNode = await video.elementHandle();
      const beforeUiCalls = await page.evaluate(
        () =>
          window.ytFixture.calls.filter((call) =>
            ['load', 'cue', 'play', 'pause', 'destroy'].includes(call[0]),
          ).length,
      );
      expect(
        await page.locator('.chat-room-artwork').evaluate((el) => {
          const box = el.getBoundingClientRect();
          return [
            [2, 2],
            [box.width / 2, box.height / 2],
            [box.width - 2, box.height - 2],
          ].every(([x, y]) => el.contains(document.elementFromPoint(box.left + x, box.top + y)));
        }),
      ).toBe(true);
      await page.getByRole('button', { name: '음악 창 닫기' }).click();
      await expect(page.getByRole('textbox', { name: '메시지' })).toBeVisible();
      await page.getByRole('button', { name: '음악 플레이어 열기' }).click();
      await page.getByRole('button', { name: '＋ 음악 신청' }).click();
      await page.getByRole('button', { name: '대기열', exact: true }).click();
      await page.getByRole('button', { name: '플레이어', exact: true }).click();
      expect(
        await iframeNode.evaluate(
          (node) => node === document.querySelector('.chat-room-youtube iframe'),
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () =>
            window.ytFixture.calls.filter((call) =>
              ['load', 'cue', 'play', 'pause', 'destroy'].includes(call[0]),
            ).length,
        ),
      ).toBe(beforeUiCalls);
      await expect(region.getByRole('slider', { name: '내 음량' })).toHaveValue('25');
      await expect(region.getByRole('button', { name: '내 음소거' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(commands).toHaveLength(0);
      await page.evaluate(() => window.ytFixture.drift());
      clock = '2026-11-09T05:00:20Z';
      await hint();
      await expect
        .poll(
          () =>
            page.evaluate(() => window.ytFixture.calls.filter((c) => c[0] === 'seek').at(-1)?.[1]),
          { timeout: 10000 },
        )
        .toBeGreaterThanOrEqual(20);
      await writeFile(
        resolve(output, `layout-playing-${viewport.width}.json`),
        JSON.stringify(
          await page.evaluate(() => ({
            scrollY,
            viewport: { height: visualViewport.height, top: visualViewport.offsetTop },
            elements: [
              ...document.querySelectorAll(
                '.chat-entry-screen,.chat-entry-shell,.chat-entry-header,.chat-music,.chat-room-player,.region-chat-composer',
              ),
            ].map((el) => ({
              name: el.className,
              box: el.getBoundingClientRect().toJSON(),
              scrollTop: el.scrollTop,
            })),
          })),
          null,
          2,
        ),
      );
      await expect(page.getByRole('heading', { name: '음악 신청' })).toBeVisible();
      await page.screenshot({ path: resolve(output, `playing-${viewport.width}.png`) });
      await region.getByRole('button', { name: '전체 일시정지' }).click();
      await expect(region.getByRole('button', { name: '전체 재개' })).toBeVisible();
      await expect(region.getByRole('button', { name: '전체 재개' })).toBeEnabled({
        timeout: 3000,
      });
      await region.getByRole('button', { name: '전체 재개' }).click();
      await expect(region.getByRole('button', { name: '전체 일시정지' })).toBeVisible();
      await page.evaluate(() => window.ytFixture.error(150));
      await expect(region.getByRole('alert')).toContainText('재생할 수 없어요');
      const count = commands.length;
      await page.evaluate(() => window.ytFixture.ended());
      expect(commands).toHaveLength(count);
      await expect(region.getByRole('button', { name: '다음 곡으로' })).toBeEnabled({
        timeout: 3000,
      });
      await region.getByRole('button', { name: '다음 곡으로' }).click();
      await expect(region.getByRole('button', { name: '전체 재생' })).toBeVisible();
      expect(commands.map((c) => c.action)).toEqual(['PAUSE', 'RESUME', 'SKIP']);
      if (isSyncSuite && viewport.width === 390) {
        current = item();
        state = 'PAUSED';
        version++;
        failQueueReads = 2;
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await expect(
          page
            .getByRole('dialog')
            .getByText('음악 상태를 확인하지 못했어요. 잠시 후 다시 확인해요.', { exact: true }),
        ).toBeVisible();
        await expect(page.getByTitle('YouTube 음악 영상')).toHaveCount(0);
        await expect(region.getByRole('button', { name: '전체 재생' })).toBeDisabled();
        await expect(region.getByRole('button', { name: '전체 재개' })).toBeVisible({
          timeout: 10000,
        });
        await expect(region.getByRole('button', { name: '내 음소거' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(region.getByRole('slider', { name: '내 음량' })).toHaveValue('25');
        state = 'PLAYING';
        version++; // Drop all music events: the watchdog must read this state.
        await expect(region.getByRole('button', { name: '전체 일시정지' })).toBeVisible({
          timeout: 20000,
        });
        await page.screenshot({ path: resolve(output, 'recovered.png') });
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));
        await expect(page.getByTitle('YouTube 음악 영상')).toHaveCount(0);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect(region.getByRole('button', { name: '전체 일시정지' })).toBeVisible();
        expect(commands.map((c) => c.action)).toEqual(['PAUSE', 'RESUME', 'SKIP']);
      }
      await page.evaluate(() => window.musicFixture.connection(false));
      await expect(page.getByTitle('YouTube 음악 영상')).toHaveCount(0);
      await expect(region.getByRole('button', { name: '전체 재생' })).toBeDisabled();
      await page.getByRole('button', { name: '음악 창 닫기' }).click();
      await expect(page.getByRole('textbox', { name: '메시지' })).toBeVisible();
      await page.setViewportSize({ width: viewport.width, height: 300 });
      const composer = page.getByRole('textbox', { name: '메시지' });
      await expect
        .poll(async () => {
          const b = await composer.boundingBox();
          return b.y + b.height;
        })
        .toBeLessThanOrEqual(300);
      expect(await composer.boundingBox()).toMatchObject({ width: expect.any(Number) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(errors).toEqual([]);
      results.push({
        viewport,
        passed: true,
        min200Player: true,
        syncCorrected: true,
        localVolumeNoCommand: true,
        autoplayGesture: true,
        sharedCommands: true,
        noEndedCommand: true,
        disconnectDestroyed: true,
        recoveryScenario: isSyncSuite && viewport.width === 390,
      });
    } catch (error) {
      await page.screenshot({ path: resolve(output, `failure-${viewport.width}.png`) });
      await writeFile(
        resolve(output, 'failure-layout.json'),
        JSON.stringify(
          await page.evaluate(() =>
            [
              ...document.querySelectorAll(
                '.chat-entry-screen,.chat-entry-shell,.chat-music,.chat-room-player,.region-chat-panel,.region-chat-composer,textarea',
              ),
            ].map((el) => ({
              name: el.className,
              box: el.getBoundingClientRect().toJSON(),
              height: getComputedStyle(el).height,
              maxHeight: getComputedStyle(el).maxHeight,
              viewport: visualViewport.height,
              custom: getComputedStyle(el).getPropertyValue('--chat-entry-viewport-height'),
            })),
          ),
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  if (!process.argv.includes('--live'))
    await writeFile(
      resolve(output, 'results.json'),
      JSON.stringify(
        { transport: 'synthetic HTTP and YT SDK; real React/Chrome', results },
        null,
        2,
      ) + '\n',
    );
} finally {
  await browser?.close();
  await server.close();
}

// Live SDK smoke check uses YouTube's public API demonstration video, never a catalog seed.
async function probeYouTube(browser, base, output) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [],
    failedRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => {
    if (/youtube|googlevideo|ytimg/.test(new URL(request.url()).hostname))
      failedRequests.push({
        host: new URL(request.url()).hostname,
        error: request.failure()?.errorText,
      });
  });
  await page.route('**/api/v1/**', async (route) => {
    const videoId = 'M7lc1UVf-VE';
    const current = {
      ...item(),
      youtube_video_id: videoId,
      title: 'YouTube 공식 API 데모 (검증 전용)',
    };
    const data = route.request().url().includes('chat-rooms')
      ? {
          version: 1,
          state: 'PLAYING',
          current,
          current_queue_item_id: 99,
          source_video_id: videoId,
          duration_millis: 120000,
          position_seconds: 0,
          state_changed_at: '2026-11-09T05:00:00Z',
          server_time: '2026-11-09T05:00:01Z',
          items: [],
          next_cursor: null,
        }
      : { flow: 'legacy' };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'synthetic', data }),
    });
  });
  try {
    await page.goto(base + '/tests/fixtures/chatMusic.html');
    await page.getByRole('button', { name: '음악 플레이어 열기' }).click();
    const region = page.getByRole('region', { name: '공동 음악 재생' });
    await expect(region).toBeVisible();
    await expect
      .poll(async () => region.innerText(), { timeout: 40000 })
      .toMatch(/내 기기에서 재생 중|자동재생 차단|재생 오류/);
    const allow = region.getByRole('button', { name: '브라우저 재생 허용' });
    const wasBlocked = await allow.isVisible();
    if (wasBlocked) {
      await allow.click();
      await expect
        .poll(async () => region.innerText(), { timeout: 20000 })
        .toMatch(/내 기기에서 재생 중|재생 오류/);
    }
    const text = await region.innerText();
    const sdkLoaded = await page.evaluate(() => !!window.YT?.Player);
    const iframeCount = await page.locator('.chat-room-youtube iframe').count();
    await page.screenshot({ path: resolve(output, 'live-youtube.png') });
    await writeFile(
      resolve(output, 'live-youtube.json'),
      JSON.stringify(
        {
          sdkLoaded,
          iframeCount,
          autoplayWasBlocked: wasBlocked,
          playingObserved: text.includes('내 기기에서 재생 중'),
          visibleStatus: text,
          errors,
          failedRequests,
          fixture:
            'synthetic room snapshot; actual YouTube SDK/embed; official API demo video only',
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await context.close();
  }
}
