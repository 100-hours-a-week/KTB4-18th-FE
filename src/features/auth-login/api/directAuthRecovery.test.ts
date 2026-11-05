import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const flowId = '123e4567-e89b-42d3-a456-426614174000';
beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_AUTH_DIRECT_V2_ENABLED', 'true');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function setup(
  options: {
    enabled?: boolean;
    lose?: boolean;
    mismatch?: boolean;
    failureCode?: 'AUTH_SESSION_INVALID' | 'REFRESH_INVALID_TOKEN';
  } = {},
) {
  vi.stubEnv('VITE_AUTH_DIRECT_V2_REFRESH_VERIFIED', options.enabled ? 'true' : 'false');
  const storage = await import('./directAuthOperationStore');
  const state = await import('./directAuthSessionState');
  const recovery = await import('./directAuthSessionRefresh');
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const source = storage.readDirectAuthOperation('REFRESH');
    if (String(input).endsWith('/token/csrf'))
      return Response.json({ message: 'csrf token issued', data: { csrf_token: 'csrf' } });
    if (init?.method === 'POST') {
      expect(String(input)).toContain('/token/refresh');
      expect(source).not.toBeNull();
      expect(new Headers(init.headers).get('X-Auth-Client-Expires-At')).toBe(
        String(source!.expiresAt),
      );
      expect(new Headers(init.headers).get('X-Refresh-Operation-Id')).toBe(source!.operationId);
      expect(new Headers(init.headers).has('Idempotency-Key')).toBe(false);
      if (options.lose) throw new Error();
      if (options.failureCode)
        return Response.json({ message: options.failureCode, data: null }, { status: 401 });
      return Response.json({
        message: 'token refreshed',
        data: { access_token: 'memory', expires_in: '60' },
      });
    }
    return Response.json({
      message: 'current auth operation',
      data: {
        flow: {
          flowId,
          flowEpoch: '2',
          revision: source ? '4' : '3',
          lifecycle: 'AUTHENTICATED',
          authenticated: true,
          proofState: 'ACTIVE',
        },
        operation: source
          ? {
              flowId,
              startingEpoch: '2',
              operationId: source.operationId,
              kind: 'REFRESH',
              status: 'SUCCEEDED',
              resultEpoch: '2',
              resultRevision: options.mismatch ? '5' : '4',
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
  return { ...recovery, storage, state, fetcher };
}
it('keeps first refresh disabled by default even for an ACTIVE session', async () => {
  const test = await setup();
  await test.restoreVerifiedDirectSession();
  expect(test.fetcher).toHaveBeenCalledOnce();
  expect(test.fetcher.mock.calls[0][1]?.method).toBe('GET');
  expect(test.state.getDirectAccessToken()).toBeNull();
});
it('allows only one fresh document-owned refresh after explicit verified DEV opt-in', async () => {
  const test = await setup({ enabled: true });
  await Promise.all([test.restoreVerifiedDirectSession(), test.restoreVerifiedDirectSession()]);
  expect(test.state.getDirectAccessToken()).toBe('memory');
  expect(test.storage.readDirectAuthOperation('REFRESH')).toBeNull();
  test.state.clearDirectSession();
  await test.restoreVerifiedDirectSession();
  expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
it.each([{ lose: true }, { mismatch: true }])(
  'preserves an uncertain first refresh without replacement POST: %j',
  async (options) => {
    const test = await setup({ enabled: true, ...options });
    await expect(test.restoreVerifiedDirectSession()).rejects.toThrow();
    const source = test.storage.readDirectAuthOperation('REFRESH');
    expect(source).not.toBeNull();
    await test.restoreVerifiedDirectSession();
    expect(test.storage.readDirectAuthOperation('REFRESH')).toEqual(source);
    expect(test.state.getDirectAccessToken()).toBeNull();
    expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  },
);
it('never treats a copied persisted tuple as a fresh unsent operation', async () => {
  const test = await setup({ enabled: true });
  const source = test.storage.createDirectAuthOperation(
    'REFRESH',
    flowId,
    '2',
    crypto.randomUUID(),
  );
  test.storage.persistDirectAuthOperation('REFRESH', source);
  await test.restoreVerifiedDirectSession();
  expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  expect(test.storage.readDirectAuthOperation('REFRESH')).toEqual(source);
});

it.each([
  ['AUTH_SESSION_INVALID', 'DirectAuthApiError'],
  ['REFRESH_INVALID_TOKEN', 'DirectAuthProtocolError'],
] as const)(
  'retains the original on 401 %s without accepting undeclared codes',
  async (failureCode, errorName) => {
    const test = await setup({ enabled: true, failureCode });
    await expect(test.restoreVerifiedDirectSession()).rejects.toHaveProperty('name', errorName);
    const source = test.storage.readDirectAuthOperation('REFRESH');
    expect(source).not.toBeNull();
    await test.restoreVerifiedDirectSession();
    expect(test.storage.readDirectAuthOperation('REFRESH')).toEqual(source);
    expect(test.state.getDirectAccessToken()).toBeNull();
    expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  },
);
