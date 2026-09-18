import { ApiRequestError, type ApiResponse } from '../shared/api/apiTypes';
import { clearAuthTokens, getCsrfToken, setAccessToken, setCsrfToken } from './authStore';
import type { CsrfTokenData, LoginCredentials, TokenData } from './authTypes';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

let initializationPromise: Promise<void> | null = null;
let refreshPromise: Promise<string | null> | null = null;

export async function initializeAuth(): Promise<void> {
  if (initializationPromise !== null) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const csrfToken = await issueCsrfToken();
    setCsrfToken(csrfToken);
    await refreshAccessTokenOnce();
  })().finally(() => {
    initializationPromise = null;
  });

  return initializationPromise;
}

export async function login(credentials: LoginCredentials): Promise<void> {
  const csrfToken = getCsrfToken();
  if (csrfToken === null) {
    setCsrfToken(await issueCsrfToken());
  }

  const tokenData = await requestAuth<TokenData>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  setAccessToken(tokenData.access_token);
}

export async function logout(): Promise<void> {
  await requestAuth<void>('/api/v1/auth/logout', { method: 'POST' });
  clearAuthTokens();
}

export async function refreshAccessTokenOnce(): Promise<string | null> {
  if (refreshPromise !== null) {
    return refreshPromise;
  }

  refreshPromise = requestAuth<TokenData>('/api/v1/auth/token/refresh', { method: 'POST' })
    .then((tokenData) => {
      setAccessToken(tokenData.access_token);
      return tokenData.access_token;
    })
    .catch(() => {
      setAccessToken(null);
      return null;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

async function issueCsrfToken(): Promise<string> {
  const csrfData = await requestAuth<CsrfTokenData>('/api/v1/auth/token/csrf', { method: 'GET' });
  return csrfData.csrf_token;
}

async function requestAuth<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');

  const csrfToken = getCsrfToken();
  if (csrfToken !== null && init.method !== 'GET') {
    headers.set('X-CSRF-TOKEN', csrfToken);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || payload.data === null) {
    throw new ApiRequestError(response.status, payload.message);
  }

  return payload.data;
}
