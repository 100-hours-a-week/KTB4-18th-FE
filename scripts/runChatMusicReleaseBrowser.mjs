import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const config = JSON.parse(await readFile(process.env.CHAT_MUSIC_FE_CONFIG, 'utf8'));
for (const address of [config.taskA, config.taskB]) {
  const url = new URL(address);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
    throw Error('isolated loopback only');
}
process.env.VITE_CHAT_MUSIC_QUEUE_ENABLED = 'true';
process.env.VITE_CHAT_MUSIC_PLAYER_ENABLED = 'true';
process.env.VITE_AUTH_DIRECT_V2_ENABLED = 'false';
process.env.VITE_API_BASE_URL = '';
const output = resolve('node_modules/.tmp/chat-music-release-verification/browser');
await mkdir(output, { recursive: true });
const origin = 'http://localhost:5174';
const server = await createServer({
  configFile: false,
  envDir: false,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^(?:.*\/)?resolveCurrentChatLocation(?:\.ts)?$/,
        replacement: resolve('tests/fixtures/chatMusicReleaseLocation.ts'),
      },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 0,
    hmr: false,
    proxy: {
      '/api': { target: config.taskA, headers: { Origin: origin } },
      '/ws': { target: config.taskB, ws: true, headers: { Origin: origin } },
    },
  },
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
const contexts = [],
  errors = [],
  commands = [];
process.once('SIGTERM', () => {
  void (async () => {
    await browser?.close();
    await server.close();
    process.exit(143);
  })();
});
const wire = { musicEvents: [], queues: [] };
const result = {
  realCore: true,
  twoChatTasks: true,
  distinctAccounts: true,
  gpsAndAuthSessionSynthetic: true,
  youtubeSdkSynthetic: true,
};
async function pageFor(token, location, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  contexts.push(context);
  await context.addInitScript(
    ({ token, location, region }) => {
      window.musicRelease = { token, location, region };
      const calls = [];
      window.releasePlayerCalls = calls;
      class Player {
        constructor(element, options) {
          this.options = options;
          this.state = 5;
          this.position = 0;
          this.at = performance.now();
          const iframe = document.createElement('iframe');
          iframe.title = 'YouTube 검증 대역';
          iframe.srcdoc =
            '<body style="margin:0;background:#182322;color:white;display:grid;place-items:center;height:100vh;font:16px sans-serif">YouTube SDK 검증 대역</body>';
          element.replaceWith(iframe);
          this.iframe = iframe;
          queueMicrotask(() => options.events.onReady({ target: this }));
        }
        loadVideoById(v) {
          calls.push(['load', v]);
          this.position = v.startSeconds;
          this.playVideo();
        }
        cueVideoById(v) {
          calls.push(['cue', v]);
          this.position = v.startSeconds;
          this.state = 5;
        }
        playVideo() {
          this.state = 1;
          this.at = performance.now();
          this.options.events.onStateChange({ data: 1 });
        }
        pauseVideo() {
          this.position = this.getCurrentTime();
          this.state = 2;
          this.options.events.onStateChange({ data: 2 });
        }
        stopVideo() {
          this.state = 0;
        }
        getCurrentTime() {
          return this.position + (this.state === 1 ? (performance.now() - this.at) / 1000 : 0);
        }
        getPlayerState() {
          return this.state;
        }
        seekTo(v) {
          this.position = v;
          this.at = performance.now();
          calls.push(['seek', v]);
        }
        setVolume(v) {
          calls.push(['volume', v]);
        }
        mute() {
          calls.push(['mute']);
        }
        unMute() {
          calls.push(['unmute']);
        }
        destroy() {
          this.iframe.remove();
        }
      }
      window.YT = { Player };
    },
    { token, location, region: config.region },
  );
  const page = await context.newPage();
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') return;
      for (const frame of payload.split('\0')) {
        const at = frame.indexOf('\n\n');
        if (at < 0) continue;
        try {
          const value = JSON.parse(frame.slice(at + 2));
          if (
            ['QUEUE_UPDATED', 'PLAYBACK_UPDATED', 'PLAYBACK_SYNC'].includes(value.type) &&
            wire.musicEvents.length < 100
          )
            wire.musicEvents.push(value);
        } catch {
          /* Heartbeats and non-JSON protocol frames are not music data. */
        }
      }
    }),
  );
  page.on('response', async (response) => {
    if (
      response.request().method() !== 'GET' ||
      !new URL(response.url()).pathname.endsWith('/queue-items') ||
      !response.ok()
    )
      return;
    try {
      if (wire.queues.length < 20) wire.queues.push(await response.json());
    } catch {
      /* Context may already be closing. */
    }
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/playback/commands')) commands.push(JSON.parse(request.postData()));
  });
  await page.route('**/api/v1/auth/flow', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'synthetic auth boundary', data: { flow: 'legacy' } }),
    }),
  );
  await page.goto(base + '/tests/fixtures/chatMusicRelease.html');
  await expect(page.getByRole('textbox', { name: '메시지' })).toBeEnabled({ timeout: 20000 });
  return page;
}
const player = (page) => page.getByRole('region', { name: '공동 음악 재생' });
async function add(page, n) {
  const input = page.getByRole('textbox', { name: '메시지' });
  await input.fill(`/신청 synthetic song ${n}`);
  await input.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: `synthetic song ${n} 신청`, exact: true })
    .click({ timeout: 10000 });
  await expect(dialog.getByText('곡 신청을 확인했어요.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '음악 창 닫기' }).click();
}
async function leave(page) {
  const exit = page.getByRole('button', { name: '퇴장', exact: true });
  await exit.focus();
  await exit.press('Enter');
  await expect(page.getByRole('button', { name: /음악 신청/ })).toHaveCount(0);
}
try {
  browser = await chromium.launch({
    channel: process.env.CHAT_BROWSER_CHANNEL ?? 'chrome',
    headless: true,
  });
  const a = await pageFor(config.token, config.location, 390);
  const b = await pageFor(config.secondToken, config.secondLocation, 1280);
  await add(a, 1);
  for (const page of [a, b]) {
    await expect(player(page).getByText('synthetic song 1', { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(player(page).getByRole('button', { name: '전체 일시정지' })).toBeEnabled();
  }
  await add(a, 2);
  await expect(b.getByRole('button', { name: '대기열 1', exact: true })).toBeVisible({
    timeout: 10000,
  });
  await player(b).getByRole('button', { name: '전체 일시정지' }).click();
  for (const page of [a, b])
    await expect(player(page).getByText('방에서 일시정지', { exact: true })).toBeVisible({
      timeout: 10000,
    });
  const c = await pageFor(config.secondToken, config.secondLocation, 320);
  await expect(player(c).getByText('방에서 일시정지', { exact: true })).toBeVisible();
  await expect
    .poll(() => c.evaluate(() => window.releasePlayerCalls.filter((x) => x[0] === 'cue').length))
    .toBeGreaterThan(0);
  expect(
    await c.evaluate(() => window.releasePlayerCalls.filter((x) => x[0] === 'load').length),
  ).toBe(0);
  result.latePausedJoin = true;
  await b.getByRole('button', { name: /^대기열/ }).click();
  const dialog = b.getByRole('dialog');
  await dialog.getByRole('button', { name: 'synthetic song 2 신청 취소', exact: true }).click();
  await expect(dialog.getByText('대기 중인 곡이 없어요.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: '음악 창 닫기' }).click();
  result.cancelOtherAccount = true;
  await add(a, 3);
  await add(a, 4);
  await expect(b.getByRole('button', { name: '대기열 2', exact: true })).toBeVisible({
    timeout: 10000,
  });
  await player(b).getByRole('button', { name: '다음 곡으로' }).click();
  for (const page of [a, b, c]) {
    await expect(player(page).getByText('synthetic song 3', { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(player(page).getByText('방에서 재생 중', { exact: true })).toBeVisible();
  }
  const before = commands.length;
  await player(a).getByRole('slider', { name: '내 음량' }).fill('12');
  await player(a).getByRole('button', { name: '내 음소거' }).click();
  await expect(player(b).getByRole('slider', { name: '내 음량' })).toHaveValue('70');
  await expect(player(b).getByRole('button', { name: '내 음소거' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(commands).toHaveLength(before);
  result.localVolumeIsolated = true;
  const composer = a.getByRole('textbox', { name: '메시지' });
  await composer.fill('함께 듣는 통합 검증');
  await composer.press('Enter');
  for (const page of [b, c])
    await expect(
      page.getByRole('log').getByText('함께 듣는 통합 검증', { exact: true }),
    ).toBeVisible({ timeout: 10000 });
  result.chatWhilePlaying = true;
  for (const [page, name] of [
    [a, 'mobile'],
    [b, 'desktop'],
    [c, 'narrow'],
  ])
    await page.screenshot({ path: resolve(output, `${name}.png`) });
  await leave(c);
  await leave(a);
  await expect(player(b).getByText('synthetic song 3', { exact: true })).toBeVisible();
  await leave(b);
  await a.goto(base + '/tests/fixtures/chatMusicRelease.html');
  await expect(a.getByRole('textbox', { name: '메시지' })).toBeEnabled({ timeout: 20000 });
  await expect(player(a).getByText('방에서 대기 중', { exact: true })).toBeVisible();
  await a.getByRole('button', { name: /^대기열/ }).click();
  await expect(
    a.getByRole('dialog').getByText('대기 중인 곡이 없어요.', { exact: false }),
  ).toBeVisible();
  expect(await a.locator('.chat-room-youtube iframe').count()).toBe(0);
  result.lastLeaveCleared = true;
  expect(commands.map((c) => c.action)).toEqual(['PAUSE', 'SKIP']);
  expect(errors).toEqual([]);
  result.commands = commands.map((c) => c.action);
  result.passed = true;
  await writeFile(resolve(output, 'wire-examples.json'), JSON.stringify(wire, null, 2) + '\n');
  await writeFile(config.evidence, JSON.stringify(result, null, 2) + '\n');
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  await writeFile(
    resolve(output, 'failure.json'),
    JSON.stringify({ error: String(error), pageErrors: errors }, null, 2) + '\n',
  );
  for (let i = 0; i < contexts.length; i++)
    for (const page of contexts[i].pages())
      await page.screenshot({ path: resolve(output, `failure-${i}.png`) }).catch(() => {});
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser?.close();
  await server.close();
}
