import { getCsrfToken, runAuthTransition } from './authSession';

// This module owns only the email/password login contract.
export type LoginRequest = {
  email: string;
  password: string;
};

export type LoginSuccessResponse = {
  message: 'login success';
  data: {
    access_token: string;
    expires_in: number;
  };
};

type LoginErrorResponse = {
  message?: string;
  data?: null;
};

export class LoginRequestError extends Error {
  readonly status: number | null;

  constructor(status: number | null) {
    super('Login request failed');
    this.status = status;
  }
}

export async function login(request: LoginRequest): Promise<LoginSuccessResponse> {
  return runAuthTransition(() => submitLogin(request));
}

async function submitLogin(request: LoginRequest): Promise<LoginSuccessResponse> {
  let response: Response;

  try {
    const csrf = await getCsrfToken();
    response = await fetch(
      `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}/api/v1/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf },
        credentials: 'include',
        body: JSON.stringify(request),
      },
    );
  } catch {
    throw new LoginRequestError(null);
  }

  if (!response.ok) {
    await response.json().catch((): LoginErrorResponse | null => null);
    throw new LoginRequestError(response.status);
  }

  const payload = (await response.json()) as LoginSuccessResponse;
  if (
    payload.message !== 'login success' ||
    typeof payload.data?.access_token !== 'string' ||
    typeof payload.data.expires_in !== 'number'
  ) {
    throw new LoginRequestError(500);
  }

  sessionStorage.setItem('access_token', payload.data.access_token);
  return payload;
}
