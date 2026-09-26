export class LogoutRequestError extends Error {
  readonly status: number | null;

  constructor(status: number | null) {
    super('Logout request failed');
    this.status = status;
  }
}

export async function logout(): Promise<void> {
  return runAuthTransition(submitLogout);
}

async function submitLogout(): Promise<void> {
  let response: Response;

  try {
    const csrf = await getCsrfToken();
    response = await fetch(
      `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}/api/v1/auth/logout`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-TOKEN': csrf },
      },
    );
  } catch {
    throw new LogoutRequestError(null);
  }

  if (!response.ok) {
    throw new LogoutRequestError(response.status);
  }
  clearAccessToken();
}
import { clearAccessToken, getCsrfToken, runAuthTransition } from './authSession';
