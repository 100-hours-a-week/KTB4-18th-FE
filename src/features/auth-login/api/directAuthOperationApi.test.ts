import { describe, expect, it, vi } from 'vitest';
import {
  readCurrentRefreshRecovery,
  readDirectLoginOperation,
  readRefreshRecoveryOperation,
} from './directAuthOperationApi';
const flowId = '123e4567-e89b-42d3-a456-426614174000';
const operationId = '123e4567-e89b-42d3-a456-426614174001';
const recoveryOperationId = '123e4567-e89b-42d3-a456-426614174002';
const tuple = { flowId, startingEpoch: '1', operationId, recoveryOperationId };
const response = (message: string, data: unknown, status = 200) =>
  vi.fn().mockResolvedValue(Response.json({ message, data }, { status })) as typeof fetch;
describe('operation read APIs', () => {
  it('reads login in-progress status using exact identity', async () => {
    const fetcher = response(
      'LOGIN_IN_PROGRESS',
      {
        flowId,
        startingEpoch: '1',
        operationId,
        status: 'IN_PROGRESS',
        resultEpoch: null,
        resultRevision: null,
      },
      202,
    );
    await readDirectLoginOperation(tuple, fetcher);
    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toContain(`/login/operations/${operationId}`);
    expect(new Headers(init!.headers).get('X-Auth-Flow-Epoch')).toBe('1');
  });
  it('reads exact recovery and current discovery without mutation', async () => {
    const data = {
      ...tuple,
      status: 'NOT_RECEIVED',
      leaseExpiresAt: null,
      resultEpoch: null,
      resultRevision: null,
    };
    const exact = response('refresh recovery status', data);
    await readRefreshRecoveryOperation(tuple, exact);
    expect(vi.mocked(exact).mock.calls[0][0]).toContain(`/session-recovery/${recoveryOperationId}`);
    const current = response('current refresh recovery', {
      ...data,
      recoveryOperationId: null,
      status: 'NONE',
    });
    await readCurrentRefreshRecovery(tuple, current);
    expect(vi.mocked(current).mock.calls[0][0]).toContain('/session-recovery/current');
    expect(vi.mocked(current).mock.calls[0][1]!.method).toBe('GET');
  });
});
