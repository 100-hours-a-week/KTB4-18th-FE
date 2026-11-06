import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDirectAuthOperation,
  persistDirectAuthOperation,
  readDirectAuthOperation,
  clearDirectAuthOperation,
  clearExpiredDirectAuthRefreshOperation,
  snapshotDirectAuthOperations,
} from './directAuthOperationStore';
import { isDecimal64 } from './directAuthTypes';

const FLOW = '123e4567-e89b-42d3-a456-426614174000';
const ID = '123e4567-e89b-42d3-a456-426614174001';

describe('direct operation metadata', () => {
  beforeEach(() => sessionStorage.clear());

  it('persists only the four fields and preserves the fixed expiry', () => {
    const now = Date.now();
    const operation = createDirectAuthOperation('REFRESH', FLOW, '9223372036854775807', ID, now);
    persistDirectAuthOperation('REFRESH', operation);
    expect(readDirectAuthOperation('REFRESH')).toEqual(operation);
    expect(operation.expiresAt).toBe(now + 900000);
    expect(
      Object.keys(
        JSON.parse(sessionStorage.getItem('meomuneum:direct-auth-operation:REFRESH')!),
      ).sort(),
    ).toEqual(['expiresAt', 'flowId', 'operationId', 'startingEpoch']);
  });

  it('rejects noncanonical and out-of-range decimal values', () => {
    for (const value of ['00', '01', '-1', '9223372036854775808', 1])
      expect(isDecimal64(value)).toBe(false);
    expect(isDecimal64('0', true)).toBe(true);
    expect(isDecimal64('9223372036854775807')).toBe(true);
  });

  it('blocks when storage readback differs and preserves the unknown record', () => {
    const operation = createDirectAuthOperation('BOOTSTRAP', null, null, ID);
    const storage = {
      getItem: vi.fn().mockReturnValueOnce(null).mockReturnValueOnce('wrong'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    } as unknown as Storage;
    expect(() => persistDirectAuthOperation('BOOTSTRAP', operation, storage)).toThrow();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('does not clear a different flow', () => {
    persistDirectAuthOperation('LOGIN', createDirectAuthOperation('LOGIN', FLOW, '1', ID));
    expect(
      clearDirectAuthOperation('LOGIN', { ...readDirectAuthOperation('LOGIN')!, flowId: ID }),
    ).toBe(false);
    expect(readDirectAuthOperation('LOGIN')).not.toBeNull();
  });

  it('rejects extra persisted fields and overlong expiry', () => {
    sessionStorage.setItem(
      'meomuneum:direct-auth-operation:BOOTSTRAP',
      JSON.stringify({
        flowId: null,
        startingEpoch: null,
        operationId: ID,
        expiresAt: 1,
        token: 'secret',
      }),
    );
    expect(() => readDirectAuthOperation('BOOTSTRAP')).toThrow();
    expect(() => createDirectAuthOperation('BOOTSTRAP', null, null, ID, 1, 900001)).toThrow();
  });
});

describe('operation persistence failures', () => {
  it('removes a provisional value even if setItem writes before throwing', () => {
    const operation = createDirectAuthOperation('BOOTSTRAP', null, null, ID);
    let value: string | null = null;
    const storage = {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
        throw new Error();
      },
      removeItem: () => {
        value = null;
      },
    } as unknown as Storage;
    expect(() => persistDirectAuthOperation('BOOTSTRAP', operation, storage)).toThrow();
    expect(value).toBeNull();
  });
  it('preserves an existing unresolved operation and does not extend expiry', () => {
    const original = createDirectAuthOperation('LOGIN', FLOW, '1', ID);
    persistDirectAuthOperation('LOGIN', original);
    const replacement = { ...original, expiresAt: original.expiresAt - 1000 };
    expect(() => persistDirectAuthOperation('LOGIN', replacement)).toThrow();
    expect(readDirectAuthOperation('LOGIN')).toEqual(original);
  });
});

it('clears only the exact four fields and verifies empty readback', () => {
  sessionStorage.clear();
  const operation = createDirectAuthOperation('LOGIN', FLOW, '1', ID);
  persistDirectAuthOperation('LOGIN', operation);
  expect(clearDirectAuthOperation('LOGIN', { ...operation, startingEpoch: '2' })).toBe(false);
  expect(
    clearDirectAuthOperation('LOGIN', { ...operation, expiresAt: operation.expiresAt - 1 }),
  ).toBe(false);
  expect(clearDirectAuthOperation('LOGIN', operation)).toBe(true);
  expect(readDirectAuthOperation('LOGIN')).toBeNull();
});

it('clears an expired REFRESH only when its complete operation snapshot is unchanged and alone', () => {
  const operation = { flowId: FLOW, startingEpoch: '1', operationId: ID, expiresAt: 10_000 };
  sessionStorage.setItem('meomuneum:direct-auth-operation:REFRESH', JSON.stringify(operation));
  const snapshot = snapshotDirectAuthOperations();
  expect(clearExpiredDirectAuthRefreshOperation(snapshot, operation, sessionStorage, 10_000)).toBe(
    true,
  );
  expect(sessionStorage.getItem('meomuneum:direct-auth-operation:REFRESH')).toBeNull();
});

it('preserves an expired REFRESH when a companion marker exists or any marker changes', () => {
  const operation = { flowId: FLOW, startingEpoch: '1', operationId: ID, expiresAt: 10_000 };
  sessionStorage.setItem('meomuneum:direct-auth-operation:REFRESH', JSON.stringify(operation));
  sessionStorage.setItem(
    'meomuneum:direct-auth-operation:LOGIN',
    JSON.stringify({ ...operation, operationId: '123e4567-e89b-42d3-a456-426614174002' }),
  );
  const withCompanion = snapshotDirectAuthOperations();
  expect(
    clearExpiredDirectAuthRefreshOperation(withCompanion, operation, sessionStorage, 10_000),
  ).toBe(false);
  sessionStorage.removeItem('meomuneum:direct-auth-operation:LOGIN');
  const beforeRequest = snapshotDirectAuthOperations();
  sessionStorage.setItem(
    'meomuneum:direct-auth-operation:REFRESH',
    JSON.stringify({ ...operation, expiresAt: operation.expiresAt + 1 }),
  );
  expect(
    clearExpiredDirectAuthRefreshOperation(beforeRequest, operation, sessionStorage, 10_000),
  ).toBe(false);
  expect(readDirectAuthOperation('REFRESH')?.expiresAt).toBe(10_001);
});
