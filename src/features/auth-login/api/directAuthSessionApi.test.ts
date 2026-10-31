import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  logoutDirectSession,
  readDirectCsrf,
  recoverDirectRefresh,
  refreshDirectSession,
} from './directAuthSessionApi';
import { createDirectAuthOperation, persistDirectAuthOperation } from './directAuthOperationStore';
const flowId = '123e4567-e89b-42d3-a456-426614174000';
const operationId = '123e4567-e89b-42d3-a456-426614174001';
const recoveryOperationId = '123e4567-e89b-42d3-a456-426614174002';
const tuple = { flowId, startingEpoch: '1', operationId };
const response = (message: string, data: unknown, status = 200) =>
  vi.fn().mockResolvedValue(Response.json({ message, data }, { status })) as typeof fetch;
beforeEach(() => sessionStorage.clear());
describe('direct session API', () => {
  it('reads CSRF without the protocol marker', async () => {
    const fetcher = response('csrf token issued', { csrf_token: 'csrf' });
    await readDirectCsrf(fetcher);
    expect(
      new Headers(vi.mocked(fetcher).mock.calls[0][1]!.headers).has('X-Auth-Login-Protocol'),
    ).toBe(false);
  });
  it('persists and sends refresh and logout with their separate IDs', async () => {
    const refresh = response('token refreshed', { access_token: 'a', expires_in: '60' });
    await refreshDirectSession(
      createDirectAuthOperation('REFRESH', flowId, '1', operationId),
      tuple,
      'csrf',
      { fetcher: refresh },
    );
    expect(
      new Headers(vi.mocked(refresh).mock.calls[0][1]!.headers).get('X-Refresh-Operation-Id'),
    ).toBe(operationId);
    const logout = response('logout committed', {
      logoutReceipt: {
        operationId,
        committed: true,
        flowEpoch: '1',
        revision: '1',
        completedAt: '2026-12-01T00:00:00Z',
      },
    });
    await logoutDirectSession(
      createDirectAuthOperation('LOGOUT', flowId, '1', operationId),
      tuple,
      'csrf',
      { fetcher: logout },
    );
    expect(new Headers(vi.mocked(logout).mock.calls[0][1]!.headers).get('Idempotency-Key')).toBe(
      operationId,
    );
  });
  it('requires a preserved source refresh and separately stores recovery', async () => {
    const recovery = createDirectAuthOperation(
      'REFRESH_RECOVERY',
      flowId,
      '1',
      recoveryOperationId,
    );
    const fetcher = response(
      'RECOVERY_IN_PROGRESS',
      {
        ...tuple,
        recoveryOperationId,
        status: 'IN_PROGRESS',
        leaseExpiresAt: '2026-12-01T00:00:00Z',
      },
      202,
    );
    await expect(recoverDirectRefresh(recovery, tuple, 'csrf', { fetcher })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    persistDirectAuthOperation(
      'REFRESH',
      createDirectAuthOperation('REFRESH', flowId, '1', operationId),
    );
    await recoverDirectRefresh(recovery, tuple, 'csrf', { fetcher });
    expect(
      new Headers(vi.mocked(fetcher).mock.calls[0][1]!.headers).get(
        'X-Auth-Refresh-Recovery-Operation-Id',
      ),
    ).toBe(recoveryOperationId);
    expect(sessionStorage.getItem('meomuneum:direct-auth-operation:REFRESH')).toBeTruthy();
    expect(sessionStorage.getItem('meomuneum:direct-auth-operation:REFRESH_RECOVERY')).toBeTruthy();
  });
});
