import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  startDirectLogin,
  completeDirectLogin,
  restoreDirectSession,
  resolveDirectLoginFailure,
} from './directAuthSessionFlow';
import {
  beginDirectAuthIntent,
  clearDirectSession,
  getDirectAccessToken,
} from './directAuthSessionState';
import { readDirectAuthOperation } from './directAuthOperationStore';
const flowId = '123e4567-e89b-42d3-a456-426614174000';
const flow = {
  flowId,
  flowEpoch: '1',
  revision: '1',
  lifecycle: 'ANONYMOUS',
  authenticated: false,
  refreshGeneration: '0',
  pendingOperations: [],
  lastLogoutReceipt: null,
  lastRefreshReceipt: null,
  rebootstrapReason: null,
  loginProtocol: 'direct-v2',
  flowCookieGeneration: '1',
  flowCookieExpiresAt: '2099-01-01T00:00:00Z',
};
const token = { access_token: 'temporary', expires_in: '60' };
const json = (message: string, data: unknown, status = 200) =>
  Response.json({ message, data }, { status });
beforeEach(() => {
  sessionStorage.clear();
  clearDirectSession();
});
afterEach(() => vi.unstubAllGlobals());
function transport(
  overrides: {
    badCanonical?: boolean;
    loseLogin?: boolean;
    rejected?: 'INVALID_CREDENTIALS' | 'NOT_ADMITTED';
    preAdmission?: boolean;
    legacyFlow?: boolean;
  } = {},
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/token/csrf')) return json('csrf token issued', { csrf_token: 'csrf' });
    if (path.endsWith('/flow'))
      return overrides.legacyFlow
        ? json('AUTH_FLOW_REBOOTSTRAP_REQUIRED', null, 409)
        : json('auth flow', flow);
    if (path.endsWith('/flows')) return json('auth flow', flow);
    if (path.endsWith('/login')) {
      const original = readDirectAuthOperation('LOGIN')!;
      expect(original).not.toBeNull();
      expect(new Headers(init?.headers).get('X-Auth-Client-Expires-At')).toBe(
        String(original.expiresAt),
      );
      if (overrides.loseLogin) throw new Error();
      if (overrides.preAdmission) return json('CSRF_DENIED', null, 403);
      if (overrides.rejected)
        return json(
          overrides.rejected === 'NOT_ADMITTED' ? 'AUTH_BCRYPT_CAPACITY' : 'INVALID_CREDENTIALS',
          null,
          overrides.rejected === 'NOT_ADMITTED' ? 503 : 401,
        );
      return json('login success', token);
    }
    const source = readDirectAuthOperation('LOGIN')!;
    const terminal = {
      flowId,
      operationId: source.operationId,
      startingEpoch: '1',
      status: overrides.rejected ?? 'SUCCEEDED',
      resultEpoch: '2',
      resultRevision: '3',
      reasonCode: overrides.rejected === 'NOT_ADMITTED' ? 'AUTH_BCRYPT_CAPACITY' : null,
    };
    if (path.includes('/login/operations/')) return json('login operation', terminal);
    if (path.endsWith('/current-operation'))
      return json('current auth operation', {
        flow: {
          flowId,
          flowEpoch: '2',
          revision: overrides.badCanonical ? '4' : '3',
          lifecycle: overrides.rejected ? 'ANONYMOUS' : 'AUTHENTICATED',
          authenticated: !overrides.rejected,
          proofState: 'ACTIVE',
        },
        operation: {
          ...terminal,
          kind: 'LOGIN',
          clientExpiresAt: String(source.expiresAt),
          effectiveExpiresAt: String(source.expiresAt),
          leaseExpiresAt: null,
          receiptExpiresAt: new Date(source.expiresAt).toISOString(),
        },
      });
    throw new Error('Unexpected route');
  });
}
it('upgrades a legacy flow cookie before submitting login', async () => {
  const fetcher = transport({ legacyFlow: true });
  vi.stubGlobal('fetch', fetcher);
  const version = beginDirectAuthIntent();
  const result = await startDirectLogin({ email: 'a@b.com', password: 'example' }, version);

  expect(result.token).toEqual(token);
  expect(
    fetcher.mock.calls.map(([url, init]) => [String(url).split('/api/v1/auth')[1], init?.method]),
  ).toEqual([
    ['/token/csrf', 'GET'],
    ['/flow', 'GET'],
    ['/flows', 'POST'],
    ['/login', 'POST'],
  ]);
  expect(readDirectAuthOperation('BOOTSTRAP')).toBeNull();
});
it('persists before the single LOGIN POST and installs only after terminal/canonical GET', async () => {
  const fetcher = transport();
  vi.stubGlobal('fetch', fetcher);
  const version = beginDirectAuthIntent();
  const result = await startDirectLogin({ email: 'a@b.com', password: 'example' }, version);
  expect(getDirectAccessToken()).toBeNull();
  expect(await completeDirectLogin(result.operation, result.token!, version)).toBe(true);
  expect(getDirectAccessToken()).toBe(token.access_token);
  expect(readDirectAuthOperation('LOGIN')).toBeNull();
  expect(
    fetcher.mock.calls.filter(
      ([url, init]) => String(url).endsWith('/login') && init?.method === 'POST',
    ),
  ).toHaveLength(1);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('queue'))).toBe(false);
  expect(sessionStorage.getItem('access_token')).toBeNull();
});
it('retains the original on network loss and never dispatches a replacement login', async () => {
  const fetcher = transport({ loseLogin: true });
  vi.stubGlobal('fetch', fetcher);
  await expect(
    startDirectLogin({ email: 'a@b.com', password: 'example' }, beginDirectAuthIntent()),
  ).rejects.toThrow();
  const source = readDirectAuthOperation('LOGIN');
  expect(source).not.toBeNull();
  await expect(
    startDirectLogin({ email: 'a@b.com', password: 'example' }, beginDirectAuthIntent()),
  ).rejects.toThrow();
  expect(readDirectAuthOperation('LOGIN')).toEqual(source);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
it('rejects mismatched canonical revision without clearing the tuple or installing a token', async () => {
  vi.stubGlobal('fetch', transport({ badCanonical: true }));
  const version = beginDirectAuthIntent();
  const result = await startDirectLogin({ email: 'a@b.com', password: 'example' }, version);
  await expect(completeDirectLogin(result.operation, result.token!, version)).rejects.toThrow();
  expect(readDirectAuthOperation('LOGIN')).toEqual(result.operation);
  expect(getDirectAccessToken()).toBeNull();
});
it('restores with one GET and never issues refresh or recovery POST', async () => {
  const fetcher = vi.fn().mockResolvedValue(json('AUTH_FLOW_NOT_FOUND', null, 404));
  vi.stubGlobal('fetch', fetcher);
  await expect(restoreDirectSession()).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][1].method).toBe('GET');
});

it.each(['INVALID_CREDENTIALS', 'NOT_ADMITTED'] as const)(
  'releases exact canonical %s and permits form retry',
  async (rejected) => {
    vi.stubGlobal('fetch', transport({ rejected }));
    const version = beginDirectAuthIntent();
    let failure: unknown;
    try {
      await startDirectLogin({ email: 'a@b.com', password: 'example' }, version);
    } catch (error) {
      failure = error;
    }
    expect(readDirectAuthOperation('LOGIN')).not.toBeNull();
    expect(await resolveDirectLoginFailure(failure, version)).toBe(true);
    expect(readDirectAuthOperation('LOGIN')).toBeNull();
    expect(getDirectAccessToken()).toBeNull();
  },
);
it('clears only this document pre-admission rejection and preserves a stale intent', async () => {
  vi.stubGlobal('fetch', transport({ preAdmission: true }));
  const version = beginDirectAuthIntent();
  let failure: unknown;
  try {
    await startDirectLogin({ email: 'a@b.com', password: 'example' }, version);
  } catch (error) {
    failure = error;
  }
  beginDirectAuthIntent();
  expect(await resolveDirectLoginFailure(failure, version)).toBe(false);
  expect(readDirectAuthOperation('LOGIN')).not.toBeNull();
});
