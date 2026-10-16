import { QueueRequestError } from './loginQueueErrors';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export const REQUEST_TIMEOUT_MS = 15_000;

type ApiEnvelope<T> = { message?: string; data?: T | null };
export type LoginQueueStatus =
  'WAITING' | 'READY' | 'VERIFYING' | 'RETRYABLE' | 'CONSUMED' | 'CANCELLED' | 'EXPIRED';
export type LoginOutcome = 'SUCCESS' | 'INVALID_CREDENTIALS' | null;
export type LoginQueueTicket = {
  status: LoginQueueStatus;
  loginOutcome: LoginOutcome;
  usersAhead: number | null;
  nextPollSeconds: number;
  statusFetchedAt?: number;
  diagnosticCorrId?: string;
};

export function requestUrl(path: string): string {
  return `${baseUrl}/api/v1/auth/${path}`;
}

export function parseQueueRetryAfter(value: string | null, now = Date.now()): number | null {
  const header = value?.trim();
  if (!header) return null;
  if (/^\d+$/.test(header.trim())) {
    const seconds = Number(header.trim());
    return Number.isSafeInteger(seconds) ? seconds : null;
  }
  if (
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s\d{2}\s[A-Z][a-z]{2}\s\d{4}\s\d{2}:\d{2}:\d{2}\sGMT$/.test(
      header,
    )
  )
    return null;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : null;
}

export function retryAfter(response: Response): number | null {
  return parseQueueRetryAfter(response.headers.get('Retry-After'));
}

export function errorCode(body: { code?: unknown; message?: unknown } | null): string | null {
  const recognized = ['QUEUE_FULL', 'RATE_LIMITED', 'OPERATION_IN_PROGRESS'];
  for (const value of [body?.code, body?.message]) {
    if (typeof value === 'string' && recognized.includes(value)) return value;
  }
  if (typeof body?.code === 'string') return body.code;
  return typeof body?.message === 'string' ? body.message : null;
}

export async function fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const length = Number(response.headers.get('Content-Length'));
    if (Number.isFinite(length) && length > 64 * 1024) {
      controller.abort();
      throw new QueueRequestError(response.status, 'AUTH_RESPONSE_TOO_LARGE');
    }
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 64 * 1024) {
        await reader.cancel();
        controller.abort();
        throw new QueueRequestError(response.status, 'AUTH_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const completed = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    const parseJson = completed.json.bind(completed);
    completed.json = async () => {
      const parsed = await parseJson();
      if (Date.now() - startedAt > REQUEST_TIMEOUT_MS) {
        throw new QueueRequestError(null, 'REQUEST_AMBIGUOUS');
      }
      return parsed;
    };
    return completed;
  } catch (error) {
    if (error instanceof QueueRequestError) throw error;
    throw new QueueRequestError(null, 'REQUEST_AMBIGUOUS');
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  code: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new QueueRequestError(null, code)), timeoutMs);
    promise.then(resolve, reject).finally(() => window.clearTimeout(timeout));
  });
}

export async function readTicket(response: Response): Promise<LoginQueueTicket> {
  const body = (await response.json().catch(() => null)) as ApiEnvelope<LoginQueueTicket> | null;
  const data = body?.data;
  const nullOutcomeStatuses = [
    'WAITING',
    'READY',
    'VERIFYING',
    'RETRYABLE',
    'CANCELLED',
    'EXPIRED',
  ];
  const validConsumedOutcome =
    data?.status === 'CONSUMED' &&
    (data.loginOutcome === 'SUCCESS' || data.loginOutcome === 'INVALID_CREDENTIALS');
  if (
    !data ||
    ![...nullOutcomeStatuses, 'CONSUMED'].includes(data.status) ||
    !('loginOutcome' in data) ||
    (nullOutcomeStatuses.includes(data.status) && data.loginOutcome !== null) ||
    (data.status === 'CONSUMED' && !validConsumedOutcome)
  ) {
    throw new QueueRequestError(500);
  }
  return {
    status: data.status,
    loginOutcome: data.loginOutcome,
    usersAhead: typeof data.usersAhead === 'number' ? data.usersAhead : null,
    nextPollSeconds: typeof data.nextPollSeconds === 'number' ? data.nextPollSeconds : 10,
    diagnosticCorrId:
      typeof data.diagnosticCorrId === 'string' && /^[a-fA-F0-9]{32}$/.test(data.diagnosticCorrId)
        ? data.diagnosticCorrId.toLowerCase()
        : undefined,
  };
}
