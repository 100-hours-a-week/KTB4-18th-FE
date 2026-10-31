import { describe, expect, it } from 'vitest';
import {
  DirectAuthApiError,
  DirectAuthProtocolError,
  parseDirectAuthResponse,
} from './directAuthHttp';

const id = '123e4567-e89b-42d3-a456-426614174000';
const date = '2026-01-01T00:00:00Z';
const fields = { clientExpiresAt: '9007199254740991', effectiveExpiresAt: '1' };
const common = { flowId: id, operationId: id, recoveryOperationId: id, startingEpoch: '1' };
const statusData = {
  ...common,
  status: 'IN_PROGRESS',
  leaseExpiresAt: date,
  resultEpoch: null,
  resultRevision: null,
  ...fields,
};
const flow = {
  flowId: id,
  flowEpoch: '1',
  revision: '1',
  lifecycle: 'ANONYMOUS',
  authenticated: false,
  proofState: 'ACTIVE',
};
const operation = {
  flowId: id,
  startingEpoch: '1',
  operationId: id,
  kind: 'REFRESH',
  status: 'IN_PROGRESS',
  resultEpoch: null,
  resultRevision: null,
  reasonCode: null,
  leaseExpiresAt: date,
  receiptExpiresAt: null,
  ...fields,
};
const samples = [
  ['currentOperation', 200, 'current auth operation', { flow, operation }],
  ['refreshRecoveryStatus', 200, 'refresh recovery status', statusData],
  ['refreshRecoveryCurrent', 200, 'current refresh recovery', statusData],
  [
    'refreshRecoveryStatus',
    409,
    'AUTH_RECOVERY_LEASE_EXPIRED',
    { ...statusData, status: 'LEASE_EXPIRED' },
  ],
  [
    'refreshRecoveryCurrent',
    409,
    'AUTH_RECOVERY_LEASE_EXPIRED',
    { ...statusData, status: 'LEASE_EXPIRED' },
  ],
] as const;

describe('expiry response contract', () => {
  it.each(samples)('validates both required fields for %s %i', (route, status, message, data) => {
    const check = (expiry: Record<string, unknown>) => {
      const payload =
        route === 'currentOperation'
          ? { flow, operation: { ...operation, ...expiry } }
          : { ...data, ...expiry };
      return () => parseDirectAuthResponse(route, status, { message, data: payload });
    };
    const accepted = (fn: () => unknown) =>
      status === 409 ? expect(fn).toThrow(DirectAuthApiError) : expect(fn).not.toThrow();
    const missingData =
      route === 'currentOperation' ? { flow, operation: { ...operation } } : { ...data };
    for (const key of ['clientExpiresAt', 'effectiveExpiresAt'] as const) {
      const target =
        route === 'currentOperation'
          ? (missingData as { operation: Record<string, unknown> }).operation
          : (missingData as Record<string, unknown>);
      const original = target[key];
      delete target[key];
      expect(() => parseDirectAuthResponse(route, status, { message, data: missingData })).toThrow(
        DirectAuthProtocolError,
      );
      target[key] = original;
    }
    accepted(check(fields));
    accepted(
      check({ clientExpiresAt: '9007199254740991', effectiveExpiresAt: '9007199254740991' }),
    );
    accepted(
      check({ clientExpiresAt: '9007199254740991', effectiveExpiresAt: '9007199254740990' }),
    );
    expect(
      check({ clientExpiresAt: '9007199254740990', effectiveExpiresAt: '9007199254740991' }),
    ).toThrow(DirectAuthProtocolError);
    accepted(check({ clientExpiresAt: null, effectiveExpiresAt: null }));
    for (const key of ['clientExpiresAt', 'effectiveExpiresAt']) {
      for (const value of [
        undefined,
        1,
        '',
        '0',
        '01',
        '-1',
        '1e3',
        '9007199254740992',
        '99999999999999999',
        null,
      ]) {
        expect(check({ [key]: value })).toThrow(DirectAuthProtocolError);
      }
    }
  });
  it('enforces null fields for non-refresh and absent or expired recovery', () => {
    for (const kind of ['LOGIN', 'LOGOUT']) {
      expect(() =>
        parseDirectAuthResponse('currentOperation', 200, {
          message: 'current auth operation',
          data: { flow, operation: { ...operation, kind } },
        }),
      ).toThrow(DirectAuthProtocolError);
    }
    for (const [route, state] of [
      ['refreshRecoveryStatus', 'NOT_RECEIVED'],
      ['refreshRecoveryCurrent', 'NONE'],
      ['refreshRecoveryCurrent', 'EXPIRED'],
    ] as const) {
      const data = {
        ...statusData,
        status: state,
        leaseExpiresAt: null,
        recoveryOperationId: state === 'NONE' ? null : id,
      };
      const message =
        route === 'refreshRecoveryStatus' ? 'refresh recovery status' : 'current refresh recovery';
      expect(() => parseDirectAuthResponse(route, 200, { message, data })).toThrow(
        DirectAuthProtocolError,
      );
      expect(() =>
        parseDirectAuthResponse(route, 200, {
          message,
          data: { ...data, clientExpiresAt: null, effectiveExpiresAt: null },
        }),
      ).not.toThrow();
    }
  });
  it('restricts INVALID_CLIENT_EXPIRY to the two POST routes and status 400', () => {
    const body = { message: 'INVALID_CLIENT_EXPIRY', data: null };
    for (const route of ['refresh', 'refreshRecovery'] as const) {
      expect(() => parseDirectAuthResponse(route, 400, body)).toThrow(DirectAuthApiError);
      expect(() => parseDirectAuthResponse(route, 409, body)).toThrow(DirectAuthProtocolError);
    }
    for (const route of ['refreshRecoveryStatus', 'refreshRecoveryCurrent', 'logout'] as const) {
      expect(() => parseDirectAuthResponse(route, 400, body)).toThrow(DirectAuthProtocolError);
    }
  });
});
