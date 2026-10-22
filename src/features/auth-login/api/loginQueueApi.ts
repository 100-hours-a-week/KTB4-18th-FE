import {
  assertAuthEpochReadable,
  getCsrfToken,
  runAuthTransition,
  setAccessToken,
} from './authSession';
import { probeAuthCapabilities } from './authCapabilities';
import { QueueRequestError } from './loginQueueErrors';
import {
  beginLogoutCleanupGate,
  completeLogoutCleanupGate,
  isLogoutCleanupPending,
} from './logoutCleanupGate';
import {
  abortActiveCreate,
  clearActiveCreateController,
  publishQueueSignal,
  QUEUE_FLOW_LOCK,
  registerActiveCreateController,
} from './loginQueueCoordination';
export { publishQueueSignal, subscribeQueueSignals } from './loginQueueCoordination';
export type { QueueSignal } from './loginQueueCoordination';
import {
  beginQueueGeneration,
  calculateQueueCreateRetryDelayMs,
  clearCreateRetryMarker,
  calculateQueueStatusRetryDelayMs,
  invalidateLogoutQueueReset,
  newMarker,
  persistLogoutQueueReset,
  queueGeneration,
  readMarker,
  recordCreateRetryWait,
  retryBaselines,
  storage,
  writeMarker,
  CREATE_KEY_STORAGE,
  LOGIN_OPERATION_STORAGE,
  LOGIN_OPERATION_TTL_MS,
  MAX_AUTOMATIC_CREATE_RETRIES,
  QUEUE_CREATE_DEADLINE_MS,
} from './loginQueuePersistence';
export {
  calculateQueueCreateRetryDelayMs,
  calculateQueueStatusRetryDelayMs,
  getLoginQueueGeneration,
  getNextQueueCreateAttemptAt,
  getQueueCreateRetryDelayMs,
} from './loginQueuePersistence';
import {
  errorCode,
  fetchWithTimeout,
  promiseWithTimeout,
  readTicket,
  requestUrl,
  REQUEST_TIMEOUT_MS,
  retryAfter,
} from './loginQueueHttp';
import type { LoginQueueTicket } from './loginQueueHttp';
export { parseQueueRetryAfter } from './loginQueueHttp';
export type { LoginOutcome, LoginQueueStatus, LoginQueueTicket } from './loginQueueHttp';

export type LoginQueueStartResult = {
  ticket: LoginQueueTicket;
  queueGeneration: string;
};

export type LoginQueueReconciliationResult = {
  ticket: LoginQueueTicket;
  queueGeneration: string;
};

export { QueueRequestError } from './loginQueueErrors';
export { promiseWithTimeout } from './loginQueueHttp';

const QUEUE_LOCK_WAIT_MS = 15_000;
const CANCEL_TIMEOUT_MS = 45_000;
const MAX_STATUS_RECONCILIATION_ATTEMPTS = 3;
const STATUS_RECONCILIATION_WINDOW_MS = 60_000;
const LOGIN_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertLogoutCleanupComplete(): void {
  if (isLogoutCleanupPending()) throw new QueueRequestError(409, 'LOGOUT_CLEANUP_PENDING');
  try {
    assertAuthEpochReadable();
  } catch {
    throw new QueueRequestError(null, 'AUTH_STATE_UNAVAILABLE');
  }
}

type ApiEnvelope<T> = { message?: string; data?: T | null };
type LoginSuccessEnvelope = {
  message: 'login success';
  data: { access_token: string; expires_in: number };
};

async function requestTicketStatus(signal?: AbortSignal): Promise<LoginQueueTicket> {
  assertLogoutCleanupComplete();
  let response: Response;
  try {
    response = await fetchWithTimeout(requestUrl('login-queue/tickets/current'), {
      credentials: 'include',
      cache: 'no-store',
      signal,
    });
  } catch {
    throw new QueueRequestError(null);
  }
  assertLogoutCleanupComplete();
  if (response.status === 404 || response.status === 410) {
    throw new QueueRequestError(
      response.status,
      response.status === 404 ? 'TICKET_UNKNOWN' : 'TICKET_EXPIRED',
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      (ApiEnvelope<null> & { code?: string }) | null;
    throw new QueueRequestError(response.status, errorCode(body), retryAfter(response));
  }
  const ticket = await readTicket(response);
  assertLogoutCleanupComplete();
  return { ...ticket, statusFetchedAt: Date.now() };
}

async function createTicketWithKey(
  idempotencyKey: string,
  expectedGeneration: string,
): Promise<LoginQueueStartResult> {
  assertLogoutCleanupComplete();
  let response: Response;
  const controller = new AbortController();
  registerActiveCreateController(controller);
  try {
    response = await fetchWithTimeout(requestUrl('login-queue/tickets'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Idempotency-Key': idempotencyKey },
      signal: controller.signal,
    });
  } catch {
    throw new QueueRequestError(null);
  } finally {
    clearActiveCreateController(controller);
  }
  assertLogoutCleanupComplete();
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      (ApiEnvelope<null> & { code?: string }) | null;
    throw new QueueRequestError(response.status, errorCode(body), retryAfter(response));
  }
  const ticket = await readTicket(response);
  assertLogoutCleanupComplete();
  if (queueGeneration() !== expectedGeneration)
    throw new QueueRequestError(409, 'QUEUE_OPERATION_REPLACED');
  const pendingMarker = readMarker(CREATE_KEY_STORAGE);
  if (pendingMarker?.status === 'CANCEL_REQUESTED')
    throw new QueueRequestError(409, 'QUEUE_CANCEL_UNCONFIRMED');
  try {
    storage().removeItem(CREATE_KEY_STORAGE);
    retryBaselines.delete(idempotencyKey);
  } catch {
    throw new QueueRequestError(null);
  }
  const nextGeneration = beginQueueGeneration();
  return { ticket, queueGeneration: nextGeneration };
}

async function currentTicketBeforeCreate(
  expectedGeneration: string,
): Promise<LoginQueueTicket | null> {
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= MAX_STATUS_RECONCILIATION_ATTEMPTS; attempt += 1) {
    assertLogoutCleanupComplete();
    if (queueGeneration() !== expectedGeneration)
      throw new QueueRequestError(409, 'QUEUE_OPERATION_REPLACED');
    try {
      const ticket = await currentTicketIfPresent(
        undefined,
        () => queueGeneration() === expectedGeneration,
      );
      assertLogoutCleanupComplete();
      if (queueGeneration() !== expectedGeneration)
        throw new QueueRequestError(409, 'QUEUE_OPERATION_REPLACED');
      return ticket;
    } catch (error) {
      if (
        !(error instanceof QueueRequestError) ||
        ![429, 503].includes(error.status ?? 0) ||
        attempt === MAX_STATUS_RECONCILIATION_ATTEMPTS
      )
        throw error;
      const elapsed = Date.now() - startedAt;
      const remaining = STATUS_RECONCILIATION_WINDOW_MS - elapsed;
      const delayMs = calculateQueueStatusRetryDelayMs(attempt, error.retryAfterSeconds);
      if (remaining <= 0 || delayMs > remaining) {
        throw new QueueRequestError(
          error.status,
          'QUEUE_STATUS_RETRY_PAUSED',
          error.retryAfterSeconds,
        );
      }
      await wait(delayMs);
      assertLogoutCleanupComplete();
      if (queueGeneration() !== expectedGeneration)
        throw new QueueRequestError(409, 'QUEUE_OPERATION_REPLACED');
    }
  }
  throw new QueueRequestError(null, 'QUEUE_STATUS_RETRY_PAUSED');
}

async function cancelKnownCurrentTicket(): Promise<void> {
  const csrf = await getCsrfToken();
  const response = await fetchWithTimeout(requestUrl('login-queue/tickets/current'), {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRF-TOKEN': csrf },
  });
  if (response.status === 204) return;
  const body = (await response.json().catch(() => null)) as
    (ApiEnvelope<{ status?: string }> & { code?: string }) | null;
  if (response.status === 200 && body?.data?.status === 'CANCELLED') return;
  throw new QueueRequestError(
    response.status,
    errorCode(body) ?? 'QUEUE_CANCEL_UNCONFIRMED',
    retryAfter(response),
  );
}

function confirmQueueCancellation(generation: string) {
  try {
    storage().removeItem(CREATE_KEY_STORAGE);
    publishQueueSignal({ type: 'queue-create-cancelled', queueGeneration: generation });
    beginQueueGeneration();
    return { kind: 'confirmed' as const };
  } catch {
    throw new QueueRequestError(null, 'QUEUE_CANCEL_UNCONFIRMED');
  }
}

async function createUnderLock(expectedGeneration: string): Promise<LoginQueueStartResult | null> {
  const lockManager = navigator.locks;
  if (!lockManager?.request) throw new QueueRequestError(null, 'AUTH_CAPABILITY_UNAVAILABLE');
  return lockManager.request(
    QUEUE_FLOW_LOCK,
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      if (!lock) return null;
      assertLogoutCleanupComplete();
      if (queueGeneration() !== expectedGeneration)
        throw new QueueRequestError(409, 'QUEUE_OPERATION_REPLACED');
      let current = await currentTicketBeforeCreate(expectedGeneration);
      assertLogoutCleanupComplete();
      if (queueGeneration() !== expectedGeneration)
        throw new QueueRequestError(409, 'QUEUE_OPERATION_REPLACED');
      let marker = readMarker(CREATE_KEY_STORAGE);
      if (marker?.status === 'CANCEL_REQUESTED' && marker.cancelTarget) {
        if (current) {
          marker = {
            ...marker,
            generation: expectedGeneration,
            cancelTarget: 'CURRENT_TICKET',
          };
          writeMarker(CREATE_KEY_STORAGE, marker);
          await cancelKnownCurrentTicket();
          if (queueGeneration() !== expectedGeneration)
            throw new QueueRequestError(409, 'QUEUE_OPERATION_REPLACED');
          current = null;
          storage().removeItem(CREATE_KEY_STORAGE);
          retryBaselines.delete(marker.id);
          marker = null;
        } else if (marker.cancelTarget === 'CURRENT_TICKET') {
          storage().removeItem(CREATE_KEY_STORAGE);
          retryBaselines.delete(marker.id);
          marker = null;
        } else {
          marker = {
            ...marker,
            generation: expectedGeneration,
            status: 'ACTIVE',
            cancelTarget: undefined,
            retryCount: 0,
            lastAttemptAt: undefined,
            lastFailureKind: undefined,
            nextAttemptAt: undefined,
            retryAfterMs: undefined,
          };
          writeMarker(CREATE_KEY_STORAGE, marker);
        }
      }
      if (current) {
        let currentGeneration = expectedGeneration;
        if (marker) {
          storage().removeItem(CREATE_KEY_STORAGE);
          retryBaselines.delete(marker.id);
          currentGeneration = beginQueueGeneration();
        }
        return { ticket: current, queueGeneration: currentGeneration };
      }
      marker = readMarker(CREATE_KEY_STORAGE);
      if (marker?.status === 'CANCEL_REQUESTED') {
        if (!marker.cancelTarget) {
          marker = {
            ...marker,
            generation: expectedGeneration,
            status: 'ACTIVE',
            retryCount: 0,
            lastAttemptAt: undefined,
            lastFailureKind: undefined,
            nextAttemptAt: undefined,
            retryAfterMs: undefined,
          };
          writeMarker(CREATE_KEY_STORAGE, marker);
        }
      }
      if (marker?.generation && marker.generation !== expectedGeneration) {
        marker = {
          ...marker,
          generation: expectedGeneration,
          status: 'ACTIVE',
          retryCount: 0,
          lastAttemptAt: undefined,
          lastFailureKind: undefined,
          nextAttemptAt: undefined,
          retryAfterMs: undefined,
        };
        writeMarker(CREATE_KEY_STORAGE, marker);
      }
      if (!marker) {
        marker = {
          ...newMarker(),
          deadlineAt: Date.now() + QUEUE_CREATE_DEADLINE_MS,
          generation: expectedGeneration,
          status: 'ACTIVE',
          retryCount: 0,
        };
        writeMarker(CREATE_KEY_STORAGE, marker);
      }
      if (marker.deadlineAt === undefined) {
        marker = { ...marker, deadlineAt: marker.createdAt + QUEUE_CREATE_DEADLINE_MS };
        writeMarker(CREATE_KEY_STORAGE, marker);
      }
      if (marker.status === 'CANCEL_REQUESTED') throw new QueueRequestError(409, 'QUEUE_CANCELLED');
      if (marker.generation && marker.generation !== queueGeneration())
        throw new QueueRequestError(409, 'QUEUE_OPERATION_REPLACED');
      const deadlineAt = marker.deadlineAt ?? marker.createdAt + QUEUE_CREATE_DEADLINE_MS;
      if (Date.now() >= deadlineAt) throw new QueueRequestError(null, 'CREATE_DEADLINE_EXCEEDED');
      if (marker.nextAttemptAt && marker.nextAttemptAt > Date.now())
        throw new QueueRequestError(
          503,
          'QUEUE_RETRY_WAIT',
          Math.ceil((marker.nextAttemptAt - Date.now()) / 1000),
        );

      {
        const retryCount = marker.retryCount ?? 0;
        const waitingForCapacity = marker.lastFailureKind === 'CAPACITY';
        if (
          marker.lastAttemptAt &&
          !waitingForCapacity &&
          retryCount >= MAX_AUTOMATIC_CREATE_RETRIES
        ) {
          throw new QueueRequestError(null, 'CREATE_RETRIES_EXHAUSTED');
        }
        // Consume the shared budget before every same-key POST after the initial request.
        marker = {
          ...marker,
          retryCount: marker.lastAttemptAt && !waitingForCapacity ? retryCount + 1 : retryCount,
          lastAttemptAt: Date.now(),
          lastFailureKind: undefined,
          nextAttemptAt: undefined,
          retryAfterMs: undefined,
        };
        writeMarker(CREATE_KEY_STORAGE, marker);
        try {
          return await createTicketWithKey(marker.id, expectedGeneration);
        } catch (error) {
          if (!(error instanceof QueueRequestError)) throw error;
          if (queueGeneration() !== expectedGeneration)
            throw new QueueRequestError(409, 'QUEUE_OPERATION_REPLACED');
          const sharedMarker = readMarker(CREATE_KEY_STORAGE);
          if (sharedMarker?.status === 'CANCEL_REQUESTED')
            throw new QueueRequestError(409, 'QUEUE_CANCEL_UNCONFIRMED');
          const isAmbiguous =
            error.status === null ||
            (error.status !== null && error.status >= 500) ||
            ['REQUEST_AMBIGUOUS', 'AUTH_RESPONSE_TOO_LARGE'].includes(error.code ?? '');
          if (error.code === 'OPERATION_IN_PROGRESS' || isAmbiguous) {
            let ticket: LoginQueueTicket | null = null;
            try {
              ticket = await currentTicketBeforeCreate(expectedGeneration);
            } catch {
              // The same idempotency key remains the recovery path when status is unavailable.
            }
            if (ticket) {
              try {
                storage().removeItem(CREATE_KEY_STORAGE);
              } catch {
                throw new QueueRequestError(null);
              }
              const nextGeneration = beginQueueGeneration();
              return { ticket, queueGeneration: nextGeneration };
            }
          }
          if (Date.now() >= (marker.deadlineAt ?? marker.createdAt + QUEUE_CREATE_DEADLINE_MS))
            throw new QueueRequestError(error.status, 'CREATE_DEADLINE_EXCEEDED');
          const isKnownTransient = ['QUEUE_FULL', 'RATE_LIMITED', 'OPERATION_IN_PROGRESS'].includes(
            error.code ?? '',
          );
          const isTransient =
            isKnownTransient ||
            isAmbiguous ||
            error.status === null ||
            error.status === 429 ||
            (error.status !== null && error.status >= 500);
          if (!isTransient) {
            throw error;
          }
          const waitingForCapacity = error.status === 429 && error.code === 'QUEUE_FULL';
          if (!waitingForCapacity && (marker.retryCount ?? 0) >= MAX_AUTOMATIC_CREATE_RETRIES) {
            throw new QueueRequestError(error.status, 'CREATE_RETRIES_EXHAUSTED');
          }
          const retryNumber = waitingForCapacity
            ? (marker.capacityWaitCount ?? 0) + 1
            : (marker.retryCount ?? 0) + 1;
          const delayMs = calculateQueueCreateRetryDelayMs(retryNumber, error.retryAfterSeconds);
          recordCreateRetryWait(marker, delayMs, waitingForCapacity ? 'CAPACITY' : 'TRANSIENT');
          throw new QueueRequestError(error.status, 'CREATE_RETRYABLE');
        }
      }
    },
  );
}

async function currentTicketIfPresent(
  signal?: AbortSignal,
  canMutateMarker: () => boolean = () => true,
): Promise<LoginQueueTicket | null> {
  const expectedGeneration = queueGeneration();
  const markerBeforeRead = readMarker(CREATE_KEY_STORAGE);
  const mayClearMarker = () =>
    canMutateMarker() &&
    queueGeneration() === expectedGeneration &&
    readMarker(CREATE_KEY_STORAGE)?.id === markerBeforeRead?.id;
  try {
    const current = await requestTicketStatus(signal);
    if (['CANCELLED', 'EXPIRED'].includes(current.status) && mayClearMarker()) {
      clearCreateRetryMarker();
    }
    if (['CONSUMED', 'CANCELLED', 'EXPIRED'].includes(current.status)) {
      return null;
    }
    return current;
  } catch (error) {
    if (error instanceof QueueRequestError && error.status === 410) {
      if (mayClearMarker()) clearCreateRetryMarker();
      return null;
    }
    if (error instanceof QueueRequestError && error.status === 404) return null;
    throw error;
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function startOrResumeLoginQueue(): Promise<LoginQueueStartResult> {
  assertLogoutCleanupComplete();
  if (!probeAuthCapabilities().supported) {
    throw new QueueRequestError(null, 'AUTH_CAPABILITY_UNAVAILABLE');
  }
  invalidateLogoutQueueReset();
  const expectedGeneration = queueGeneration();
  let lockDeadline = Date.now() + QUEUE_LOCK_WAIT_MS;
  while (true) {
    if (queueGeneration() !== expectedGeneration)
      throw new QueueRequestError(409, 'QUEUE_OPERATION_REPLACED');
    if (Date.now() >= lockDeadline) throw new QueueRequestError(409, 'QUEUE_LOCK_TIMEOUT');
    const lockController = new AbortController();
    const lockTimer = window.setTimeout(
      () => lockController.abort(),
      Math.max(0, lockDeadline - Date.now()),
    );
    try {
      const result = await createUnderLock(expectedGeneration);
      assertLogoutCleanupComplete();
      if (result) return result;
      const remaining = lockDeadline - Date.now();
      if (remaining <= 0) throw new QueueRequestError(409, 'QUEUE_LOCK_TIMEOUT');
      await wait(Math.min(200 + Math.floor(Math.random() * 201), remaining));
      assertLogoutCleanupComplete();
    } catch (error) {
      if (lockController.signal.aborted) throw new QueueRequestError(409, 'QUEUE_LOCK_TIMEOUT');
      if (
        error instanceof QueueRequestError &&
        ['CREATE_RETRYABLE', 'QUEUE_RETRY_WAIT'].includes(error.code ?? '')
      ) {
        const marker = readMarker(CREATE_KEY_STORAGE);
        const deadlineAt =
          marker?.deadlineAt ?? (marker ? marker.createdAt + QUEUE_CREATE_DEADLINE_MS : Date.now());
        const remaining = Math.max(0, deadlineAt - Date.now());
        if (remaining <= 0) throw new QueueRequestError(error.status, 'CREATE_DEADLINE_EXCEEDED');
        const nextAttemptAt = marker?.nextAttemptAt ?? Date.now();
        const selectedWait = Math.max(0, nextAttemptAt - Date.now());
        if (selectedWait >= remaining) {
          await wait(remaining);
          throw new QueueRequestError(error.status, 'CREATE_DEADLINE_EXCEEDED');
        }
        await wait(selectedWait);
        assertLogoutCleanupComplete();
        lockDeadline = Date.now() + QUEUE_LOCK_WAIT_MS;
        continue;
      }
      throw error;
    } finally {
      window.clearTimeout(lockTimer);
    }
  }
}

export async function getLoginQueueStatus(): Promise<LoginQueueTicket> {
  assertLogoutCleanupComplete();
  const expectedGeneration = queueGeneration();
  const markerBeforeRead = readMarker(CREATE_KEY_STORAGE);
  const ticket = await requestTicketStatus();
  assertLogoutCleanupComplete();
  const markerAfterRead = readMarker(CREATE_KEY_STORAGE);
  if (
    queueGeneration() === expectedGeneration &&
    markerAfterRead?.id === markerBeforeRead?.id &&
    ['CANCELLED', 'EXPIRED'].includes(ticket.status)
  ) {
    clearCreateRetryMarker();
  }
  return ticket;
}

/** Performs a GET-only recovery check for an exhausted create operation. */
export async function reconcileLoginQueueStatus(): Promise<LoginQueueReconciliationResult> {
  assertLogoutCleanupComplete();
  const lockManager = navigator.locks;
  if (!lockManager?.request) throw new QueueRequestError(null, 'AUTH_CAPABILITY_UNAVAILABLE');
  return lockManager.request(
    QUEUE_FLOW_LOCK,
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      assertLogoutCleanupComplete();
      if (!lock) throw new QueueRequestError(409, 'QUEUE_LOCK_BUSY');
      const marker = readMarker(CREATE_KEY_STORAGE);
      if (marker?.status === 'CANCEL_REQUESTED')
        throw new QueueRequestError(409, 'QUEUE_CANCELLED');
      const expectedGeneration = queueGeneration();
      const ticket = await requestTicketStatus();
      assertLogoutCleanupComplete();
      if (queueGeneration() !== expectedGeneration)
        throw new QueueRequestError(409, 'QUEUE_TICKET_REPLACED');
      let reconciledGeneration = expectedGeneration;
      if (marker && readMarker(CREATE_KEY_STORAGE)?.id === marker.id) {
        storage().removeItem(CREATE_KEY_STORAGE);
        retryBaselines.delete(marker.id);
        reconciledGeneration = beginQueueGeneration();
      }
      return { ticket, queueGeneration: reconciledGeneration };
    },
  );
}

export async function cancelLoginQueue(): Promise<void> {
  assertLogoutCleanupComplete();
  const lockManager = navigator.locks;
  if (!lockManager?.request) throw new QueueRequestError(null, 'AUTH_CAPABILITY_UNAVAILABLE');
  const generation = queueGeneration();
  const flowStartedAt = Date.now();
  const flowController = new AbortController();
  const flowTimeout = window.setTimeout(() => flowController.abort(), CANCEL_TIMEOUT_MS);
  publishQueueSignal({ type: 'queue-cancel-requested', queueGeneration: generation });
  abortActiveCreate();
  let csrfRejected = false;
  try {
    while (Date.now() - flowStartedAt < CANCEL_TIMEOUT_MS && !flowController.signal.aborted) {
      const lockAttempt = lockManager.request(
        QUEUE_FLOW_LOCK,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) return { kind: 'busy' as const };
          assertLogoutCleanupComplete();
          if (flowController.signal.aborted || Date.now() - flowStartedAt >= CANCEL_TIMEOUT_MS) {
            throw new QueueRequestError(null, 'QUEUE_CANCEL_UNCONFIRMED');
          }
          if (queueGeneration() !== generation)
            throw new QueueRequestError(409, 'QUEUE_OPERATION_REPLACED');
          let marker = readMarker(CREATE_KEY_STORAGE);
          if (marker) {
            marker = { ...marker, status: 'CANCEL_REQUESTED' };
            writeMarker(CREATE_KEY_STORAGE, marker);
          }
          let current: LoginQueueTicket | null;
          try {
            current = await currentTicketIfPresent(flowController.signal);
            assertLogoutCleanupComplete();
          } catch (error) {
            if (error instanceof QueueRequestError && [429, 503].includes(error.status ?? 0)) {
              return { kind: 'retry' as const, delay: error.retryAfterSeconds ?? 1 };
            }
            throw error;
          }
          if (flowController.signal.aborted)
            throw new QueueRequestError(null, 'QUEUE_CANCEL_UNCONFIRMED');
          if (!current && !marker) return confirmQueueCancellation(generation);
          if (current && !marker) {
            marker = {
              ...newMarker(),
              generation,
              status: 'CANCEL_REQUESTED',
              cancelTarget: 'CURRENT_TICKET',
            };
            writeMarker(CREATE_KEY_STORAGE, marker);
          }
          if (marker) {
            marker = {
              ...marker,
              status: 'CANCEL_REQUESTED',
              cancelTarget: current ? 'CURRENT_TICKET' : 'IDEMPOTENCY_KEY',
            };
            writeMarker(CREATE_KEY_STORAGE, marker);
          }
          if (!current) {
            throw new QueueRequestError(null, 'QUEUE_CANCEL_UNCONFIRMED');
          }
          const csrf = await promiseWithTimeout(
            getCsrfToken(flowController.signal),
            Math.min(REQUEST_TIMEOUT_MS, CANCEL_TIMEOUT_MS - (Date.now() - flowStartedAt)),
            'QUEUE_CANCEL_UNCONFIRMED',
          );
          assertLogoutCleanupComplete();
          if (flowController.signal.aborted)
            throw new QueueRequestError(null, 'QUEUE_CANCEL_UNCONFIRMED');
          const response = await fetchWithTimeout(requestUrl('login-queue/tickets/current'), {
            method: 'DELETE',
            credentials: 'include',
            headers: { 'X-CSRF-TOKEN': csrf },
            signal: flowController.signal,
          });
          assertLogoutCleanupComplete();
          if (response.status === 204) return confirmQueueCancellation(generation);
          const body = (await response.json().catch(() => null)) as
            (ApiEnvelope<{ status?: string }> & { code?: string }) | null;
          if (response.status === 403) return { kind: 'csrf' as const };
          if (response.status === 409 || response.status === 503) {
            return { kind: 'retry' as const, delay: retryAfter(response) ?? 1 };
          }
          if (response.status !== 200 || body?.data?.status !== 'CANCELLED') {
            throw new QueueRequestError(response.status, errorCode(body), retryAfter(response));
          }
          return confirmQueueCancellation(generation);
        },
      );
      const outcome = await promiseWithTimeout(
        lockAttempt,
        Math.max(1, CANCEL_TIMEOUT_MS - (Date.now() - flowStartedAt)),
        'QUEUE_CANCEL_UNCONFIRMED',
      );
      if (outcome.kind === 'confirmed') return;
      if (outcome.kind === 'csrf') {
        if (csrfRejected) throw new QueueRequestError(403, 'QUEUE_CANCEL_UNCONFIRMED');
        csrfRejected = true;
      }
      if (outcome.kind === 'busy') await wait(100 + Math.floor(Math.random() * 151));
      else if (outcome.kind === 'retry') {
        await wait(
          Math.min(
            CANCEL_TIMEOUT_MS - (Date.now() - flowStartedAt),
            Math.max(1_000, outcome.delay * 1000),
          ),
        );
      }
    }
    throw new QueueRequestError(null, 'QUEUE_CANCEL_UNCONFIRMED');
  } catch (error) {
    publishQueueSignal({ type: 'queue-cancel-unconfirmed', queueGeneration: generation });
    if (error instanceof QueueRequestError) throw error;
    throw new QueueRequestError(null, 'QUEUE_CANCEL_UNCONFIRMED');
  } finally {
    window.clearTimeout(flowTimeout);
  }
}

export async function resetLoginQueueAfterLogout(): Promise<void> {
  beginLogoutCleanupGate();
  abortActiveCreate();
  const lockManager = navigator.locks;
  if (!lockManager?.request) throw new QueueRequestError(null, 'AUTH_CAPABILITY_UNAVAILABLE');
  let timedOut = false;
  const resetOperation = lockManager.request(QUEUE_FLOW_LOCK, { mode: 'exclusive' }, async () => {
    const ensureActive = () => {
      if (timedOut) throw new QueueRequestError(null, 'QUEUE_RESET_TIMEOUT');
    };
    ensureActive();
    const csrf = await getCsrfToken();
    ensureActive();
    const response = await fetchWithTimeout(requestUrl('login-queue/tickets/current'), {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'X-CSRF-TOKEN': csrf },
    });
    ensureActive();
    if (response.status !== 204) {
      throw new QueueRequestError(response.status, 'QUEUE_LOGOUT_CLEANUP_UNCONFIRMED');
    }
    const marker = readMarker(CREATE_KEY_STORAGE);
    ensureActive();
    try {
      storage().removeItem(CREATE_KEY_STORAGE);
      storage().removeItem(LOGIN_OPERATION_STORAGE);
    } catch {
      throw new QueueRequestError(null, 'QUEUE_LOGOUT_CLEANUP_UNCONFIRMED');
    }
    if (marker) retryBaselines.delete(marker.id);
    retryBaselines.clear();
    beginQueueGeneration();
    const generation = queueGeneration();
    const reset = persistLogoutQueueReset(generation);
    publishQueueSignal({
      type: 'queue-logout-reset',
      queueGeneration: generation,
      resetEventId: reset.eventId,
    });
    ensureActive();
    completeLogoutCleanupGate();
  });
  try {
    await promiseWithTimeout(resetOperation, 2_000, 'QUEUE_RESET_TIMEOUT');
  } catch (error) {
    timedOut = true;
    throw error;
  }
}

export async function resumeQueueAfterPageRestore(): Promise<LoginQueueTicket | null> {
  assertLogoutCleanupComplete();
  return currentTicketIfPresent();
}

export function getLoginOperationId(): string {
  assertLogoutCleanupComplete();
  const generation = queueGeneration();
  const marker = readMarker(LOGIN_OPERATION_STORAGE);
  if (marker && marker.generation === generation) return marker.id;
  const next = { ...newMarker(LOGIN_OPERATION_TTL_MS), generation };
  writeMarker(LOGIN_OPERATION_STORAGE, next);
  return next.id;
}

export function clearLoginOperationId(): void {
  assertLogoutCleanupComplete();
  try {
    storage().removeItem(LOGIN_OPERATION_STORAGE);
  } catch {
    throw new QueueRequestError(null);
  }
}

export async function retireAmbiguousLoginOperation(): Promise<void> {
  assertLogoutCleanupComplete();
  const lockManager = navigator.locks;
  if (!lockManager?.request) throw new QueueRequestError(null, 'AUTH_CAPABILITY_UNAVAILABLE');
  await lockManager.request(QUEUE_FLOW_LOCK, { mode: 'exclusive' }, () => {
    assertLogoutCleanupComplete();
    const marker = readMarker(CREATE_KEY_STORAGE);
    try {
      storage().removeItem(CREATE_KEY_STORAGE);
      storage().removeItem(LOGIN_OPERATION_STORAGE);
    } catch {
      throw new QueueRequestError(null, 'AUTH_STATE_UNAVAILABLE');
    }
    if (marker) retryBaselines.delete(marker.id);
    const generation = beginQueueGeneration();
    publishQueueSignal({ type: 'queue-attempt-consumed', queueGeneration: generation });
  });
}

export async function submitQueuedLogin(
  request: { email: string; password: string },
  expectedGeneration = queueGeneration(),
  diagnosticCorrelationId?: string,
): Promise<LoginSuccessEnvelope> {
  assertLogoutCleanupComplete();
  if (
    typeof request.email !== 'string' ||
    !request.email.trim() ||
    !LOGIN_EMAIL_PATTERN.test(request.email) ||
    typeof request.password !== 'string' ||
    !request.password.trim()
  ) {
    throw new QueueRequestError(null, 'INVALID_LOGIN_REQUEST');
  }

  return runAuthTransition(async () => {
    assertLogoutCleanupComplete();
    const lockManager = navigator.locks;
    if (!lockManager?.request) throw new QueueRequestError(null, 'AUTH_CAPABILITY_UNAVAILABLE');
    const result = await lockManager.request(
      QUEUE_FLOW_LOCK,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        assertLogoutCleanupComplete();
        if (!lock) return { kind: 'peer-owned' as const };
        if (queueGeneration() !== expectedGeneration) return { kind: 'ticket-replaced' as const };
        const operationId = getLoginOperationId();
        assertLogoutCleanupComplete();
        let response: Response;
        try {
          response = await fetchWithTimeout(requestUrl('login'), {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-Login-Operation-Id': operationId,
              ...(diagnosticCorrelationId
                ? { 'X-Auth-Queue-Correlation': diagnosticCorrelationId }
                : {}),
            },
            body: JSON.stringify(request),
          });
        } catch {
          if (queueGeneration() !== expectedGeneration) return { kind: 'ticket-replaced' as const };
          return { kind: 'ambiguous' as const, status: null, retryAfter: null };
        }
        assertLogoutCleanupComplete();
        if (queueGeneration() !== expectedGeneration) return { kind: 'ticket-replaced' as const };
        const body = (await response.json().catch(() => null)) as ApiEnvelope<{
          access_token?: string;
          expires_in?: number;
        }> | null;
        if (queueGeneration() !== expectedGeneration) return { kind: 'ticket-replaced' as const };
        if (
          response.ok &&
          (body?.message === 'login success' || body?.message === 'login recovered') &&
          typeof body.data?.access_token === 'string' &&
          typeof body.data.expires_in === 'number'
        ) {
          assertLogoutCleanupComplete();
          if (queueGeneration() !== expectedGeneration) return { kind: 'ticket-replaced' as const };
          setAccessToken(body.data.access_token);
          return {
            kind: 'success' as const,
            body: body as LoginSuccessEnvelope,
          };
        }
        if (response.status === 401) {
          beginQueueGeneration();
          publishQueueSignal({
            type: 'queue-attempt-consumed',
            queueGeneration: queueGeneration(),
          });
          return {
            kind: 'invalid' as const,
            code: body?.message ?? null,
            queueGeneration: queueGeneration(),
          };
        }
        if (response.status === 429) {
          return {
            kind: 'retry' as const,
            code: body?.message ?? null,
            retryAfter: retryAfter(response),
          };
        }
        return {
          kind: 'ambiguous' as const,
          code: body?.message ?? null,
          status: response.status,
          retryAfter: retryAfter(response),
        };
      },
    );

    if (result.kind === 'peer-owned') throw new QueueRequestError(409, 'QUEUE_LOGIN_IN_PROGRESS');
    if (result.kind === 'ticket-replaced')
      throw new QueueRequestError(409, 'QUEUE_TICKET_REPLACED');
    if (result.kind === 'success') return result.body;
    if (result.kind === 'invalid')
      throw new QueueRequestError(401, result.code, null, result.queueGeneration);
    if (result.kind === 'retry') throw new QueueRequestError(429, result.code, result.retryAfter);
    throw new QueueRequestError(
      result.status ?? null,
      result.code ?? 'LOGIN_RESULT_AMBIGUOUS',
      result.retryAfter ?? null,
    );
  });
}

export async function recoverQueuedLogin(
  operationId?: string,
  expectedGeneration = queueGeneration(),
  isCurrent: () => boolean = () => true,
): Promise<LoginSuccessEnvelope> {
  if (!isCurrent()) throw new QueueRequestError(409, 'QUEUE_TICKET_REPLACED');
  assertLogoutCleanupComplete();
  const csrf = await getCsrfToken();
  assertLogoutCleanupComplete();
  if (!isCurrent() || queueGeneration() !== expectedGeneration)
    throw new QueueRequestError(409, 'QUEUE_TICKET_REPLACED');
  return runAuthTransition(async () => {
    assertLogoutCleanupComplete();
    if (!isCurrent() || queueGeneration() !== expectedGeneration)
      throw new QueueRequestError(409, 'QUEUE_TICKET_REPLACED');
    const lockManager = navigator.locks;
    if (!lockManager?.request) throw new QueueRequestError(null, 'AUTH_CAPABILITY_UNAVAILABLE');
    const recovery = await lockManager.request(
      QUEUE_FLOW_LOCK,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        assertLogoutCleanupComplete();
        if (!lock) throw new QueueRequestError(409, 'QUEUE_LOGIN_IN_PROGRESS');
        if (!isCurrent() || queueGeneration() !== expectedGeneration)
          throw new QueueRequestError(409, 'QUEUE_TICKET_REPLACED');
        const stableOperationId = operationId ?? getLoginOperationId();
        let response: Response;
        try {
          response = await fetchWithTimeout(requestUrl('login/recovery'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-CSRF-TOKEN': csrf, 'X-Login-Operation-Id': stableOperationId },
          });
        } catch {
          throw new QueueRequestError(null, 'AUTH_STATE_UNAVAILABLE');
        }
        assertLogoutCleanupComplete();
        if (!isCurrent() || queueGeneration() !== expectedGeneration)
          throw new QueueRequestError(409, 'QUEUE_TICKET_REPLACED');
        const body = (await response.json().catch(() => null)) as ApiEnvelope<{
          access_token?: string;
          expires_in?: number;
        }> | null;
        if (
          response.ok &&
          (body?.message === 'login success' || body?.message === 'login recovered') &&
          typeof body.data?.access_token === 'string' &&
          typeof body.data.expires_in === 'number'
        ) {
          assertLogoutCleanupComplete();
          if (!isCurrent() || queueGeneration() !== expectedGeneration)
            throw new QueueRequestError(409, 'QUEUE_TICKET_REPLACED');
          setAccessToken(body.data.access_token);
          return body as LoginSuccessEnvelope;
        }
        throw new QueueRequestError(response.status, body?.message ?? null, retryAfter(response));
      },
    );
    return recovery;
  });
}
