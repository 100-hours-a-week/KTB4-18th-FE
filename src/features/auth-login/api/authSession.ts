const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export type AuthStatus = 'restoring' | 'authenticated' | 'guest' | 'retryable-error' | 'logging-in' | 'logging-out';
export const AUTH_EXPIRED_EVENT = 'meomuneum:auth-expired';

export class AuthRequestError extends Error {
  readonly status: number | null;
  constructor(status: number | null) {
    super('Authentication request failed');
    this.status = status;
  }
}

let pendingRefresh: Promise<string> | null = null;
let transitionQueue: Promise<void> = Promise.resolve();
let pendingTransitions = 0;
let generation = 0;

export function getAccessToken(): string | null {
  return sessionStorage.getItem('access_token');
}

export function clearAccessToken(): void {
  sessionStorage.removeItem('access_token');
}

export async function getCsrfToken(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/auth/token/csrf`, { credentials: 'include' });
  } catch {
    throw new AuthRequestError(null);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.data?.csrf_token !== 'string') {
    throw new AuthRequestError(response.status);
  }
  return body.data.csrf_token;
}

async function refreshOnce(retryCsrf: boolean): Promise<string> {
  const csrf = await getCsrfToken();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/auth/token/refresh`, {
      method: 'POST', credentials: 'include', headers: { 'X-CSRF-TOKEN': csrf },
    });
  } catch {
    throw new AuthRequestError(null);
  }
  if (response.status === 403 && retryCsrf) return refreshOnce(false);
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.data?.access_token !== 'string') {
    throw new AuthRequestError(response.status);
  }
  return body.data.access_token;
}

export function refreshAccessToken(): Promise<string> {
  if (pendingTransitions > 0) return Promise.reject(new AuthRequestError(null));
  if (pendingRefresh) return pendingRefresh;
  const currentGeneration = generation;
  const request = refreshOnce(true).then((token) => {
    if (generation === currentGeneration) sessionStorage.setItem('access_token', token);
    return token;
  }).catch((caught: unknown) => {
    if (generation === currentGeneration && caught instanceof AuthRequestError && caught.status === 401) {
      clearAccessToken();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw caught;
  });
  pendingRefresh = request;
  void request.finally(() => { if (pendingRefresh === request) pendingRefresh = null; }).catch(() => undefined);
  return request;
}

// Wait for the HTTP refresh response itself before login/logout changes the refresh cookie.
export function runAuthTransition<T>(action: () => Promise<T>): Promise<T> {
  generation += 1;
  pendingTransitions += 1;
  const previous = transitionQueue;
  let release!: () => void;
  transitionQueue = new Promise<void>((resolve) => { release = resolve; });
  return (async () => {
    await previous;
    try {
      if (pendingRefresh) await pendingRefresh.catch(() => undefined);
      return await action();
    } finally {
      pendingTransitions -= 1;
      release();
    }
  })();
}

export function resetAuthSessionForTests(): void {
  pendingRefresh = null;
  transitionQueue = Promise.resolve();
  pendingTransitions = 0;
  generation = 0;
}
