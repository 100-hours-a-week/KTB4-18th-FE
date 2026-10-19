import { getCsrfToken, runAuthTransition, setAccessToken } from './authSession';
import type { LoginSuccessResponse } from './loginApi';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

type LocalMockLoginEnvelope = {
  message?: unknown;
  data?: {
    access_token?: unknown;
    expires_in?: unknown;
  } | null;
};

export class LocalMockLoginRequestError extends Error {
  readonly status: number | null;

  constructor(status: number | null) {
    super('Local mock login request failed');
    this.name = 'LocalMockLoginRequestError';
    this.status = status;
  }
}

export function isLocalMockLoginEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_LOCAL_MOCK_LOGIN === 'true';
}

export async function localMockLogin(): Promise<LoginSuccessResponse> {
  if (!isLocalMockLoginEnabled()) throw new LocalMockLoginRequestError(null);
  return runAuthTransition(submitLocalMockLogin);
}

async function submitLocalMockLogin(): Promise<LoginSuccessResponse> {
  let csrfToken: string;
  try {
    csrfToken = await getCsrfToken();
  } catch {
    throw new LocalMockLoginRequestError(null);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/auth/local-mock-login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-TOKEN': csrfToken },
    });
  } catch {
    throw new LocalMockLoginRequestError(null);
  }

  if (!response.ok) {
    await response.json().catch((): LocalMockLoginEnvelope | null => null);
    throw new LocalMockLoginRequestError(response.status);
  }

  const payload = (await response
    .json()
    .catch((): LocalMockLoginEnvelope | null => null)) as LocalMockLoginEnvelope | null;
  if (
    payload?.message !== 'login success' ||
    typeof payload.data?.access_token !== 'string' ||
    typeof payload.data.expires_in !== 'number'
  ) {
    throw new LocalMockLoginRequestError(500);
  }

  const successResponse: LoginSuccessResponse = {
    message: 'login success',
    data: {
      access_token: payload.data.access_token,
      expires_in: payload.data.expires_in,
    },
  };
  setAccessToken(successResponse.data.access_token);
  return successResponse;
}
