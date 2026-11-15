import {
  isDecimal64,
  isUuid,
  type DirectAuthOperation,
  type DirectAuthOperationKind,
} from './directAuthTypes';

const PREFIX = 'meomuneum:direct-auth-operation:';
const MAX_TTL_MS = 900_000;
const OPERATION_KINDS: DirectAuthOperationKind[] = [
  'BOOTSTRAP',
  'LOGIN',
  'LOGIN_RECOVERY',
  'REFRESH',
  'LOGOUT',
  'REBOOTSTRAP',
  'REFRESH_RECOVERY',
];

export type DirectAuthOperationSnapshot = Record<DirectAuthOperationKind, string | null>;

export class DirectAuthStorageError extends Error {
  constructor() {
    super('Unable to safely store the authentication operation');
    this.name = 'DirectAuthStorageError';
  }
}

function valid(kind: DirectAuthOperationKind, value: unknown): value is DirectAuthOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).sort().join(',') !== 'expiresAt,flowId,operationId,startingEpoch')
    return false;
  const flowValid =
    kind === 'BOOTSTRAP'
      ? item.flowId === null && item.startingEpoch === null
      : isUuid(item.flowId) && isDecimal64(item.startingEpoch);
  return (
    flowValid &&
    isUuid(item.operationId) &&
    Number.isSafeInteger(item.expiresAt) &&
    (item.expiresAt as number) > 0
  );
}

export function createDirectAuthOperation(
  kind: DirectAuthOperationKind,
  flowId: string | null,
  startingEpoch: string | null,
  operationId: string,
  now = Date.now(),
  ttlMs = MAX_TTL_MS,
): DirectAuthOperation {
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(ttlMs) ||
    ttlMs <= 0 ||
    ttlMs > MAX_TTL_MS
  )
    throw new DirectAuthStorageError();
  const item = { flowId, startingEpoch, operationId, expiresAt: now + ttlMs };
  if (!valid(kind, item)) throw new DirectAuthStorageError();
  return item;
}

export function readDirectAuthOperation(
  kind: DirectAuthOperationKind,
  storage: Storage = sessionStorage,
): DirectAuthOperation | null {
  try {
    const raw = storage.getItem(PREFIX + kind);
    if (raw === null) return null;
    const item: unknown = JSON.parse(raw);
    if (!valid(kind, item) || item.expiresAt > Date.now() + MAX_TTL_MS)
      throw new DirectAuthStorageError();
    return item;
  } catch {
    throw new DirectAuthStorageError();
  }
}

export function persistDirectAuthOperation(
  kind: DirectAuthOperationKind,
  item: DirectAuthOperation,
  storage: Storage = sessionStorage,
): void {
  if (
    !valid(kind, item) ||
    item.expiresAt <= Date.now() ||
    item.expiresAt > Date.now() + MAX_TTL_MS
  )
    throw new DirectAuthStorageError();
  const key = PREFIX + kind;
  const serialized = JSON.stringify(item);
  let previous: string | null = null;
  let didWrite = false;
  try {
    previous = storage.getItem(key);
    if (previous !== null && previous !== serialized) throw new DirectAuthStorageError();
    didWrite = true;
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) throw new DirectAuthStorageError();
  } catch {
    if (didWrite) {
      try {
        if (storage.getItem(key) === serialized) {
          if (previous === null) storage.removeItem(key);
          else storage.setItem(key, previous);
        }
      } catch {
        throw new DirectAuthStorageError();
      }
    }
    throw new DirectAuthStorageError();
  }
}

export function sameDirectAuthOperation(a: DirectAuthOperation, b: DirectAuthOperation): boolean {
  return (
    a.flowId === b.flowId &&
    a.startingEpoch === b.startingEpoch &&
    a.operationId === b.operationId &&
    a.expiresAt === b.expiresAt
  );
}

export function snapshotDirectAuthOperations(
  storage: Storage = sessionStorage,
): DirectAuthOperationSnapshot {
  try {
    return Object.fromEntries(
      OPERATION_KINDS.map((kind) => [kind, storage.getItem(PREFIX + kind)]),
    ) as DirectAuthOperationSnapshot;
  } catch {
    throw new DirectAuthStorageError();
  }
}

export function clearExpiredDirectAuthRefreshOperation(
  snapshot: DirectAuthOperationSnapshot,
  expected: DirectAuthOperation,
  storage: Storage = sessionStorage,
  now = Date.now(),
): boolean {
  if (!Number.isSafeInteger(now) || expected.expiresAt > now) return false;
  if (OPERATION_KINDS.some((kind) => kind !== 'REFRESH' && snapshot[kind] !== null)) return false;
  const expectedRaw = JSON.stringify(expected);
  if (snapshot.REFRESH !== expectedRaw) return false;
  try {
    const current = snapshotDirectAuthOperations(storage);
    if (OPERATION_KINDS.some((kind) => current[kind] !== snapshot[kind])) return false;
    storage.removeItem(PREFIX + 'REFRESH');
    if (storage.getItem(PREFIX + 'REFRESH') !== null) throw new DirectAuthStorageError();
    return true;
  } catch {
    throw new DirectAuthStorageError();
  }
}

export function clearDirectAuthOperation(
  kind: DirectAuthOperationKind,
  expected: DirectAuthOperation,
  storage: Storage = sessionStorage,
): boolean {
  try {
    const current = readDirectAuthOperation(kind, storage);
    if (!current || !sameDirectAuthOperation(current, expected)) return false;
    storage.removeItem(PREFIX + kind);
    if (storage.getItem(PREFIX + kind) !== null) throw new DirectAuthStorageError();
    return true;
  } catch {
    throw new DirectAuthStorageError();
  }
}
