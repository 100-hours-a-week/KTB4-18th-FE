import { QueueRequestError } from './loginQueueErrors';

export const CREATE_KEY_STORAGE = 'meomuneum:queue-create-idempotency';
export const QUEUE_GENERATION_STORAGE = 'meomuneum:queue-generation';
export const LOGIN_OPERATION_STORAGE = 'meomuneum:queue-login-operation';
export const LOGOUT_QUEUE_RESET_STORAGE = 'meomuneum:queue-logout-reset';
export const LOGIN_OPERATION_TTL_MS = 15 * 60 * 1000;
export const MAX_AUTOMATIC_CREATE_RETRIES = 3;
export const RETRY_AFTER_FALLBACK_MS = 5_000;
export const QUEUE_CREATE_DEADLINE_MS = 25 * 60 * 1000;

export type PersistedMarker = {
  id: string;
  createdAt: number;
  deadlineAt?: number;
  expiresAt?: number;
  generation?: string;
  status?: 'ACTIVE' | 'CANCEL_REQUESTED';
  cancelTarget?: 'CURRENT_TICKET' | 'IDEMPOTENCY_KEY';
  retryCount?: number;
  capacityWaitCount?: number;
  lastFailureKind?: 'CAPACITY' | 'TRANSIENT';
  lastAttemptAt?: number;
  nextAttemptAt?: number;
  retryAfterMs?: number;
};

export type LogoutQueueResetMarker = { eventId: string; generation: string };

const handledLogoutResetIds = new Set<string>();

export const retryBaselines = new Map<string, { startedAt: number; delayMs: number }>();

export function storage(): Storage {
  return window.localStorage;
}

export function newMarker(ttlMs?: number): PersistedMarker {
  const now = Date.now();
  return { id: crypto.randomUUID(), createdAt: now, ...(ttlMs ? { expiresAt: now + ttlMs } : {}) };
}

export function queueGeneration(): string {
  try {
    const value = storage().getItem(QUEUE_GENERATION_STORAGE);
    if (value) return value;
    const next = crypto.randomUUID();
    storage().setItem(QUEUE_GENERATION_STORAGE, next);
    return next;
  } catch {
    throw new QueueRequestError(null);
  }
}

export function getLoginQueueGeneration(): string {
  return queueGeneration();
}

export function beginQueueGeneration(): void {
  try {
    storage().setItem(QUEUE_GENERATION_STORAGE, crypto.randomUUID());
    storage().removeItem(LOGIN_OPERATION_STORAGE);
  } catch {
    throw new QueueRequestError(null);
  }
}

export function invalidateLogoutQueueReset(): void {
  try {
    storage().removeItem(LOGOUT_QUEUE_RESET_STORAGE);
  } catch {
    throw new QueueRequestError(null);
  }
}

export function persistLogoutQueueReset(generation: string): LogoutQueueResetMarker {
  const event = { eventId: crypto.randomUUID(), generation };
  try {
    storage().setItem(LOGOUT_QUEUE_RESET_STORAGE, JSON.stringify(event));
  } catch {
    throw new QueueRequestError(null);
  }
  return event;
}

export function consumeLogoutQueueReset(eventId: string | undefined, generation: string): boolean {
  if (!eventId || handledLogoutResetIds.has(eventId)) return false;
  try {
    const pending = JSON.parse(
      storage().getItem(LOGOUT_QUEUE_RESET_STORAGE) ?? 'null',
    ) as LogoutQueueResetMarker | null;
    if (
      pending?.eventId !== eventId ||
      pending.generation !== generation ||
      storage().getItem(QUEUE_GENERATION_STORAGE) !== generation
    )
      return false;
    handledLogoutResetIds.add(eventId);
    return true;
  } catch {
    return false;
  }
}

export function readMarker(key: string): PersistedMarker | null {
  try {
    const value = storage().getItem(key);
    if (!value) return null;
    const marker = JSON.parse(value) as PersistedMarker;
    if (
      typeof marker.id !== 'string' ||
      (key !== CREATE_KEY_STORAGE &&
        typeof marker.expiresAt === 'number' &&
        marker.expiresAt <= Date.now())
    ) {
      storage().removeItem(key);
      return null;
    }
    return marker;
  } catch {
    throw new QueueRequestError(null);
  }
}

export function writeMarker(key: string, marker: PersistedMarker): void {
  try {
    storage().setItem(key, JSON.stringify(marker));
  } catch {
    throw new QueueRequestError(null);
  }
}

export function clearCreateRetryMarker(): void {
  const marker = readMarker(CREATE_KEY_STORAGE);
  if (!marker) return;
  try {
    storage().removeItem(CREATE_KEY_STORAGE);
    retryBaselines.delete(marker.id);
  } catch {
    throw new QueueRequestError(null);
  }
}

export function calculateQueueCreateRetryDelayMs(
  retryNumber: number,
  retryAfterSeconds: number | null,
  random = Math.random(),
): number {
  const floor = Math.max(RETRY_AFTER_FALLBACK_MS, (retryAfterSeconds ?? 0) * 1000);
  const jitterWidth = Math.min(5_000 * 2 ** (retryNumber - 1), 60_000);
  return floor + Math.floor(random * jitterWidth);
}

export function calculateQueueStatusRetryDelayMs(
  retryNumber: number,
  retryAfterSeconds: number | null,
  random = Math.random(),
): number {
  const floor = Math.max(10_000, (retryAfterSeconds ?? 0) * 1000);
  const jitterWidth = Math.min(5_000 * 2 ** Math.max(0, retryNumber - 1), 30_000);
  return floor + Math.floor(random * jitterWidth);
}

export function recordCreateRetryWait(
  marker: PersistedMarker,
  delayMs: number,
  failureKind: 'CAPACITY' | 'TRANSIENT',
): void {
  const now = Date.now();
  const next = {
    ...marker,
    status: 'ACTIVE' as const,
    capacityWaitCount:
      failureKind === 'CAPACITY' ? (marker.capacityWaitCount ?? 0) + 1 : marker.capacityWaitCount,
    lastFailureKind: failureKind,
    nextAttemptAt: now + delayMs,
    retryAfterMs: delayMs,
  };
  writeMarker(CREATE_KEY_STORAGE, next);
  retryBaselines.set(marker.id, { startedAt: performance.now(), delayMs });
}

export function getQueueCreateRetryDelayMs(): number | null {
  const marker = readMarker(CREATE_KEY_STORAGE);
  if (!marker?.nextAttemptAt) return null;
  const baseline = retryBaselines.get(marker.id);
  if (baseline) return Math.max(0, baseline.delayMs - (performance.now() - baseline.startedAt));
  const delayMs = Math.max(1_000, marker.retryAfterMs ?? RETRY_AFTER_FALLBACK_MS);
  retryBaselines.set(marker.id, { startedAt: performance.now(), delayMs });
  return delayMs;
}

export function getNextQueueCreateAttemptAt(): number | null {
  return readMarker(CREATE_KEY_STORAGE)?.nextAttemptAt ?? null;
}
