import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login?returnTo=%2Fmy');
  await page.getByLabel('이메일', { exact: true }).fill('first@example.test');
  await page.getByLabel('비밀번호', { exact: true }).fill('test-password-123!');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await account(page);
}
async function account(page: Page, name = '첫 번째 계정') {
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}
async function identity(page: Page) {
  return page.evaluate(() => {
    const token = sessionStorage.getItem('access_token');
    if (!token) return null;
    const { sub, sid } = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    return { sub, sid } as { sub: string; sid: string };
  });
}
async function signedOut(page: Page) {
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect.poll(() => identity(page)).toBeNull();
  await expect(page.getByText('첫 번째 계정', { exact: true })).toHaveCount(0);
}

test('새 탭과 로그인 URL의 새 탭은 별도 로그인 없이 같은 sid로 복구한다', async ({
  page,
  context,
}) => {
  let loginRequests = 0;
  context.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/auth/login') loginRequests++;
  });
  await login(page);
  const first = await identity(page);
  const second = await context.newPage();
  await second.goto('/my');
  await account(second);
  const third = await context.newPage();
  await third.goto('/login?returnTo=%2Fmy');
  await account(third);
  expect(await identity(second)).toEqual(first);
  expect(await identity(third)).toEqual(first);
  expect(loginRequests).toBe(1);
  await account(page);
  const refresh = (await context.cookies()).find((cookie) => cookie.name === 'refresh_token');
  expect(refresh?.httpOnly).toBe(true);
  expect(refresh?.path).toBe('/api/v1/auth');
});

test('한 탭 로그아웃은 같은 프로필 전체에 적용하고 다른 프로필은 유지한다', async ({
  page,
  context,
  browser,
  baseURL,
  viewport,
  isMobile,
  hasTouch,
}) => {
  await login(page);
  const second = await context.newPage();
  await second.goto('/my');
  await account(second);
  const remote = await browser.newContext({ baseURL, viewport, isMobile, hasTouch });
  try {
    const remotePage = await remote.newPage();
    await login(remotePage);
    const independent = await identity(remotePage);
    expect(independent?.sid).not.toBe((await identity(page))?.sid);
    await second.getByRole('button', { name: '로그아웃', exact: true }).click();
    await signedOut(page);
    await signedOut(second);
    await account(remotePage);
    expect(await identity(remotePage)).toEqual(independent);
    await remotePage.reload();
    await account(remotePage);
    await page.reload();
    await signedOut(page);
    const fresh = await context.newPage();
    await fresh.goto('/my');
    await signedOut(fresh);
  } finally {
    await remote.close();
  }
});

test('BroadcastChannel 없이도 기존 로그인 화면 탭이 로그인 성공을 복구하고 로그아웃을 공유한다', async ({
  context,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined, configurable: true }),
  );
  const waiting = await context.newPage();
  await waiting.goto('/login?returnTo=%2Fmy');
  await expect(waiting.getByLabel('이메일', { exact: true })).toBeVisible();
  const source = await context.newPage();
  await login(source);
  await account(waiting);
  expect(await identity(waiting)).toEqual(await identity(source));
  await source.getByRole('button', { name: '로그아웃', exact: true }).click();
  await signedOut(source);
  await signedOut(waiting);
});

test('여러 새 탭의 동시 복구와 중복 알림은 로그인 상태를 끊지 않는다', async ({
  page,
  context,
}) => {
  await login(page);
  const first = await identity(page);
  const peers = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);
  await Promise.all(
    peers.map(async (peer) => {
      await peer.goto('/my');
      await account(peer);
    }),
  );
  await page.evaluate(() => {
    const channel = new BroadcastChannel('meomuneum:auth-state');
    const epoch = localStorage.getItem('meomuneum:auth-epoch');
    channel.postMessage({ type: 'auth-changed', epoch });
    channel.postMessage({ type: 'auth-changed', epoch });
    channel.postMessage({ type: 'auth-changed', epoch: 'stale-notification' });
    channel.close();
  });
  for (const peer of peers) {
    await account(peer);
    expect(await identity(peer)).toEqual(first);
  }
});

test('같은 프로필의 계정 전환은 다른 탭의 기존 화면과 인증을 새 계정으로 바꾼다', async ({
  page,
  context,
}) => {
  await login(page);
  const previous = await identity(page);
  const second = await context.newPage();
  await second.goto('/my');
  await account(second);
  await page.evaluate(async (path) => {
    const api = await import(path);
    await api.login({ email: 'second@example.test', password: 'test-password-123!' });
  }, '/src/features/auth-login/api/loginApi.ts');
  await account(second, '두 번째 계정');
  expect(await identity(second)).toEqual(await identity(page));
  expect((await identity(second))?.sub).not.toBe(previous?.sub);
  await expect(second.getByText('첫 번째 계정', { exact: true })).toHaveCount(0);
});

test('새 탭의 일시적 복구 실패는 재로그인 없이 재시도하고 원래 탭은 유지한다', async ({
  page,
  context,
}) => {
  await login(page);
  const first = await identity(page);
  const second = await context.newPage();
  await second.route(
    '**/api/v1/auth/token/refresh',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"test unavailable","data":null}',
      }),
    { times: 1 },
  );
  await second.goto('/my');
  await expect(second.getByRole('button', { name: '다시 시도', exact: true })).toBeVisible();
  await expect(second).toHaveURL(/\/my$/);
  await account(page);
  await second.getByRole('button', { name: '다시 시도', exact: true }).click();
  await account(second);
  expect(await identity(second)).toEqual(first);
});
