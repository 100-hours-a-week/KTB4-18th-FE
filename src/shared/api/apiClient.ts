import { refreshAccessTokenOnce } from '../../auth/authApi';
import { getAccessToken } from '../../auth/authStore';
import { ApiRequestError, type ApiResponse } from './apiTypes';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

export async function requestApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await sendRequest(path, init);
  if (response.status !== 401) {
    return readResponse<T>(response);
  }

  const refreshedToken = await refreshAccessTokenOnce();
  if (refreshedToken === null) {
    throw new ApiRequestError(401, 'authentication failed');
  }

  return readResponse<T>(await sendRequest(path, init));
}

async function sendRequest(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  const accessToken = getAccessToken();
  if (accessToken !== null) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || payload.data === null) {
    throw new ApiRequestError(response.status, payload.message);
  }

  return payload.data;
}
