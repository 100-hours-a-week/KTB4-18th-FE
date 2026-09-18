let accessToken: string | null = null;
let csrfToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function clearAuthTokens(): void {
  accessToken = null;
  csrfToken = null;
}
