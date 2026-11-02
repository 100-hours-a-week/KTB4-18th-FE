import { expect, test } from '@playwright/test';
import { connect } from 'node:net';

const backend = 'http://127.0.0.1:18089';
function checkPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(3000);
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('error', () => reject(new Error('Isolated test dependency unavailable')));
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('Isolated test dependency unavailable'));
    });
  });
}

test.beforeAll(async ({ request }) => {
  if (
    process.env.AUTH_E2E_ISOLATION_CONFIRMED !== 'true' ||
    !process.env.AUTH_E2E_EMAIL ||
    !process.env.AUTH_E2E_PASSWORD
  )
    throw new Error(
      'Isolated test DB/Hazelcast confirmation and dedicated credentials are required',
    );
  await Promise.all([checkPort(13319), checkPort(13320)]);
  const ready = await request.get(`${backend}/api/v1/auth/token/csrf`);
  expect(ready.status()).toBe(200);
});

test('real local direct login, protected HTTP, canonical logout and old token rejection', async ({
  page,
  context,
}) => {
  const responses: Array<{ path: string; status: number }> = [];
  context.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/'))
      responses.push({
        path: url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '{id}'),
        status: response.status(),
      });
  });
  const authCalls: Array<{ method: string; path: string; direct: boolean }> = [];
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/auth/'))
      authCalls.push({
        method: request.method(),
        path: url.pathname,
        direct: request.headers()['x-auth-login-protocol'] === 'direct-v2',
      });
  });
  try {
    await page.goto('/login?returnTo=/my');
    await page.getByLabel('이메일', { exact: true }).fill(process.env.AUTH_E2E_EMAIL!);
    await page.getByLabel('비밀번호', { exact: true }).fill(process.env.AUTH_E2E_PASSWORD!);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:5178/my');
    const credential = await page.evaluateHandle(async () => {
      const modulePath = '/src/features/auth-login/api/authSession.ts';
      const auth = await import(modulePath);
      return { token: auth.getAccessToken() as string | null };
    });
    const protectedStatus = await credential.evaluate(async ({ token }) => {
      if (!token) return 0;
      const response = await fetch('http://127.0.0.1:18089/api/v1/users/me', {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.status;
    });
    expect(protectedStatus).toBe(200);
    const restoredTab = await context.newPage();
    await restoredTab.goto('http://127.0.0.1:5178/login');
    await expect(restoredTab.getByLabel('이메일', { exact: true })).toBeVisible();
    await restoredTab.reload();
    await expect(restoredTab.getByLabel('이메일', { exact: true })).toBeVisible();
    await restoredTab.close();
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    const rejectedStatus = await credential.evaluate(async ({ token }) => {
      if (!token) return 0;
      const response = await fetch('http://127.0.0.1:18089/api/v1/users/me', {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.status;
    });
    await credential.dispose();
    expect([401, 403]).toContain(rejectedStatus);
    expect(authCalls.filter((call) => call.path.includes('queue'))).toHaveLength(0);
    expect(authCalls.filter((call) => call.method === 'POST' && !call.direct)).toHaveLength(0);
    expect(
      authCalls.filter((call) => call.method === 'POST' && call.path.endsWith('/login')),
    ).toHaveLength(1);
    expect(
      authCalls.filter((call) => call.method === 'POST' && call.path.endsWith('/logout')),
    ).toHaveLength(1);
    expect(authCalls.filter((call) => call.path.includes('/token/refresh'))).toHaveLength(0);
    expect(
      authCalls.filter((call) => call.path.endsWith('/flow/current-operation')).length,
    ).toBeGreaterThanOrEqual(3);
    const persisted = await page.evaluate(() => ({
      sessionToken: sessionStorage.getItem('access_token') !== null,
      localToken: localStorage.getItem('access_token') !== null,
      tupleKeys: Object.keys(sessionStorage).filter((key) =>
        key.startsWith('meomuneum:direct-auth-operation:'),
      ),
    }));
    expect(persisted).toEqual({ sessionToken: false, localToken: false, tupleKeys: [] });
    await page.screenshot({ path: test.info().outputPath('direct-login-desktop.png') });
    await page.reload();
    await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
    expect(authCalls.filter((call) => call.path.includes('/token/refresh'))).toHaveLength(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('direct-login-mobile.png') });
  } finally {
    console.info(JSON.stringify({ network: responses }));
    await page
      .evaluate(() => {
        for (const input of document.querySelectorAll<HTMLInputElement>(
          'input[type="email"], input[type="password"]',
        ))
          input.value = '';
      })
      .catch(() => undefined);
  }
});

test('verified restore in a new tab and reload uses fresh operations and keeps logout effective', async ({
  page,
  context,
}) => {
  expect(process.env.AUTH_E2E_REFRESH_VERIFIED).toBe('true');
  const network: Array<{ path: string; status: number }> = [];
  context.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/'))
      network.push({
        path: path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '{id}'),
        status: response.status(),
      });
  });
  let refreshPosts = 0;
  let legacyPosts = 0;
  context.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/v1/auth/') && request.method() === 'POST') {
      if (request.headers()['x-auth-login-protocol'] !== 'direct-v2') legacyPosts += 1;
      if (path.endsWith('/token/refresh')) refreshPosts += 1;
    }
  });
  const protectedStatus = (target = page) =>
    target.evaluate(async () => {
      const modulePath = '/src/features/auth-login/api/authSession.ts';
      const auth = await import(modulePath);
      const response = await auth.authenticatedFetch('http://127.0.0.1:18089/api/v1/users/me');
      return response.status;
    });
  try {
    await page.goto('/login?returnTo=/my');
    await page.getByLabel('이메일', { exact: true }).fill(process.env.AUTH_E2E_EMAIL!);
    await page.getByLabel('비밀번호', { exact: true }).fill(process.env.AUTH_E2E_PASSWORD!);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:5178/my');
    expect(await protectedStatus()).toBe(200);
    const nextTab = await context.newPage();
    await nextTab.goto('http://127.0.0.1:5178/my');
    await expect(nextTab).toHaveURL('http://127.0.0.1:5178/my');
    await expect(nextTab.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
    expect(await protectedStatus(nextTab)).toBe(200);
    await page.reload();
    await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
    await expect(page).toHaveURL('http://127.0.0.1:5178/my');
    expect(await protectedStatus()).toBe(200);
    const credential = await page.evaluateHandle(async () => {
      const modulePath = '/src/features/auth-login/api/authSession.ts';
      return { token: (await import(modulePath)).getAccessToken() as string | null };
    });
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:5178/login');
    const oldStatus = await credential.evaluate(async ({ token }) => {
      if (!token) return 0;
      return (
        await fetch('http://127.0.0.1:18089/api/v1/users/me', {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status;
    });
    await credential.dispose();
    await nextTab.close();
    expect(oldStatus).toBe(401);
    expect(refreshPosts).toBe(2);
    expect(legacyPosts).toBe(0);
  } finally {
    console.info(
      JSON.stringify({
        repeat: test.info().repeatEachIndex,
        verifiedRestoreNetwork: network,
        refreshPosts,
        legacyPosts,
      }),
    );
    await page
      .evaluate(() => {
        for (const input of document.querySelectorAll<HTMLInputElement>(
          'input[type="email"], input[type="password"]',
        ))
          input.value = '';
      })
      .catch(() => undefined);
  }
});
