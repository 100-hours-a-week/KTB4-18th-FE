import { useEffect, useState, type ReactNode } from 'react';
import { initializeAuth, login, logout } from './authApi';
import { AuthContext } from './authContext';
import { getAccessToken } from './authStore';
import type { LoginCredentials } from './authTypes';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    let isMounted = true;

    initializeAuth().finally(() => {
      if (isMounted) {
        setIsAuthenticated(getAccessToken() !== null);
        setIsInitialized(true);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleLogin(credentials: LoginCredentials): Promise<void> {
    await login(credentials);
    setIsAuthenticated(true);
  }

  async function handleLogout(): Promise<void> {
    await logout();
    setIsAuthenticated(false);
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, isInitialized, login: handleLogin, logout: handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}
