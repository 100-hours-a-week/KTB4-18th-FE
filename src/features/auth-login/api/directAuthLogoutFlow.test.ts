import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { performDirectLogout } from './directAuthLogoutFlow';
import {
  beginDirectAuthIntent,
  clearDirectSession,
  getDirectAccessToken,
  installDirectSession,
} from './directAuthSessionState';
import { readDirectAuthOperation } from './directAuthOperationStore';
const flowId = '123e4567-e89b-42d3-a456-426614174000';
const flow = {
  flowId,
  flowEpoch: '1',
  revision: '2',
  authenticated: true,
  proofState: 'ACTIVE',
  lifecycle: 'AUTHENTICATED',
} as const;
beforeEach(() => {
  sessionStorage.clear();
  clearDirectSession();
});
afterEach(() => vi.unstubAllGlobals());
function transport(badCanonical = false) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const source = readDirectAuthOperation('LOGOUT');
    if (String(input).endsWith('/token/csrf'))
      return Response.json({ message: 'csrf token issued', data: { csrf_token: 'csrf' } });
    if (!source) throw new Error();
    const receipt = {
      operationId: source.operationId,
      committed: true,
      flowEpoch: '2',
      revision: '3',
      completedAt: new Date().toISOString(),
    };
    if (String(input).endsWith('/logout'))
      return Response.json({ message: 'logout committed', data: { logoutReceipt: receipt } });
    return Response.json({
      message: 'current auth operation',
      data: {
        flow: {
          ...flow,
          flowEpoch: '2',
          revision: badCanonical ? '4' : '3',
          authenticated: false,
          lifecycle: 'ANONYMOUS',
        },
        operation: {
          flowId,
          startingEpoch: '1',
          operationId: source.operationId,
          kind: 'LOGOUT',
          status: 'SUCCEEDED',
          resultEpoch: '2',
          resultRevision: '3',
          reasonCode: null,
          leaseExpiresAt: null,
          receiptExpiresAt: new Date(source.expiresAt).toISOString(),
          clientExpiresAt: null,
          effectiveExpiresAt: null,
        },
      },
    });
  });
}
it('blocks token use at logout intent and clears only after committed anonymous canonical', async () => {
  installDirectSession(beginDirectAuthIntent(), 'memory', '60', flow);
  const fetcher = transport();
  vi.stubGlobal('fetch', fetcher);
  const pending = performDirectLogout();
  expect(getDirectAccessToken()).toBeNull();
  await pending;
  expect(readDirectAuthOperation('LOGOUT')).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/logout'))).toHaveLength(1);
});
it('preserves ambiguity and makes repeated logout attempts GET-only', async () => {
  installDirectSession(beginDirectAuthIntent(), 'memory', '60', flow);
  const fetcher = transport(true);
  vi.stubGlobal('fetch', fetcher);
  await expect(performDirectLogout()).rejects.toThrow();
  const source = readDirectAuthOperation('LOGOUT');
  expect(source).not.toBeNull();
  await expect(performDirectLogout()).rejects.toThrow();
  expect(readDirectAuthOperation('LOGOUT')).toEqual(source);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/logout'))).toHaveLength(1);
  expect(getDirectAccessToken()).toBeNull();
});

it('retries only by explicit action with the original logout tuple after response loss', async () => {
  installDirectSession(beginDirectAuthIntent(), 'memory', '60', flow);
  let lost = false;
  const ids: string[] = [];
  const original = transport();
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/flow'))
      return Response.json({
        message: 'auth flow',
        data: {
          ...flow,
          proofState: undefined,
          refreshGeneration: '1',
          pendingOperations: [],
          lastLogoutReceipt: null,
          lastRefreshReceipt: null,
          rebootstrapReason: null,
          loginProtocol: 'direct-v2',
          flowCookieGeneration: '1',
          flowCookieExpiresAt: '2099-01-01T00:00:00Z',
        },
      });
    if (String(input).endsWith('/logout')) {
      ids.push(new Headers(init?.headers).get('Idempotency-Key')!);
      if (!lost) {
        lost = true;
        throw new Error();
      }
    }
    return original(input);
  });
  vi.stubGlobal('fetch', fetcher);
  await expect(performDirectLogout()).rejects.toThrow();
  const source = readDirectAuthOperation('LOGOUT')!;
  expect(ids).toEqual([source.operationId]);
  await performDirectLogout();
  expect(ids).toEqual([source.operationId, source.operationId]);
  expect(readDirectAuthOperation('LOGOUT')).toBeNull();
});
