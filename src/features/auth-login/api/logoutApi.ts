export class LogoutRequestError extends Error {
  readonly status: number | null;

  constructor(status: number | null) {
    super('Logout request failed');
    this.status = status;
  }
}

export class LogoutFinalizationError extends Error {
  constructor() {
    super('Logout succeeded, but local authentication state could not be finalized');
    this.name = 'LogoutFinalizationError';
  }
}

export async function logout(onServerSuccess?: () => void): Promise<void> {
  let serverSucceeded = false;
  try {
    await runAuthTransition(() =>
      submitLogout(() => {
        serverSucceeded = true;
        onServerSuccess?.();
      }),
    );
  } catch (error) {
    if (serverSucceeded) throw new LogoutFinalizationError();
    throw error;
  }
}

async function submitLogout(onServerSuccess: () => void): Promise<void> {
  let response: Response;

  try {
    const csrf = await getCsrfToken();
    const accessToken = getAccessToken();
    const headers = new Headers({ 'X-CSRF-TOKEN': csrf });
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    response = await fetch(
      `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}/api/v1/auth/logout`,
      {
        method: 'POST',
        credentials: 'include',
        headers,
      },
    );
  } catch {
    throw new LogoutRequestError(null);
  }

  if (!response.ok) {
    throw new LogoutRequestError(response.status);
  }
  onServerSuccess();
  clearAccessToken();
}
import { clearAccessToken, getAccessToken, getCsrfToken, runAuthTransition } from './authSession';
