import { getCsrfToken, runAuthTransition, setAccessToken } from './authSession';
import { probeAuthCapabilities } from './authCapabilities';
import { QueueRequestError } from './loginQueueErrors';
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
  newMarker,
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

export { QueueRequestError } from './loginQueueErrors';

const QUEUE_LOCK_WAIT_MS = 15_000;
const CANCEL_TIMEOUT_MS = 45_000;

type ApiEnvelope<T> = { message?: string; data?: T | null };
type LoginSuccessEnvelope = {
  message: 'login success';
  data: { access_token: string; expires_in: number };
};

async function requestTicketStatus(signal?: AbortSignal): Promise<LoginQueueTicket> {
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
  if (response.status === 404 || response.status === 410) {
    if (response.status === 410) clearCreateRetryMarker();
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
  if (ticket.status === 'CANCELLED' || ticket.status === 'EXPIRED') {
    clearCreateRetryMarker();
  }
  return ticket;
}

async function createTicketWithKey(idempotencyKey: string): Promise<LoginQueueTicket> {
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
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      (ApiEnvelope<null> & { code?: string }) | null;
    throw new QueueRequestError(response.status, errorCode(body), retryAfter(response));
  }
  const ticket = await readTicket(response);
  const pendingMarker = readMarker(CREATE_KEY_STORAGE);
  if (pendingMarker?.status === 'CANCEL_REQUESTED')
    throw new QueueRequestError(409, 'QUEUE_CANCEL_UNCONFIRMED');
  try {
    storage().removeItem(CREATE_KEY_STORAGE);
    retryBaselines.delete(idempotencyKey);
  } catch {
    throw new QueueRequestError(null);
  }
  beginQueueGeneration();
  return ticket;
}

async function createUnderLock(expectedGeneration: string): Promise<LoginQueueTicket | null> {
  const lockManager = navigator.locks;
  if (!lockManager?.request) throw new QueueRequestError(null, 'AUTH_CAPABILITY_UNAVAILABLE');
  return lockManager.request(
    QUEUE_FLOW_LOCK,
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      if (!lock) return null;
      if (queueGeneration() !== expectedGeneration)
        throw new QueueRequestError(409, 'QUEUE_OPERATION_REPLACED');
      let marker = readMarker(CREATE_KEY_STORAGE);
      if (marker?.status === 'CANCEL_REQUESTED')
        throw new QueueRequestError(409, 'QUEUE_CANCELLED');
      const current = await currentTicketIfPresent();
      if (current) {
        if (marker) {
          storage().removeItem(CREATE_KEY_STORAGE);
          retryBaselines.delete(marker.id);
          beginQueueGeneration();
        }
        return current;
      }
      marker = readMarker(CREATE_KEY_STORAGE);
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
          return await createTicketWithKey(marker.id);
        } catch (error) {
          if (!(error instanceof QueueRequestError)) throw error;
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
              ticket = await currentTicketIfPresent();
            } catch {
              // The same idempotency key remains the recovery path when status is unavailable.
            }
            if (ticket) {
              try {
                storage().removeItem(CREATE_KEY_STORAGE);
              } catch {
                throw new QueueRequestError(null);
              }
              beginQueueGeneration();
              return ticket;
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

async function currentTicketIfPresent(signal?: AbortSignal): Promise<LoginQueueTicket | null> {
  try {
    const current = await requestTicketStatus(signal);
    if (['CONSUMED', 'CANCELLED', 'EXPIRED'].includes(current.status)) {
      clearCreateRetryMarker();
      return null;
    }
    return current;
  } catch (error) {
    if (error instanceof QueueRequestError && error.status === 410) {
      return null;
    }
    if (error instanceof QueueRequestError && error.status === 404) return null;
    throw error;
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function startOrResumeLoginQueue(): Promise<LoginQueueTicket> {
  if (!probeAuthCapabilities().supported) {
    throw new QueueRequestError(null, 'AUTH_CAPABILITY_UNAVAILABLE');
  }
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
      const ticket = await createUnderLock(expectedGeneration);
      if (ticket) return ticket;
      const remaining = lockDeadline - Date.now();
      if (remaining <= 0) throw new QueueRequestError(409, 'QUEUE_LOCK_TIMEOUT');
      await wait(Math.min(200 + Math.floor(Math.random() * 201), remaining));
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
  return requestTicketStatus();
}

/** Performs a GET-only recovery check for an exhausted create operation. */
export async function reconcileLoginQueueStatus(): Promise<LoginQueueTicket> {
  const lockManager = navigator.locks;
  if (!lockManager?.request) throw new QueueRequestError(null, 'AUTH_CAPABILITY_UNAVAILABLE');
  return lockManager.request(
    QUEUE_FLOW_LOCK,
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      if (!lock) throw new QueueRequestError(409, 'QUEUE_LOCK_BUSY');
      const marker = readMarker(CREATE_KEY_STORAGE);
      if (marker?.status === 'CANCEL_REQUESTED')
        throw new QueueRequestError(409, 'QUEUE_CANCELLED');
      const ticket = await requestTicketStatus();
      if (marker) {
        storage().removeItem(CREATE_KEY_STORAGE);
        retryBaselines.delete(marker.id);
        beginQueueGeneration();
      }
      return ticket;
    },
  );
}

export async function cancelLoginQueue(): Promise<void> {
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
          } catch (error) {
            if (error instanceof QueueRequestError && [429, 503].includes(error.status ?? 0)) {
              return { kind: 'retry' as const, delay: error.retryAfterSeconds ?? 1 };
            }
            throw error;
          }
          if (flowController.signal.aborted)
            throw new QueueRequestError(null, 'QUEUE_CANCEL_UNCONFIRMED');
          if (!current && !marker) return { kind: 'confirmed' as const };
          const csrf = await promiseWithTimeout(
            getCsrfToken(flowController.signal),
            Math.min(REQUEST_TIMEOUT_MS, CANCEL_TIMEOUT_MS - (Date.now() - flowStartedAt)),
            'QUEUE_CANCEL_UNCONFIRMED',
          );
          if (flowController.signal.aborted)
            throw new QueueRequestError(null, 'QUEUE_CANCEL_UNCONFIRMED');
          const url = current
            ? requestUrl('login-queue/tickets/current')
            : requestUrl('login-queue/tickets/by-idempotency-key');
          const response = await fetchWithTimeout(url, {
            method: 'DELETE',
            credentials: 'include',
            headers: {
              'X-CSRF-TOKEN': csrf,
              ...(current || !marker ? {} : { 'Idempotency-Key': marker.id }),
            },
            signal: flowController.signal,
          });
          if (response.status === 204) return { kind: 'confirmed' as const };
          const body = (await response.json().catch(() => null)) as
            (ApiEnvelope<{ status?: string }> & { code?: string }) | null;
          if (response.status === 403) return { kind: 'csrf' as const };
          if (response.status === 409 || response.status === 503) {
            return { kind: 'retry' as const, delay: retryAfter(response) ?? 1 };
          }
          if (response.status !== 200 || body?.data?.status !== 'CANCELLED') {
            throw new QueueRequestError(response.status, errorCode(body), retryAfter(response));
          }
          return { kind: 'confirmed' as const };
        },
      );
      const outcome = await promiseWithTimeout(
        lockAttempt,
        Math.max(1, CANCEL_TIMEOUT_MS - (Date.now() - flowStartedAt)),
        'QUEUE_CANCEL_UNCONFIRMED',
      );
      if (outcome.kind === 'confirmed') {
        try {
          storage().removeItem(CREATE_KEY_STORAGE);
          publishQueueSignal({ type: 'queue-create-cancelled', queueGeneration: generation });
          beginQueueGeneration();
          return;
        } catch {
          throw new QueueRequestError(null, 'QUEUE_CANCEL_UNCONFIRMED');
        }
      }
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

export async function resumeQueueAfterPageRestore(): Promise<LoginQueueTicket | null> {
  return currentTicketIfPresent();
}

export function getLoginOperationId(): string {
  const generation = queueGeneration();
  const marker = readMarker(LOGIN_OPERATION_STORAGE);
  if (marker && marker.generation === generation) return marker.id;
  const next = { ...newMarker(LOGIN_OPERATION_TTL_MS), generation };
  writeMarker(LOGIN_OPERATION_STORAGE, next);
  return next.id;
}

export function clearLoginOperationId(): void {
  try {
    storage().removeItem(LOGIN_OPERATION_STORAGE);
  } catch {
    throw new QueueRequestError(null);
  }
}

export async function submitQueuedLogin(
  request: { email: string; password: string },
  expectedGeneration = queueGeneration(),
  diagnosticCorrelationId?: string,
): Promise<LoginSuccessEnvelope> {
  return runAuthTransition(async () => {
    const lockManager = navigator.locks;
    if (!lockManager?.request) throw new QueueRequestError(null, 'AUTH_CAPABILITY_UNAVAILABLE');
    const result = await lockManager.request(
      QUEUE_FLOW_LOCK,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (!lock) return { kind: 'peer-owned' as const };
        if (queueGeneration() !== expectedGeneration) return { kind: 'ticket-replaced' as const };
        const operationId = getLoginOperationId();
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
          return { kind: 'ambiguous' as const, status: null, retryAfter: null };
        }
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
          return { kind: 'invalid' as const, code: body?.message ?? null };
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
    if (result.kind === 'success') {
      setAccessToken(result.body.data.access_token);
      return result.body;
    }
    if (result.kind === 'invalid') throw new QueueRequestError(401, result.code);
    if (result.kind === 'retry') throw new QueueRequestError(429, result.code, result.retryAfter);
    throw new QueueRequestError(
      result.status ?? null,
      result.code ?? 'LOGIN_RESULT_AMBIGUOUS',
      result.retryAfter ?? null,
    );
  });
}

export async function recoverQueuedLogin(operationId?: string): Promise<LoginSuccessEnvelope> {
  const csrf = await getCsrfToken();
  return runAuthTransition(async () => {
    const lockManager = navigator.locks;
    if (!lockManager?.request) throw new QueueRequestError(null, 'AUTH_CAPABILITY_UNAVAILABLE');
    const recovery = await lockManager.request(
      QUEUE_FLOW_LOCK,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (!lock) throw new QueueRequestError(409, 'QUEUE_LOGIN_IN_PROGRESS');
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
          setAccessToken(body.data.access_token);
          return body as LoginSuccessEnvelope;
        }
        throw new QueueRequestError(response.status, body?.message ?? null, retryAfter(response));
      },
    );
    return recovery;
  });
}
