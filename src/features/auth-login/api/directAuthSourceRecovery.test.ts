import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const flowId = '123e4567-e89b-42d3-a456-426614174000';
beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_AUTH_DIRECT_V2_ENABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function setup(
  options: {
    enabled?: boolean;
    lose?: boolean;
    mismatch?: boolean;
    pending?: boolean;
    login?: boolean;
    leaseExpired?: boolean;
  } = {},
) {
  vi.stubEnv('VITE_AUTH_DIRECT_V2_SOURCE_RECOVERY_VERIFIED', options.enabled ? 'true' : 'false');
  const api = await import('./directAuthRecovery');
  const store = await import('./directAuthOperationStore');
  const state = await import('./directAuthSessionState');
  const source = store.createDirectAuthOperation(
    options.login ? 'LOGIN' : 'REFRESH',
    flowId,
    '1',
    crypto.randomUUID(),
  );
  store.persistDirectAuthOperation(options.login ? 'LOGIN' : 'REFRESH', source);
  let completed = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const recovery = store.readDirectAuthOperation(
      options.login ? 'LOGIN_RECOVERY' : 'REFRESH_RECOVERY',
    );
    const recoveryData = {
      flowId,
      operationId: source.operationId,
      startingEpoch: '1',
      recoveryOperationId: recovery?.operationId ?? null,
      leaseExpiresAt: null,
      status: completed ? 'SUCCEEDED' : 'NONE',
      resultEpoch: completed ? '2' : null,
      resultRevision: completed ? '4' : null,
      clientExpiresAt: recovery ? String(recovery.expiresAt) : null,
      effectiveExpiresAt: recovery ? String(recovery.expiresAt) : null,
    };
    if (String(input).endsWith('/token/csrf'))
      return Response.json({ message: 'csrf token issued', data: { csrf_token: 'csrf' } });
    if (init?.method === 'POST') {
      expect(recovery).not.toBeNull();
      const headers = new Headers(init.headers);
      if (options.login) {
        expect(recovery).toEqual(source);
        expect(init.body).toBeUndefined();
        expect(headers.has('X-Auth-Refresh-Recovery-Operation-Id')).toBe(false);
        if (options.lose) throw new Error();
        if (options.pending)
          return Response.json(
            {
              message: 'LOGIN_IN_PROGRESS',
              data: {
                flowId,
                operationId: source.operationId,
                startingEpoch: '1',
                status: 'IN_PROGRESS',
                resultEpoch: null,
                resultRevision: null,
              },
            },
            { status: 202 },
          );
        completed = true;
        return Response.json({
          message: 'login success',
          data: { access_token: 'memory', expires_in: '60' },
        });
      }
      expect(headers.get('X-Auth-Refresh-Recovery-Operation-Id')).toBe(recovery!.operationId);
      expect(headers.get('X-Auth-Recovery-Client-Expires-At')).toBe(String(recovery!.expiresAt));
      expect(headers.has('X-Auth-Client-Expires-At')).toBe(false);
      expect(recovery!.expiresAt).toBeLessThanOrEqual(source.expiresAt);
      if (options.lose) throw new Error();
      if (options.pending)
        return Response.json(
          {
            message: 'RECOVERY_IN_PROGRESS',
            data: {
              flowId,
              operationId: source.operationId,
              startingEpoch: '1',
              recoveryOperationId: recovery!.operationId,
              status: 'IN_PROGRESS',
              leaseExpiresAt: new Date(Date.now() + 10000).toISOString(),
            },
          },
          { status: 202 },
        );
      completed = true;
      return Response.json({
        message: 'refresh session recovered',
        data: {
          flowId,
          operationId: source.operationId,
          startingEpoch: '1',
          recoveryOperationId: recovery!.operationId,
          resultEpoch: '2',
          resultRevision: '4',
          access_token: 'memory',
          expires_in: '60',
        },
      });
    }
    if (options.login && String(input).includes('/login/operations/'))
      return Response.json({
        message: 'login operation',
        data: {
          flowId,
          operationId: source.operationId,
          startingEpoch: '1',
          status: 'SUCCEEDED',
          resultEpoch: '2',
          resultRevision: '3',
          reasonCode: null,
        },
      });
    if (String(input).includes('/session-recovery/') && options.leaseExpired && !completed)
      return Response.json(
        {
          message: 'AUTH_RECOVERY_LEASE_EXPIRED',
          data: {
            ...recoveryData,
            status: 'LEASE_EXPIRED',
            leaseExpiresAt: new Date(Date.now() - 1).toISOString(),
          },
        },
        { status: 409 },
      );
    if (String(input).includes('/session-recovery/'))
      return Response.json({
        message: String(input).endsWith('/current')
          ? 'current refresh recovery'
          : 'refresh recovery status',
        data: recoveryData,
      });
    return Response.json({
      message: 'current auth operation',
      data: {
        flow: {
          flowId,
          flowEpoch: '2',
          revision: options.login
            ? completed && options.mismatch
              ? '4'
              : '3'
            : completed
              ? options.mismatch
                ? '5'
                : '4'
              : '3',
          authenticated: true,
          lifecycle: 'AUTHENTICATED',
          proofState: 'ACTIVE',
        },
        operation: {
          flowId,
          operationId: source.operationId,
          startingEpoch: '1',
          kind: options.login ? 'LOGIN' : 'REFRESH',
          status: 'SUCCEEDED',
          resultEpoch: '2',
          resultRevision: '3',
          reasonCode: null,
          leaseExpiresAt: null,
          receiptExpiresAt: new Date(source.expiresAt).toISOString(),
          clientExpiresAt: String(source.expiresAt),
          effectiveExpiresAt: String(source.expiresAt),
        },
      },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  return { api, store, state, source, fetcher };
}
it('keeps source recovery OFF without sending any request by default', async () => {
  const test = await setup();
  expect(await test.api.inspectSourceRecovery()).toBeNull();
  expect(test.fetcher).not.toHaveBeenCalled();
});
it('uses metadata GET only until an explicit separate recovery action and installs after both canonical results', async () => {
  const test = await setup({ enabled: true });
  const plan = await test.api.inspectSourceRecovery();
  expect(test.fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  const result = await test.api.performSourceRecovery(plan!);
  expect(result.success?.message).toBe('login success');
  expect(test.state.getDirectAccessToken()).toBe('memory');
  expect(test.store.readDirectAuthOperation('REFRESH')).toBeNull();
  expect(test.store.readDirectAuthOperation('REFRESH_RECOVERY')).toBeNull();
  expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
it.each([{ lose: true }, { mismatch: true }, { pending: true }])(
  'keeps source and recovery identities on uncertainty: %j',
  async (options) => {
    const test = await setup({ enabled: true, ...options });
    const action = test.api.performSourceRecovery((await test.api.inspectSourceRecovery())!);
    if (options.pending) expect((await action).success).toBeUndefined();
    else await expect(action).rejects.toThrow();
    expect(test.store.readDirectAuthOperation('REFRESH')).toEqual(test.source);
    expect(test.store.readDirectAuthOperation('REFRESH_RECOVERY')).not.toBeNull();
    expect(test.state.getDirectAccessToken()).toBeNull();
    expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  },
);
it('rejects a plan after a newer intent without any mutation', async () => {
  const test = await setup({ enabled: true });
  const plan = await test.api.inspectSourceRecovery();
  test.state.beginDirectAuthIntent();
  await expect(test.api.performSourceRecovery(plan!)).rejects.toThrow();
  expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});

it('recovers LOGIN only by explicit original-ID replay with the original expiry tuple and no credentials', async () => {
  const test = await setup({ enabled: true, login: true });
  const plan = await test.api.inspectSourceRecovery();
  expect(plan?.kind).toBe('login');
  expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  const result = await test.api.performSourceRecovery(plan!);
  expect(result.success?.message).toBe('login success');
  expect(test.store.readDirectAuthOperation('LOGIN')).toBeNull();
  expect(test.store.readDirectAuthOperation('LOGIN_RECOVERY')).toBeNull();
  expect(test.state.getDirectAccessToken()).toBe('memory');
});

it.each([{ lose: true }, { mismatch: true }, { pending: true }])(
  'preserves the immutable LOGIN tuple and never resubmits credentials on uncertain recovery: %j',
  async (options) => {
    const test = await setup({ enabled: true, login: true, ...options });
    const action = test.api.performSourceRecovery((await test.api.inspectSourceRecovery())!);
    if (options.pending) expect((await action).success).toBeUndefined();
    else await expect(action).rejects.toThrow();
    expect(test.store.readDirectAuthOperation('LOGIN')).toEqual(test.source);
    expect(test.store.readDirectAuthOperation('LOGIN_RECOVERY')).toEqual(test.source);
    expect(test.state.getDirectAccessToken()).toBeNull();
    expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  },
);
it('refuses a changed fixed source cutoff between discovery and mutation', async () => {
  const test = await setup({ enabled: true });
  const plan = (await test.api.inspectSourceRecovery())!;
  await expect(
    test.api.performSourceRecovery({ ...plan, sourceCutoff: plan.sourceCutoff - 1 }),
  ).rejects.toThrow();
  expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});

it('reclaims only an existing exact recovery ID after a live authenticated lease-expired GET', async () => {
  const test = await setup({ enabled: true, leaseExpired: true });
  const recovery = test.store.createDirectAuthOperation(
    'REFRESH_RECOVERY',
    flowId,
    '1',
    crypto.randomUUID(),
    Date.now(),
    60000,
  );
  test.store.persistDirectAuthOperation('REFRESH_RECOVERY', recovery);
  const plan = await test.api.inspectSourceRecovery();
  expect(plan?.recovery).toEqual(recovery);
  await test.api.performSourceRecovery(plan!);
  expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
