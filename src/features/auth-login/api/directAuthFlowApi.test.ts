import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootstrapDirectAuth,
  readCurrentDirectOperation,
  readDirectAuthFlow,
  rebootstrapDirectAuth,
} from './directAuthFlowApi';
import { createDirectAuthOperation } from './directAuthOperationStore';
const flowId = '123e4567-e89b-42d3-a456-426614174000';
const operationId = '123e4567-e89b-42d3-a456-426614174001';
const flow = {
  flowId,
  flowEpoch: '1',
  revision: '1',
  lifecycle: 'ANONYMOUS',
  authenticated: false,
  refreshGeneration: '0',
  currentTicket: null,
  pendingOperations: [],
  lastLogoutReceipt: null,
  lastRefreshReceipt: null,
  lastQueueCancelReceipt: null,
  rebootstrapReason: null,
  loginProtocol: 'direct-v2',
  flowCookieGeneration: '1',
  flowCookieExpiresAt: '2026-12-01T00:00:00Z',
};
const currentFlow = {
  flowId,
  flowEpoch: '1',
  revision: '1',
  lifecycle: 'ANONYMOUS',
  authenticated: false,
  proofState: 'ACTIVE',
};
const response = (message: string, data: unknown) =>
  vi.fn().mockResolvedValue(Response.json({ message, data })) as typeof fetch;
beforeEach(() => sessionStorage.clear());
describe('direct flow API', () => {
  it('reads flow and discovers current operation without tuple headers', async () => {
    const getFlow = response('auth flow', flow);
    await readDirectAuthFlow(getFlow);
    const getCurrent = response('current auth operation', { flow: currentFlow, operation: null });
    await readCurrentDirectOperation(undefined, getCurrent);
    const init = vi.mocked(getCurrent).mock.calls[0][1]!;
    expect(new Headers(init.headers).has('X-Auth-Flow-Id')).toBe(false);
    expect(init.credentials).toBe('include');
  });
  it('persists bootstrap before credential-free dispatch', async () => {
    const operation = createDirectAuthOperation('BOOTSTRAP', null, null, operationId);
    const fetcher = response('auth flow', flow);
    await bootstrapDirectAuth(operation, 'csrf', { fetcher });
    const init = vi.mocked(fetcher).mock.calls[0][1]!;
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get('X-Auth-Flow-Operation-Id')).toBe(operationId);
    expect(sessionStorage.getItem('meomuneum:direct-auth-operation:BOOTSTRAP')).toBeTruthy();
  });
  it('rebootstraps with the original tuple', async () => {
    const operation = createDirectAuthOperation('REBOOTSTRAP', flowId, '1', operationId);
    const fetcher = response('auth flow rebootstrap', {
      flow: currentFlow,
      operationId,
      startingEpoch: '1',
      resultEpoch: '1',
      resultRevision: '1',
    });
    await rebootstrapDirectAuth(operation, { flowId, startingEpoch: '1' }, 'csrf', { fetcher });
    expect(
      new Headers(vi.mocked(fetcher).mock.calls[0][1]!.headers).get(
        'X-Auth-Rebootstrap-Operation-Id',
      ),
    ).toBe(operationId);
  });
});

describe('current discovery identity', () => {
  const otherId = '123e4567-e89b-42d3-a456-426614174002';
  const operation = {
    flowId,
    startingEpoch: '1',
    operationId,
    kind: 'REFRESH',
    status: 'IN_PROGRESS',
    resultEpoch: null,
    resultRevision: null,
    reasonCode: null,
    leaseExpiresAt: '2026-12-01T00:00:00Z',
    receiptExpiresAt: null,
    clientExpiresAt: null,
    effectiveExpiresAt: null,
  };
  const tuple = { flowId, startingEpoch: '1', operationId };
  const read = (flowValue: typeof currentFlow, op: typeof operation | null, expected = tuple) =>
    readCurrentDirectOperation(
      expected,
      response('current auth operation', { flow: flowValue, operation: op }),
    );
  it('checks canonical flow and the epoch of the same operation', async () => {
    await expect(read({ ...currentFlow, flowId: otherId }, null)).rejects.toThrow();
    await expect(read(currentFlow, { ...operation, flowId: otherId })).rejects.toThrow();
    await expect(read(currentFlow, { ...operation, startingEpoch: '2' })).rejects.toThrow();
    await expect(read(currentFlow, operation)).resolves.toBeTruthy();
  });
  it('allows a different current operation and checks flow even without a tuple', async () => {
    await expect(
      read(currentFlow, { ...operation, operationId: otherId, startingEpoch: '2' }),
    ).resolves.toBeTruthy();
    await expect(
      readCurrentDirectOperation(
        undefined,
        response('current auth operation', {
          flow: currentFlow,
          operation: { ...operation, flowId: otherId },
        }),
      ),
    ).rejects.toThrow();
  });
});
