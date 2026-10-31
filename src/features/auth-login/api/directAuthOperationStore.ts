import {
  isDecimal64,
  isUuid,
  type DirectAuthOperation,
  type DirectAuthOperationKind,
} from './directAuthTypes';

const PREFIX = 'meomuneum:direct-auth-operation:';
const MAX_TTL_MS = 900_000;

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
        if (previous === null) storage.removeItem(key);
        else storage.setItem(key, previous);
      } catch {
        throw new DirectAuthStorageError();
      }
    }
    throw new DirectAuthStorageError();
  }
}

export function clearDirectAuthOperation(
  kind: DirectAuthOperationKind,
  flowId: string | null,
  operationId: string,
  storage: Storage = sessionStorage,
): boolean {
  try {
    const current = readDirectAuthOperation(kind, storage);
    if (!current || current.flowId !== flowId || current.operationId !== operationId) return false;
    storage.removeItem(PREFIX + kind);
    return storage.getItem(PREFIX + kind) === null;
  } catch {
    throw new DirectAuthStorageError();
  }
}
