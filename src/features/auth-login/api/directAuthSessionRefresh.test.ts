import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const flowId = '123e4567-e89b-42d3-a456-426614174000';
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_AUTH_DIRECT_V2_ENABLED', 'true');
  vi.stubEnv('VITE_AUTH_DIRECT_V2_REFRESH_VERIFIED', 'true');
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
async function setup() {
  const state = await import('./directAuthSessionState');
  const store = await import('./directAuthOperationStore');
  const api = await import('./directAuthSessionRefresh');
  let epoch = 2;
  let revision = 3;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/users/me')) return new Response(null, { status: 200 });
    if (String(input).endsWith('/token/csrf'))
      return Response.json({ message: 'csrf token issued', data: { csrf_token: 'csrf' } });
    if (init?.method === 'POST') {
      epoch += 1;
      revision += 1;
      return Response.json({
        message: 'token refreshed',
        data: { access_token: `memory-${epoch}`, expires_in: '1' },
      });
    }
    const source = store.readDirectAuthOperation('REFRESH');
    return Response.json({
      message: 'current auth operation',
      data: {
        flow: {
          flowId,
          flowEpoch: String(epoch),
          revision: String(revision),
          lifecycle: 'AUTHENTICATED',
          authenticated: true,
          proofState: 'ACTIVE',
        },
        operation: source
          ? {
              flowId,
              operationId: source.operationId,
              startingEpoch: source.startingEpoch,
              kind: 'REFRESH',
              status: 'SUCCEEDED',
              resultEpoch: String(epoch),
              resultRevision: String(revision),
              reasonCode: null,
              leaseExpiresAt: null,
              receiptExpiresAt: new Date(source.expiresAt).toISOString(),
              clientExpiresAt: String(source.expiresAt),
              effectiveExpiresAt: String(source.expiresAt),
            }
          : null,
      },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  return { api, state, store, fetcher };
}
it('keeps a server-valid token across a peer refresh without producing another POST', async () => {
  const test = await setup();
  await test.api.restoreVerifiedDirectSession();
  const token = test.state.getDirectAccessToken();
  await test.api.restoreVerifiedDirectSession();
  expect(test.state.getDirectAccessToken()).toBe(token);
  expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
it('renews after client TTL expiry on a new canonical generation and coalesces repeated observations', async () => {
  vi.useFakeTimers();
  const test = await setup();
  await test.api.restoreVerifiedDirectSession();
  await vi.advanceTimersByTimeAsync(1001);
  expect(test.state.getDirectAccessToken()).toBeNull();
  await Promise.all([
    test.api.restoreVerifiedDirectSession(),
    test.api.restoreVerifiedDirectSession(),
  ]);
  expect(test.state.getDirectAccessToken()).toBe('memory-4');
  expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
  test.state.clearDirectSession();
});
it('keeps an existing copied tuple GET-only even on a new observation', async () => {
  const test = await setup();
  test.store.persistDirectAuthOperation(
    'REFRESH',
    test.store.createDirectAuthOperation('REFRESH', flowId, '2', crypto.randomUUID()),
  );
  await test.api.restoreVerifiedDirectSession();
  expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});

it.each(['network', '503'] as const)(
  'does not consume a canonical boundary on pre-dispatch CSRF %s failure',
  async (failure) => {
    const test = await setup();
    const actual = test.fetcher.getMockImplementation()!;
    let failed = false;
    test.fetcher.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/token/csrf') && !failed) {
        failed = true;
        if (failure === '503')
          return Response.json({ message: 'AUTH_STATE_UNAVAILABLE', data: null }, { status: 503 });
        throw new Error('read unavailable');
      }
      return actual(input, init);
    });
    await expect(test.api.restoreVerifiedDirectSession()).rejects.toThrow();
    expect(test.store.readDirectAuthOperation('REFRESH')).toBeNull();
    await test.api.restoreVerifiedDirectSession();
    expect(test.state.getDirectAccessToken()).not.toBeNull();
    expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    test.state.clearDirectSession();
  },
);
it('does not consume a canonical boundary after pre-dispatch intent cancellation', async () => {
  const test = await setup();
  const actual = test.fetcher.getMockImplementation()!;
  let cancelled = false;
  test.fetcher.mockImplementation(async (input, init) => {
    if (String(input).endsWith('/token/csrf') && !cancelled) {
      cancelled = true;
      test.state.beginDirectAuthIntent();
    }
    return actual(input, init);
  });
  await expect(test.api.restoreVerifiedDirectSession()).rejects.toThrow();
  expect(test.store.readDirectAuthOperation('REFRESH')).toBeNull();
  await test.api.restoreVerifiedDirectSession();
  expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  test.state.clearDirectSession();
});
