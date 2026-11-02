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
    terminalPointer?: boolean;
  } = {},
) {
  vi.stubEnv('VITE_AUTH_DIRECT_V2_REBOOTSTRAP_VERIFIED', options.enabled ? 'true' : 'false');
  const api = await import('./directAuthRebootstrap');
  const store = await import('./directAuthOperationStore');
  const state = await import('./directAuthSessionState');
  let completed = false;
  let lost = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const active = {
      flowId,
      flowEpoch: '2',
      revision: options.mismatch ? '4' : '3',
      authenticated: false,
      lifecycle: 'ANONYMOUS',
      proofState: 'ACTIVE',
    };
    if (String(input).endsWith('/token/csrf'))
      return Response.json({ message: 'csrf token issued', data: { csrf_token: 'csrf' } });
    if (init?.method === 'POST') {
      const operation = store.readDirectAuthOperation('REBOOTSTRAP')!;
      expect(new Headers(init.headers).get('X-Auth-Rebootstrap-Operation-Id')).toBe(
        operation.operationId,
      );
      expect(new Headers(init.headers).get('X-Auth-Flow-Epoch')).toBe('1');
      if (options.lose && !lost) {
        lost = true;
        throw new Error();
      }
      completed = true;
      return Response.json({
        message: 'auth flow rebootstrap',
        data: {
          flow: { ...active, revision: '3' },
          operationId: operation.operationId,
          startingEpoch: '1',
          resultEpoch: '2',
          resultRevision: '3',
        },
      });
    }
    return Response.json({
      message: 'current auth operation',
      data: {
        flow: completed
          ? active
          : {
              flowId,
              flowEpoch: '1',
              revision: '2',
              authenticated: false,
              lifecycle: 'ANONYMOUS',
              proofState: 'REBOOTSTRAP_REQUIRED',
            },
        operation:
          completed && options.terminalPointer
            ? (() => {
                const source = store.readDirectAuthOperation('LOGIN')!;
                return {
                  flowId,
                  operationId: source.operationId,
                  startingEpoch: source.startingEpoch,
                  kind: 'LOGIN',
                  status: 'SUPERSEDED',
                  resultEpoch: '2',
                  resultRevision: '3',
                  reasonCode: null,
                  leaseExpiresAt: null,
                  receiptExpiresAt: new Date(source.expiresAt).toISOString(),
                  clientExpiresAt: String(source.expiresAt),
                  effectiveExpiresAt: String(source.expiresAt),
                };
              })()
            : null,
      },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  return { api, store, state, fetcher };
}
it('keeps rebootstrap OFF with no metadata or mutation request by default', async () => {
  const test = await setup();
  expect(await test.api.inspectRebootstrap()).toBeNull();
  expect(test.fetcher).not.toHaveBeenCalled();
});
it('uses a separate click after GET and unlocks only a confirmed anonymous epoch fence', async () => {
  const test = await setup({ enabled: true });
  const login = test.store.createDirectAuthOperation('LOGIN', flowId, '1', crypto.randomUUID());
  test.store.persistDirectAuthOperation('LOGIN', login);
  const plan = await test.api.inspectRebootstrap();
  expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  const result = await test.api.performRebootstrap(plan!);
  expect(result.released).toBe(true);
  expect(test.store.readDirectAuthOperation('REBOOTSTRAP')).toBeNull();
  expect(test.store.readDirectAuthOperation('LOGIN')).toBeNull();
  expect(test.state.getDirectAccessToken()).toBeNull();
});
it('keeps an uncertain operation and reuses its original ID only after another explicit action', async () => {
  const test = await setup({ enabled: true, lose: true });
  await expect(
    test.api.performRebootstrap((await test.api.inspectRebootstrap())!),
  ).rejects.toThrow();
  const original = test.store.readDirectAuthOperation('REBOOTSTRAP')!;
  expect(test.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  const retry = await test.api.inspectRebootstrap();
  expect(retry?.operation).toEqual(original);
  await test.api.performRebootstrap(retry!);
  const ids = test.fetcher.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => new Headers(init?.headers).get('X-Auth-Rebootstrap-Operation-Id'));
  expect(ids).toEqual([original.operationId, original.operationId]);
});
it('does not clear the operation on canonical mismatch', async () => {
  const test = await setup({ enabled: true, mismatch: true });
  await expect(
    test.api.performRebootstrap((await test.api.inspectRebootstrap())!),
  ).rejects.toThrow();
  expect(test.store.readDirectAuthOperation('REBOOTSTRAP')).not.toBeNull();
});

it('recognizes an exact SUPERSEDED LOGIN pointer as a confirmed anonymous new-epoch fence', async () => {
  const test = await setup({ enabled: true, terminalPointer: true });
  const login = test.store.createDirectAuthOperation('LOGIN', flowId, '1', crypto.randomUUID());
  test.store.persistDirectAuthOperation('LOGIN', login);
  const result = await test.api.performRebootstrap((await test.api.inspectRebootstrap())!);
  expect(result.released).toBe(true);
  expect(test.store.readDirectAuthOperation('LOGIN')).toBeNull();
});
