import { createContext } from 'react';
import type { LoginCredentials } from './authTypes';

export interface AuthContextValue {
  isAuthenticated: boolean;
  isInitialized: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
