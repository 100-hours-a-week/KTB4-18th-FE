import { expect, test, type Page, type BrowserContext } from '@playwright/test';
const base = 'http://127.0.0.1:5178';
const backend = 'http://127.0.0.1:18089';
test.beforeAll(async ({ request }) => {
  if (
    process.env.AUTH_E2E_ISOLATION_CONFIRMED !== 'true' ||
    process.env.AUTH_E2E_REFRESH_VERIFIED !== 'true' ||
    !process.env.AUTH_E2E_EMAIL ||
    !process.env.AUTH_E2E_PASSWORD
  )
    throw new Error('Verified isolated continuity environment required');
  expect((await request.get(`${backend}/api/v1/auth/token/csrf`)).status()).toBe(200);
});
function observe(context: BrowserContext) {
  const posts: string[] = [];
  const responses: Array<{ path: string; status: number }> = [];
  context.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/v1/auth/'))
      posts.push(new URL(request.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '{id}'));
  });
  context.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/'))
      responses.push({
        path: path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '{id}'),
        status: response.status(),
      });
  });
  return {
    posts,
    responses,
    refreshes: () => posts.filter((path) => path.endsWith('/token/refresh')).length,
  };
}
async function login(page: Page) {
  await page.goto('/login?returnTo=/my');
  await page.getByLabel('이메일', { exact: true }).fill(process.env.AUTH_E2E_EMAIL!);
  await page.getByLabel('비밀번호', { exact: true }).fill(process.env.AUTH_E2E_PASSWORD!);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await ready(page);
}
async function ready(page: Page) {
  await expect(page).toHaveURL(`${base}/my`);
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        try {
          const path = '/src/features/auth-login/api/authSession.ts';
          return (
            await (await import(path)).authenticatedFetch('http://127.0.0.1:18089/api/v1/users/me')
          ).status;
        } catch {
          return 0;
        }
      }),
    )
    .toBe(200);
}
async function logout(page: Page) {
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page).toHaveURL(`${base}/login`);
}
async function clean(page: Page) {
  await page
    .evaluate(() => {
      for (const input of document.querySelectorAll<HTMLInputElement>(
        'input[type="email"],input[type="password"]',
      ))
        input.value = '';
    })
    .catch(() => undefined);
}

test('both tabs keep protected access through refresh in both directions', async ({
  page,
  context,
}) => {
  const network = observe(context);
  try {
    await login(page);
    const peer = await context.newPage();
    await peer.goto(`${base}/my`);
    await ready(peer);
    await ready(page);
    await peer.reload();
    await ready(peer);
    await ready(page);
    await page.reload();
    await ready(page);
    await ready(peer);
    expect(network.refreshes()).toBe(3);
    await logout(page);
    await expect(peer).toHaveURL(/\/login(?:\?|$)/);
    expect(network.refreshes()).toBe(3);
    await peer.close();
  } finally {
    console.info(
      JSON.stringify({
        scenario: 'two-way-tabs',
        posts: network.posts,
        responses: network.responses,
      }),
    );
    await clean(page);
  }
});

test('focus fallback reconciles login and logout without BroadcastChannel', async ({
  page,
  context,
}) => {
  const network = observe(context);
  await context.addInitScript(() =>
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined, configurable: true }),
  );
  try {
    await page.goto('/login?returnTo=/my');
    const peer = await context.newPage();
    await peer.goto(`${base}/login?returnTo=/my`);
    await page.getByLabel('이메일', { exact: true }).fill(process.env.AUTH_E2E_EMAIL!);
    await page.getByLabel('비밀번호', { exact: true }).fill(process.env.AUTH_E2E_PASSWORD!);
    const delay = await context.newCDPSession(page);
    let heldId = '';
    let heldResolve!: () => void;
    const held = new Promise<void>((resolve) => {
      heldResolve = resolve;
    });
    delay.on('Fetch.requestPaused', async (event) => {
      if (!heldId) {
        heldId = event.requestId;
        heldResolve();
      } else await delay.send('Fetch.continueResponse', { requestId: event.requestId });
    });
    await delay.send('Fetch.enable', {
      patterns: [
        { urlPattern: `${backend}/api/v1/auth/flow/current-operation`, requestStage: 'Response' },
      ],
    });
    try {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await held;
      expect(
        await page.evaluate(
          ({ email, password }) =>
            (document.getElementById('email') as HTMLInputElement)?.value === email &&
            (document.getElementById('password') as HTMLInputElement)?.value === password,
          { email: process.env.AUTH_E2E_EMAIL!, password: process.env.AUTH_E2E_PASSWORD! },
        ),
      ).toBe(true);
      expect(await page.getByRole('button', { name: '로그인', exact: true }).isEnabled()).toBe(
        true,
      );
    } finally {
      if (heldId) await delay.send('Fetch.continueResponse', { requestId: heldId });
      await delay.send('Fetch.disable');
      await delay.detach();
    }

    await page.evaluate(() => {
      for (const name of ['focus', 'pageshow', 'online']) window.dispatchEvent(new Event(name));
    });
    expect(
      await page.evaluate(
        ({ email, password }) =>
          (document.getElementById('email') as HTMLInputElement)?.value === email &&
          (document.getElementById('password') as HTMLInputElement)?.value === password,
        { email: process.env.AUTH_E2E_EMAIL!, password: process.env.AUTH_E2E_PASSWORD! },
      ),
    ).toBe(true);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await ready(page);
    await peer.bringToFront();
    await peer.evaluate(() => window.dispatchEvent(new Event('focus')));
    await ready(peer);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await ready(page);
    expect(network.refreshes()).toBe(1);
    await logout(peer);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    expect(network.refreshes()).toBe(1);
    await peer.close();
  } finally {
    console.info(
      JSON.stringify({
        scenario: 'focus-without-channel',
        posts: network.posts,
        responses: network.responses,
      }),
    );
    await clean(page);
  }
});

test('slow initial canonical confirmation keeps an empty screen and the protected URL', async ({
  page,
  context,
}) => {
  const network = observe(context);
  try {
    await login(page);
    const peer = await context.newPage();
    const client = await context.newCDPSession(peer);
    let requestId = '';
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    client.on('Fetch.requestPaused', async (event) => {
      if (!requestId && event.responseStatusCode === 200) {
        requestId = event.requestId;
        release();
      } else await client.send('Fetch.continueResponse', { requestId: event.requestId });
    });
    await client.send('Fetch.enable', {
      patterns: [
        { urlPattern: `${backend}/api/v1/auth/flow/current-operation`, requestStage: 'Response' },
      ],
    });
    try {
      await peer.goto(`${base}/my`, { waitUntil: 'domcontentloaded' });
      await held;
      await expect(peer).toHaveURL(`${base}/my`);
      expect(await peer.locator('#root').textContent()).toBe('');
      expect(await peer.getByLabel('이메일', { exact: true }).count()).toBe(0);
      expect(network.refreshes()).toBe(0);
      await client.send('Fetch.continueResponse', { requestId });
      await client.send('Fetch.disable');
      await client.detach();
      await ready(peer);
      await ready(page);
      expect(network.refreshes()).toBe(1);
      await logout(peer);
    } finally {
      await client.send('Fetch.disable').catch(() => undefined);
      await client.detach().catch(() => undefined);
      await peer.close();
    }
  } finally {
    console.info(
      JSON.stringify({
        scenario: 'slow-initial-read',
        posts: network.posts,
        responses: network.responses,
      }),
    );
    await clean(page);
  }
});

test('client memory TTL expiry renews twice on distinct canonical generations', async ({
  page,
  context,
}) => {
  const network = observe(context);
  try {
    await login(page);
    for (let count = 1; count <= 2; count += 1) {
      expect(
        await page.evaluate(async () => {
          const path = '/src/features/auth-login/api/directAuthSessionState.ts';
          const state = await import(path);
          const token = state.getDirectAccessToken();
          const flow = state.directAuthFlow();
          return token && flow
            ? state.installDirectSession(state.directAuthVersion(), token, '1', flow)
            : false;
        }),
      ).toBe(true);
      await expect.poll(network.refreshes).toBe(count);
      await ready(page);
    }
    expect(network.posts.filter((path) => path.endsWith('/login'))).toHaveLength(1);
    await logout(page);
  } finally {
    console.info(
      JSON.stringify({
        scenario: 'client-ttl',
        posts: network.posts,
        responses: network.responses,
      }),
    );
    await clean(page);
  }
});
