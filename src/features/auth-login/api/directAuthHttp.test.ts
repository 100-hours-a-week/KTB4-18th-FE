import { describe, expect, it, vi } from 'vitest';
import {
  DirectAuthApiError,
  DirectAuthProtocolError,
  parseDirectAuthResponse,
} from './directAuthHttp';

const flowId = '123e4567-e89b-42d3-a456-426614174000';
const operationId = '123e4567-e89b-42d3-a456-426614174001';
const recoveryOperationId = '123e4567-e89b-42d3-a456-426614174002';
const tuple = { flowId, operationId, recoveryOperationId, startingEpoch: '9223372036854775807' };
const lease = {
  ...tuple,
  status: 'LEASE_EXPIRED',
  leaseExpiresAt: '2026-01-01T00:00:00Z',
  resultEpoch: null,
  resultRevision: null,
};

describe('direct route response validation', () => {
  it('accepts only the error code on the specified status and route', () => {
    expect(() =>
      parseDirectAuthResponse('login', 401, { message: 'INVALID_CREDENTIALS', data: null }),
    ).toThrow(DirectAuthApiError);
    expect(() =>
      parseDirectAuthResponse('refresh', 401, { message: 'INVALID_CREDENTIALS', data: null }),
    ).toThrow(DirectAuthProtocolError);
    expect(() =>
      parseDirectAuthResponse('login', 409, { message: 'INVALID_CREDENTIALS', data: null }),
    ).toThrow(DirectAuthProtocolError);
    expect(() =>
      parseDirectAuthResponse('login', 401, {
        message: 'INVALID_CREDENTIALS',
        data: {},
        extra: true,
      }),
    ).toThrow(DirectAuthProtocolError);
  });
  it('enforces recovery GET lease tuple and never accepts RETRYABLE or 202', () => {
    expect(() =>
      parseDirectAuthResponse(
        'refreshRecoveryStatus',
        409,
        { message: 'AUTH_RECOVERY_LEASE_EXPIRED', data: lease },
        tuple,
      ),
    ).toThrow(DirectAuthApiError);
    expect(() =>
      parseDirectAuthResponse(
        'refreshRecoveryStatus',
        409,
        {
          message: 'AUTH_RECOVERY_LEASE_EXPIRED',
          data: { ...lease, operationId: recoveryOperationId },
        },
        tuple,
      ),
    ).toThrow(DirectAuthProtocolError);
    expect(() =>
      parseDirectAuthResponse(
        'refreshRecoveryStatus',
        200,
        { message: 'refresh recovery status', data: { ...lease, status: 'RETRYABLE' } },
        tuple,
      ),
    ).toThrow(DirectAuthProtocolError);
    expect(() =>
      parseDirectAuthResponse(
        'refreshRecoveryStatus',
        202,
        { message: 'RECOVERY_IN_PROGRESS', data: lease },
        tuple,
      ),
    ).toThrow(DirectAuthProtocolError);
  });
  it('rejects numeric, noncanonical and overflowing 64-bit values', () => {
    for (const expires_in of [1, '01', '9223372036854775808']) {
      expect(() =>
        parseDirectAuthResponse('login', 200, {
          message: 'login success',
          data: { access_token: 'a', expires_in },
        }),
      ).toThrow(DirectAuthProtocolError);
    }
    expect(
      parseDirectAuthResponse('login', 200, {
        message: 'login success',
        data: { access_token: 'a', expires_in: '9223372036854775807' },
      }),
    ).toBeTruthy();
  });
  it('requires Retry-After on accepted throttling errors', () => {
    const error = { message: 'AUTH_OPERATION_RECEIPT_LIMIT', data: null };
    expect(() => parseDirectAuthResponse('login', 429, error)).toThrow(DirectAuthProtocolError);
    expect(() => parseDirectAuthResponse('login', 429, error, undefined, '5')).toThrow(
      DirectAuthApiError,
    );
  });
});

describe('operation identity fencing', () => {
  it('rejects stale rebootstrap and logout response identities', () => {
    const currentFlow = {
      flowId: recoveryOperationId,
      flowEpoch: '1',
      revision: '1',
      lifecycle: 'ANONYMOUS',
      authenticated: false,
      proofState: 'ACTIVE',
    };
    expect(() =>
      parseDirectAuthResponse(
        'rebootstrap',
        200,
        {
          message: 'auth flow rebootstrap',
          data: {
            flow: currentFlow,
            operationId,
            startingEpoch: tuple.startingEpoch,
            resultEpoch: '1',
            resultRevision: '1',
          },
        },
        tuple,
      ),
    ).toThrow(DirectAuthProtocolError);
    expect(() =>
      parseDirectAuthResponse(
        'logout',
        200,
        {
          message: 'logout committed',
          data: {
            logoutReceipt: {
              operationId: recoveryOperationId,
              committed: true,
              flowEpoch: '1',
              revision: '1',
              completedAt: '2026-01-01T00:00:00Z',
            },
          },
        },
        tuple,
      ),
    ).toThrow(DirectAuthProtocolError);
  });
});

describe('mutation storage gate', () => {
  it.each([
    ['bootstrap', 'BOOTSTRAP'],
    ['login', 'LOGIN'],
    ['loginRecovery', 'LOGIN_RECOVERY'],
    ['refresh', 'REFRESH'],
    ['logout', 'LOGOUT'],
    ['rebootstrap', 'REBOOTSTRAP'],
    ['refreshRecovery', 'REFRESH_RECOVERY'],
  ] as const)('blocks %s on readback mismatch', async (route, kind) => {
    const { requestDirectAuth } = await import('./directAuthHttp');
    const { createDirectAuthOperation } = await import('./directAuthOperationStore');
    const source = createDirectAuthOperation('REFRESH', flowId, tuple.startingEpoch, operationId);
    let target: string | null = null;
    const storage = {
      getItem: (key: string) =>
        key.endsWith(':REFRESH') && route === 'refreshRecovery'
          ? JSON.stringify(source)
          : target === null
            ? null
            : 'mismatch',
      setItem: (_key: string, value: string) => {
        target = value;
      },
      removeItem: () => {
        target = null;
      },
    } as unknown as Storage;
    const operation = createDirectAuthOperation(
      kind,
      route === 'bootstrap' ? null : flowId,
      route === 'bootstrap' ? null : tuple.startingEpoch,
      route === 'refreshRecovery' ? recoveryOperationId : operationId,
    );
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(
      requestDirectAuth({
        route,
        tuple: route === 'bootstrap' ? undefined : tuple,
        csrf: 'csrf',
        body: route === 'login' ? { email: 'a@b.com', password: 'secret' } : undefined,
        mutation: { kind, operation, storage },
        fetcher,
      }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(target).toBeNull();
  });
});
