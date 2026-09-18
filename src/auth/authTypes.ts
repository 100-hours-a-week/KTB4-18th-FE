export interface CsrfTokenData {
  csrf_token: string;
}

export interface TokenData {
  access_token: string;
  expires_in: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
}
