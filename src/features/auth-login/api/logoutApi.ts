export class LogoutRequestError extends Error {
  readonly status: number | null;

  constructor(status: number | null) {
    super('Logout request failed');
    this.status = status;
  }
}

export async function logout(): Promise<void> {
  let response: Response;

  try {
    response = await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    throw new LogoutRequestError(null);
  }

  if (!response.ok) {
    throw new LogoutRequestError(response.status);
  }
}
