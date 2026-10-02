const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const ACCESS_TOKEN_KEY = 'access_token';
export const ACCESS_TOKEN_REFRESH_EARLY_MS = 10 * 60 * 1000;
const AUTH_LOCK_NAME = 'meomuneum:auth-transition';
const AUTH_CHANNEL_NAME = 'meomuneum:auth-state';
const AUTH_EPOCH_KEY = 'meomuneum:auth-epoch';

type AuthBroadcastMessage = { type: 'auth-changed' };

export type AuthStatus =
  'restoring' | 'authenticated' | 'guest' | 'retryable-error' | 'logging-in' | 'logging-out';
export const AUTH_EXPIRED_EVENT = 'meomuneum:auth-expired';
export const ACCESS_TOKEN_CHANGED_EVENT = 'meomuneum:access-token-changed';

export class AuthRequestError extends Error {
  readonly status: number | null;
  readonly requestWasSent: boolean;
  constructor(status: number | null, requestWasSent = false) {
    super('Authentication request failed');
    this.name = 'AuthRequestError';
    this.status = status;
    this.requestWasSent = requestWasSent;
  }
}

let pendingRefresh: Promise<string> | null = null;
let transitionQueue: Promise<void> = Promise.resolve();
let pendingTransitions = 0;
let generation = 0;
let authTransitionGeneration = 0;
let accessTokenInMemory: string | null = null;
let storageUnavailable = false;
let storageNeedsClear = false;
let authTransitionActionDepth = 0;
let lastAccessTokenRefreshAt = 0;

export function getLastAccessTokenRefreshAt(): number {
  return lastAccessTokenRefreshAt;
}

function announceAccessTokenChange(): void {
  window.dispatchEvent(new Event(ACCESS_TOKEN_CHANGED_EVENT));
}

function sharedAuthEpoch(): string {
  try {
    return window.localStorage.getItem(AUTH_EPOCH_KEY) ?? '0';
  } catch {
    throw new AuthRequestError(null);
  }
}

function advanceSharedAuthEpoch(): void {
  try {
    const nextEpoch = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(AUTH_EPOCH_KEY, nextEpoch);
  } catch {
    throw new AuthRequestError(null);
  }
}

function invalidateForPeerAuthChange(): void {
  authTransitionGeneration += 1;
  clearAccessToken();
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

const authChannel =
  typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function'
    ? new window.BroadcastChannel(AUTH_CHANNEL_NAME)
    : null;

authChannel?.addEventListener('message', (event: MessageEvent<AuthBroadcastMessage>) => {
  if (event.data?.type !== 'auth-changed') return;
  invalidateForPeerAuthChange();
});

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === AUTH_EPOCH_KEY) invalidateForPeerAuthChange();
  });
}

function sessionTokenStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    storageUnavailable = true;
    return null;
  }
}

export function getAccessToken(): string | null {
  const storage = sessionTokenStorage();
  if (!storage) {
    accessTokenInMemory = null;
    generation += 1;
    return null;
  }

  if (storageNeedsClear) {
    try {
      storage.removeItem(ACCESS_TOKEN_KEY);
      storageNeedsClear = false;
      storageUnavailable = false;
    } catch {
      storageUnavailable = true;
      accessTokenInMemory = null;
      generation += 1;
      return null;
    }
  }

  try {
    const token = storage.getItem(ACCESS_TOKEN_KEY);
    storageUnavailable = false;
    if (token !== accessTokenInMemory) {
      accessTokenInMemory = token;
      generation += 1;
    }
    return token;
  } catch {
    storageUnavailable = true;
    accessTokenInMemory = null;
    generation += 1;
    return null;
  }
}

export function getAccessTokenExpiresAt(): number | null {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const encodedPayload = token.split('.')[1];
    if (!encodedPayload) return null;
    const payload = JSON.parse(window.atob(encodedPayload.replace(/-/g, '+').replace(/_/g, '/')));
    if (!Number.isFinite(payload.exp)) return null;
    const expiresAt = payload.exp * 1000;
    return Number.isFinite(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
}

export function shouldRefreshAccessToken(now = Date.now()): boolean {
  const expiresAt = getAccessTokenExpiresAt();
  return expiresAt === null || expiresAt - now <= ACCESS_TOKEN_REFRESH_EARLY_MS;
}

function persistAccessToken(token: string, invalidateRequests: boolean, refreshed = false): void {
  const storage = sessionTokenStorage();
  if (!storage) {
    accessTokenInMemory = null;
    storageUnavailable = true;
    storageNeedsClear = true;
    generation += 1;
    throw new AuthRequestError(null);
  }

  try {
    storage.setItem(ACCESS_TOKEN_KEY, token);
  } catch {
    storageUnavailable = true;
    accessTokenInMemory = null;
    storageNeedsClear = true;
    generation += 1;
    throw new AuthRequestError(null);
  }

  storageUnavailable = false;
  storageNeedsClear = false;
  const changed = accessTokenInMemory !== token;
  accessTokenInMemory = token;
  if (changed && invalidateRequests) generation += 1;
  if (refreshed) lastAccessTokenRefreshAt = Date.now();
  announceAccessTokenChange();
}

export function setAccessToken(token: string): void {
  if (!token) throw new AuthRequestError(null);
  lastAccessTokenRefreshAt = 0;
  persistAccessToken(token, true);
}

export function clearAccessToken(): void {
  const storage = sessionTokenStorage();
  let previousToken = accessTokenInMemory;
  if (storage) {
    try {
      previousToken = storage.getItem(ACCESS_TOKEN_KEY) ?? previousToken;
    } catch {
      storageUnavailable = true;
    }
    try {
      storage.removeItem(ACCESS_TOKEN_KEY);
      storageUnavailable = false;
      storageNeedsClear = false;
    } catch {
      storageUnavailable = true;
      storageNeedsClear = true;
    }
  } else {
    storageUnavailable = true;
    storageNeedsClear = true;
  }
  accessTokenInMemory = null;
  lastAccessTokenRefreshAt = 0;
  if (previousToken !== null) generation += 1;
  announceAccessTokenChange();
}

export function announceAuthChange(): void {
  try {
    authChannel?.postMessage({ type: 'auth-changed' } satisfies AuthBroadcastMessage);
  } catch {
    // The current tab remains safe; browsers with BroadcastChannel synchronize peer tabs.
  }
}

function requestAuthLock<T>(action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(AUTH_LOCK_NAME, { mode: 'exclusive' }, action);
  }
  if (import.meta.env.MODE === 'test') return action();
  throw new AuthRequestError(null);
}

async function waitForAuthTransition(): Promise<void> {
  while (pendingTransitions > 0) {
    const transition = transitionQueue;
    await transition;
  }
}

function abortIfNeeded(signal?: AbortSignal | null): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('The request was aborted.', 'AbortError');
  }
}

function isReplayableBody(body: BodyInit | null | undefined): boolean {
  if (body == null || typeof body === 'string') return true;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return true;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  return false;
}

function isCurrentAuth(generationAtStart: number, accessToken: string | null): boolean {
  return generation === generationAtStart && getAccessToken() === accessToken;
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

async function refreshOnce(retryCsrf: boolean, requestEpoch: string): Promise<string> {
  const csrf = await getCsrfToken();
  if (sharedAuthEpoch() !== requestEpoch) {
    throw new AuthRequestError(null);
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/auth/token/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-TOKEN': csrf },
    });
  } catch {
    throw new AuthRequestError(null);
  }
  if (response.status === 403 && retryCsrf) return refreshOnce(false, requestEpoch);
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.data?.access_token !== 'string') {
    throw new AuthRequestError(response.status);
  }
  return body.data.access_token;
}

export async function refreshAccessToken(
  expectedGeneration?: number,
  expectedTransitionGeneration?: number,
  expectedSharedAuthEpoch?: string,
): Promise<string> {
  await waitForAuthTransition();
  const startSharedAuthEpoch = sharedAuthEpoch();
  if (expectedSharedAuthEpoch !== undefined && startSharedAuthEpoch !== expectedSharedAuthEpoch) {
    throw new AuthRequestError(null);
  }
  const existingToken = getAccessToken();
  if (storageUnavailable) throw new AuthRequestError(null);
  if (
    expectedGeneration !== undefined &&
    (generation !== expectedGeneration || authTransitionGeneration !== expectedTransitionGeneration)
  ) {
    throw new AuthRequestError(null);
  }
  if (pendingRefresh) return pendingRefresh;

  const requestGeneration = generation;
  const requestTransitionGeneration = authTransitionGeneration;
  const tokenAtStart = existingToken;
  const request = requestAuthLock(async () => {
    if (
      generation !== requestGeneration ||
      authTransitionGeneration !== requestTransitionGeneration ||
      sharedAuthEpoch() !== startSharedAuthEpoch ||
      storageUnavailable
    ) {
      throw new AuthRequestError(null);
    }
    const token = await refreshOnce(true, startSharedAuthEpoch);
    if (
      generation !== requestGeneration ||
      authTransitionGeneration !== requestTransitionGeneration ||
      sharedAuthEpoch() !== startSharedAuthEpoch
    ) {
      throw new AuthRequestError(null);
    }
    persistAccessToken(token, false, true);
    return token;
  }).catch((caught: unknown) => {
    if (
      generation === requestGeneration &&
      sharedAuthEpoch() === startSharedAuthEpoch &&
      caught instanceof AuthRequestError &&
      caught.status === 401
    ) {
      if (tokenAtStart !== null && getAccessToken() === tokenAtStart) clearAccessToken();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw caught;
  });
  pendingRefresh = request;
  void request
    .finally(() => {
      if (pendingRefresh === request) pendingRefresh = null;
    })
    .catch(() => undefined);
  return request;
}

export type AuthenticatedFetchOptions = {
  allowAnonymousOnRefreshUnauthorized?: boolean;
};

function requestHeaders(init: RequestInit, token: string | null): Headers {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  else headers.delete('Authorization');
  return headers;
}

async function sendProtectedRequest(
  input: RequestInfo | URL,
  init: RequestInit,
  token: string | null,
): Promise<Response> {
  abortIfNeeded(init.signal);
  return fetch(input, { ...init, headers: requestHeaders(init, token) });
}

async function sendAnonymousFallback(
  input: RequestInfo | URL,
  init: RequestInit,
  transitionGeneration: number,
  requestEpoch: string,
): Promise<Response> {
  const response = await sendProtectedRequest(input, init, null);
  if (authTransitionGeneration !== transitionGeneration || sharedAuthEpoch() !== requestEpoch) {
    throw new AuthRequestError(null, true);
  }
  return response;
}

// Explicit opt-in for protected API wrappers. Login/logout, CSRF, refresh, and public APIs use fetch directly.
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: AuthenticatedFetchOptions = {},
): Promise<Response> {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    throw new AuthRequestError(null);
  }
  if (!isReplayableBody(init.body)) throw new AuthRequestError(null);
  abortIfNeeded(init.signal);
  await waitForAuthTransition();
  const requestSharedAuthEpoch = sharedAuthEpoch();

  let accessToken = getAccessToken();
  // Reading sessionStorage can discover the token after a full reload and advance
  // the in-memory generation. Capture the request version only after that sync read.
  const requestGeneration = generation;
  const requestTransitionGeneration = authTransitionGeneration;
  if (storageUnavailable) throw new AuthRequestError(null);
  if (!accessToken) {
    try {
      accessToken = await refreshAccessToken(
        requestGeneration,
        requestTransitionGeneration,
        requestSharedAuthEpoch,
      );
    } catch (caught) {
      if (
        options.allowAnonymousOnRefreshUnauthorized &&
        caught instanceof AuthRequestError &&
        caught.status === 401 &&
        authTransitionGeneration === requestTransitionGeneration &&
        sharedAuthEpoch() === requestSharedAuthEpoch &&
        generation === requestGeneration &&
        getAccessToken() === null
      ) {
        abortIfNeeded(init.signal);
        return sendAnonymousFallback(
          input,
          init,
          requestTransitionGeneration,
          requestSharedAuthEpoch,
        );
      }
      throw caught;
    }
  }
  if (generation !== requestGeneration || getAccessToken() !== accessToken) {
    throw new AuthRequestError(null);
  }

  const response = await sendProtectedRequest(input, init, accessToken);
  if (
    authTransitionGeneration !== requestTransitionGeneration ||
    sharedAuthEpoch() !== requestSharedAuthEpoch
  ) {
    invalidateForPeerAuthChange();
    throw new AuthRequestError(null, true);
  }
  const currentToken = getAccessToken();
  if (response.status !== 401) {
    if (!isCurrentAuth(requestGeneration, accessToken)) throw new AuthRequestError(null, true);
    return response;
  }
  abortIfNeeded(init.signal);

  if (currentToken && currentToken !== accessToken && generation === requestGeneration) {
    const latestResponse = await sendProtectedRequest(input, init, currentToken);
    if (
      authTransitionGeneration !== requestTransitionGeneration ||
      sharedAuthEpoch() !== requestSharedAuthEpoch ||
      !isCurrentAuth(requestGeneration, currentToken)
    ) {
      throw new AuthRequestError(null, true);
    }
    if (latestResponse.status === 401 && isCurrentAuth(requestGeneration, currentToken)) {
      clearAccessToken();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    return latestResponse;
  }

  const refreshedAccessToken = await refreshAccessToken(
    requestGeneration,
    requestTransitionGeneration,
    requestSharedAuthEpoch,
  );
  if (generation !== requestGeneration || getAccessToken() !== refreshedAccessToken) {
    throw new AuthRequestError(null);
  }
  abortIfNeeded(init.signal);

  const retryResponse = await sendProtectedRequest(input, init, refreshedAccessToken);
  if (
    authTransitionGeneration !== requestTransitionGeneration ||
    sharedAuthEpoch() !== requestSharedAuthEpoch ||
    !isCurrentAuth(requestGeneration, refreshedAccessToken)
  ) {
    throw new AuthRequestError(null, true);
  }
  if (retryResponse.status === 401 && isCurrentAuth(requestGeneration, refreshedAccessToken)) {
    clearAccessToken();
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  return retryResponse;
}

export async function authenticatedFetchWithinAuthTransition(
  input: RequestInfo | URL,
  init: RequestInit,
  accessToken: string,
): Promise<Response> {
  if (authTransitionActionDepth === 0 || !accessToken) throw new AuthRequestError(null);
  if (typeof Request !== 'undefined' && input instanceof Request) throw new AuthRequestError(null);
  if (!isReplayableBody(init.body)) throw new AuthRequestError(null);
  abortIfNeeded(init.signal);
  return sendProtectedRequest(input, init, accessToken);
}

// Login, logout, and account changes hold a cross-tab lock while the refresh cookie changes.
export function runAuthTransition<T>(action: () => Promise<T>): Promise<T> {
  generation += 1;
  authTransitionGeneration += 1;
  pendingTransitions += 1;
  const previous = transitionQueue;
  let release!: () => void;
  transitionQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  return (async () => {
    await previous;
    try {
      if (pendingRefresh) await pendingRefresh.catch(() => undefined);
      return await requestAuthLock(async () => {
        authTransitionActionDepth += 1;
        let result: T;
        try {
          result = await action();
        } finally {
          authTransitionActionDepth -= 1;
        }
        advanceSharedAuthEpoch();
        announceAuthChange();
        return result;
      });
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
  authTransitionGeneration = 0;
  accessTokenInMemory = null;
  storageUnavailable = false;
  storageNeedsClear = false;
  authTransitionActionDepth = 0;
  lastAccessTokenRefreshAt = 0;
  try {
    window.localStorage.removeItem(AUTH_EPOCH_KEY);
  } catch {
    // A test reset must not mask a storage failure under test.
  }
}
