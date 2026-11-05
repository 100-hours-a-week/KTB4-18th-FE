import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { connect } from 'node:net';
const backend = 'http://127.0.0.1:18089';
const frontend = 'http://127.0.0.1:5178';
function checkPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(3000);
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('error', () => reject(new Error('Isolated dependency unavailable')));
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('Isolated dependency unavailable'));
    });
  });
}
test.beforeAll(async ({ request }) => {
  for (const key of [
    'AUTH_E2E_ISOLATION_CONFIRMED',
    'AUTH_E2E_REFRESH_VERIFIED',
    'AUTH_E2E_SOURCE_RECOVERY_VERIFIED',
    'AUTH_E2E_REBOOTSTRAP_VERIFIED',
  ])
    if (process.env[key] !== 'true')
      throw new Error('Explicit coordinator-approved local recovery gates required');
  if (!process.env.AUTH_E2E_EMAIL || !process.env.AUTH_E2E_PASSWORD)
    throw new Error('Dedicated credentials required');
  await Promise.all([checkPort(13319), checkPort(13320)]);
  expect((await request.get(`${backend}/api/v1/auth/token/csrf`)).status()).toBe(200);
});

async function loseResponse(page: Page, path: string, beforeLoss?: () => Promise<void>) {
  const client = await page.context().newCDPSession(page);
  let done = false;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const lost = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  client.on('Fetch.requestPaused', async (event) => {
    try {
      if (!done && event.request.method === 'POST' && event.responseStatusCode === 200) {
        done = true;
        await beforeLoss?.();
        await client.send('Fetch.failRequest', {
          requestId: event.requestId,
          errorReason: 'Aborted',
        });
        resolve();
      } else await client.send('Fetch.continueResponse', { requestId: event.requestId });
    } catch {
      reject(new Error('Real response loss injection failed'));
    }
  });
  await client.send('Fetch.enable', {
    patterns: [{ urlPattern: `${backend}${path}`, requestStage: 'Response' }],
  });
  return {
    lost,
    stop: async () => {
      await client.send('Fetch.disable');
      await client.detach();
    },
  };
}
function observe(context: BrowserContext) {
  const calls: Array<{ method: string; path: string; direct: boolean }> = [];
  const responses: Array<{ path: string; status: number }> = [];
  const safe = (value: string) =>
    new URL(value).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '{id}');
  context.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/auth/'))
      calls.push({
        method: request.method(),
        path: safe(request.url()),
        direct: request.headers()['x-auth-login-protocol'] === 'direct-v2',
      });
  });
  context.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/api/'))
      responses.push({ path: safe(response.url()), status: response.status() });
  });
  return {
    calls,
    responses,
    posts: (path: string) => calls.filter((x) => x.method === 'POST' && x.path === path).length,
  };
}
async function submitLogin(page: Page) {
  await page.getByLabel('이메일', { exact: true }).fill(process.env.AUTH_E2E_EMAIL!);
  await page.getByLabel('비밀번호', { exact: true }).fill(process.env.AUTH_E2E_PASSWORD!);
  await page.evaluate(() => {
    for (const name of ['focus', 'pageshow', 'online']) window.dispatchEvent(new Event(name));
    document.dispatchEvent(new Event('visibilitychange'));
    const peer = new BroadcastChannel('meomuneum:direct-auth');
    peer.postMessage({ type: 'changed' });
    peer.close();
  });
  await settled(page);
  await assertInputs(page);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
}
async function settled(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = '/src/features/auth-login/api/directAuthSessionState.ts';
        return (await import(path)).getDirectAuthChecking();
      }),
    )
    .toBe(false);
}
async function assertInputs(page: Page) {
  expect(
    await page.evaluate(
      ({ email, password }) =>
        (document.getElementById('email') as HTMLInputElement)?.value === email &&
        (document.getElementById('password') as HTMLInputElement)?.value === password,
      { email: process.env.AUTH_E2E_EMAIL!, password: process.env.AUTH_E2E_PASSWORD! },
    ),
  ).toBe(true);
}
async function assertProtected(page: Page) {
  const status = await page.evaluate(async () => {
    const modulePath = '/src/features/auth-login/api/authSession.ts';
    return (
      await (await import(modulePath)).authenticatedFetch('http://127.0.0.1:18089/api/v1/users/me')
    ).status;
  });
  expect(status).toBe(200);
}
async function logoutAndCheck(page: Page) {
  const credential = await page.evaluateHandle(async () => {
    const modulePath = '/src/features/auth-login/api/authSession.ts';
    return { token: (await import(modulePath)).getAccessToken() as string | null };
  });
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page).toHaveURL(`${frontend}/login`);
  const status = await credential.evaluate(async ({ token }) =>
    token
      ? (
          await fetch('http://127.0.0.1:18089/api/v1/users/me', {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
          })
        ).status
      : 0,
  );
  await credential.dispose();
  expect(status).toBe(401);
  expect(
    await page.evaluate(
      () =>
        Object.keys(sessionStorage).filter((key) =>
          key.startsWith('meomuneum:direct-auth-operation:'),
        ).length,
    ),
  ).toBe(0);
}
async function eraseInputs(page: Page) {
  await page
    .evaluate(() => {
      for (const input of document.querySelectorAll<HTMLInputElement>(
        'input[type="email"], input[type="password"]',
      ))
        input.value = '';
    })
    .catch(() => undefined);
}

test('real LOGIN body and flow-proof loss requires explicit rebootstrap and original LOGIN recovery', async ({
  page,
  context,
}) => {
  const network = observe(context);
  try {
    await page.goto('/login?returnTo=/my');
    const fault = await loseResponse(page, '/api/v1/auth/login', async () => {
      await page.evaluate(() => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      await settled(page);
      await assertInputs(page);
      expect(await page.locator('#password').isDisabled()).toBe(true);
    });
    try {
      await submitLogin(page);
      await fault.lost;
    } finally {
      await fault.stop();
    }
    await context.clearCookies({ name: /^MEO_AUTH_FLOW_V2_/ });
    const check = page.getByRole('button', { name: '상태 확인', exact: true });
    await expect(check).toBeEnabled();
    expect(network.posts('/api/v1/auth/login')).toBe(1);
    expect(network.posts('/api/v1/auth/login/operations/{id}/session-recovery')).toBe(0);
    await check.click();
    await page.getByRole('button', { name: '인증 상태 다시 준비', exact: true }).click();
    await expect(check).toBeEnabled();
    await check.click();
    await page.getByRole('button', { name: '세션 복구', exact: true }).click();
    await expect(page).toHaveURL(`${frontend}/my`);
    await assertProtected(page);
    expect(network.posts('/api/v1/auth/login')).toBe(1);
    expect(network.posts('/api/v1/auth/flow/rebootstrap')).toBe(1);
    expect(network.posts('/api/v1/auth/login/operations/{id}/session-recovery')).toBe(1);
    expect(network.posts('/api/v1/auth/token/refresh')).toBe(0);
    await logoutAndCheck(page);
    expect(network.calls.filter((x) => x.method === 'POST' && !x.direct)).toHaveLength(0);
  } finally {
    console.info(
      JSON.stringify({ scenario: 'login-body-and-flow-proof-loss', responses: network.responses }),
    );
    await eraseInputs(page);
  }
});

test('real REFRESH response loss requires a separate explicit source recovery operation', async ({
  page,
  context,
}) => {
  const network = observe(context);
  try {
    await page.goto('/login?returnTo=/my');
    await submitLogin(page);
    await expect(page).toHaveURL(`${frontend}/my`);
    await assertProtected(page);
    const fault = await loseResponse(page, '/api/v1/auth/token/refresh');
    try {
      await page.reload();
      await fault.lost;
    } finally {
      await fault.stop();
    }
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    const check = page.getByRole('button', { name: '상태 확인', exact: true });
    await expect(check).toBeEnabled();
    expect(network.posts('/api/v1/auth/token/refresh')).toBe(1);
    expect(network.posts('/api/v1/auth/token/refresh/operations/{id}/session-recovery')).toBe(0);
    await check.click();
    await page.getByRole('button', { name: '세션 복구', exact: true }).click();
    await expect(page).toHaveURL(`${frontend}/my`);
    await assertProtected(page);
    expect(network.posts('/api/v1/auth/token/refresh')).toBe(1);
    expect(network.posts('/api/v1/auth/token/refresh/operations/{id}/session-recovery')).toBe(1);
    await logoutAndCheck(page);
    expect(network.calls.filter((x) => x.method === 'POST' && !x.direct)).toHaveLength(0);
  } finally {
    console.info(
      JSON.stringify({ scenario: 'refresh-response-loss', responses: network.responses }),
    );
    await eraseInputs(page);
  }
});

test('real LOGIN body loss uses explicit original-ID recovery without rebootstrap', async ({
  page,
  context,
}) => {
  const network = observe(context);
  try {
    await page.goto('/login?returnTo=/my');
    const fault = await loseResponse(page, '/api/v1/auth/login');
    try {
      await submitLogin(page);
      await fault.lost;
    } finally {
      await fault.stop();
    }
    const check = page.getByRole('button', { name: '상태 확인', exact: true });
    await expect(check).toBeEnabled();
    expect(network.posts('/api/v1/auth/login/operations/{id}/session-recovery')).toBe(0);
    await check.click();
    await page.getByRole('button', { name: '세션 복구', exact: true }).click();
    await expect(page).toHaveURL(`${frontend}/my`);
    await assertProtected(page);
    expect(network.posts('/api/v1/auth/login')).toBe(1);
    expect(network.posts('/api/v1/auth/login/operations/{id}/session-recovery')).toBe(1);
    expect(network.posts('/api/v1/auth/flow/rebootstrap')).toBe(0);
    await logoutAndCheck(page);
  } finally {
    console.info(JSON.stringify({ scenario: 'login-body-loss', responses: network.responses }));
    await eraseInputs(page);
  }
});
