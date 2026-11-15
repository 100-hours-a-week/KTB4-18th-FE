import { readDirectAuthOperation } from '../../features/auth-login/api/directAuthOperationStore';
import { unresolvedDirectOperation } from '../../features/auth-login/api/directAuthSessionFlow';
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  isDirectAuthEnabled,
  isDirectRefreshVerified,
} from '../../features/auth-login/api/authProtocolMode';
import {
  DIRECT_AUTH_CHANGED_EVENT,
  DIRECT_AUTH_CHECKING_EVENT,
  DIRECT_AUTH_RECHECK_EVENT,
  getDirectAccessToken,
  getDirectAccessTokenExpiresAt,
  getDirectAccessTokenRefreshAt,
  getDirectAuthChecking,
  isDirectAuthRecoveryUnavailable,
  directAuthVersion,
  observeDirectAuthPeers,
  setDirectAuthChecking,
} from '../../features/auth-login/api/directAuthSessionState';
import { restoreVerifiedDirectSession } from '../../features/auth-login/api/directAuthSessionRefresh';
import { DirectAuthApiError } from '../../features/auth-login/api/directAuthTypes';
import type { AuthStatus } from '../../features/auth-login/api/authSession';

export function useAppAuthSession(
  status: AuthStatus,
  setStatus: Dispatch<SetStateAction<AuthStatus>>,
  setFormVersion: Dispatch<SetStateAction<number>>,
) {
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    if (!isDirectAuthEnabled()) return;
    let active = true;
    let pending: Promise<void> | null = null;
    let queued = false;
    let queuedForceRefresh = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let suppressedRefreshExpiry: number | null = null;
    const isRefreshDue = () => {
      const expiry = getDirectAccessTokenExpiresAt();
      const refreshAt = getDirectAccessTokenRefreshAt();
      return (
        isDirectRefreshVerified() &&
        expiry !== null &&
        suppressedRefreshExpiry !== expiry &&
        refreshAt !== null &&
        refreshAt <= Date.now()
      );
    };
    const scheduleRefresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
      if (!active || !isDirectRefreshVerified()) return;
      const expiresAt = getDirectAccessTokenExpiresAt();
      const refreshAt = getDirectAccessTokenRefreshAt();
      if (expiresAt === null || refreshAt === null) {
        suppressedRefreshExpiry = null;
        return;
      }
      if (suppressedRefreshExpiry !== null && suppressedRefreshExpiry !== expiresAt)
        suppressedRefreshExpiry = null;
      if (suppressedRefreshExpiry === expiresAt) return;
      if (document.visibilityState === 'hidden') return;
      if (refreshAt <= Date.now()) return;
      refreshTimer = setTimeout(
        () => {
          refreshTimer = undefined;
          if (!active || document.visibilityState === 'hidden') return;
          if (getDirectAccessTokenExpiresAt() !== null) void check(isRefreshDue());
        },
        Math.min(2147483647, Math.max(0, refreshAt - Date.now())),
      );
    };
    const check = (forceRefresh = false): Promise<void> => {
      if (pending) {
        queued = true;
        queuedForceRefresh ||= forceRefresh;
        return pending;
      }
      const requestedExpiry = getDirectAccessTokenExpiresAt();
      const version = directAuthVersion();
      setDirectAuthChecking(
        !getDirectAccessToken() &&
          !['guest', 'logging-in', 'logging-out'].includes(statusRef.current),
      );
      setStatus((state) =>
        state === 'guest' || state === 'logging-in' || state === 'logging-out'
          ? state
          : getDirectAccessToken()
            ? 'authenticated'
            : 'restoring',
      );
      pending = (async () => {
        try {
          const pendingLogout = readDirectAuthOperation('LOGOUT');
          const result = await restoreVerifiedDirectSession({ forceRefresh });
          if (
            forceRefresh &&
            result !== 'REFRESHED' &&
            result !== 'INVALID' &&
            result !== 'SUPERSEDED' &&
            requestedExpiry !== null &&
            getDirectAccessTokenExpiresAt() === requestedExpiry
          )
            suppressedRefreshExpiry = requestedExpiry;
          if (active && !queued) {
            setStatus((state) =>
              state === 'logging-in' || state === 'logging-out'
                ? state
                : forceRefresh && getDirectAccessToken()
                  ? 'authenticated'
                  : isDirectAuthRecoveryUnavailable()
                    ? 'retryable-error'
                    : getDirectAccessToken()
                      ? 'authenticated'
                      : 'guest',
            );
            if (
              version === directAuthVersion() &&
              pendingLogout &&
              !readDirectAuthOperation('LOGOUT')
            )
              setFormVersion((value) => value + 1);
          }
        } catch (error) {
          if (
            forceRefresh &&
            requestedExpiry !== null &&
            getDirectAccessTokenExpiresAt() === requestedExpiry
          )
            suppressedRefreshExpiry = requestedExpiry;
          const invalidSession = error instanceof DirectAuthApiError && error.status === 401;
          let hasPending = false;
          try {
            hasPending = Boolean(unresolvedDirectOperation());
          } catch {
            hasPending = false;
          }
          if (active && !queued)
            setStatus((state) =>
              state === 'guest' || state === 'logging-in' || state === 'logging-out'
                ? state
                : forceRefresh && getDirectAccessToken()
                  ? 'authenticated'
                  : invalidSession
                    ? 'guest'
                    : isDirectAuthRecoveryUnavailable()
                      ? 'retryable-error'
                      : getDirectAccessToken()
                        ? 'authenticated'
                        : hasPending
                          ? 'guest'
                          : 'retryable-error',
            );
        } finally {
          if (active && !queued) setDirectAuthChecking(false);
          pending = null;
          if (active && queued) {
            const forceNext = queuedForceRefresh;
            queued = false;
            queuedForceRefresh = false;
            void check(forceNext);
          }
        }
      })();
      return pending;
    };
    const changed = (event: Event) => {
      if (getDirectAuthChecking()) return;
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      if (reason === 'peer' || reason === 'expired') {
        scheduleRefresh();
        void check(isRefreshDue());
        return;
      }
      scheduleRefresh();
      if (pending) {
        if (
          !getDirectAccessToken() &&
          !['guest', 'logging-in', 'logging-out'].includes(statusRef.current)
        ) {
          setDirectAuthChecking(true);
          setStatus((state) =>
            state === 'logging-in' || state === 'logging-out' ? state : 'restoring',
          );
        }
        return;
      }
      if (active)
        setStatus((state) =>
          state === 'logging-in' || state === 'logging-out'
            ? state
            : getDirectAccessToken()
              ? 'authenticated'
              : 'guest',
        );
    };
    const visible = () => {
      if (document.visibilityState !== 'hidden') {
        scheduleRefresh();
        void check(isRefreshDue());
      }
    };
    const retry = () => {
      void check();
    };
    const checkingChanged = () => {
      if (getDirectAuthChecking()) return;
      if (pending) return;
      scheduleRefresh();
      setStatus((state) =>
        state === 'logging-in' || state === 'logging-out'
          ? state
          : isDirectAuthRecoveryUnavailable()
            ? 'retryable-error'
            : getDirectAccessToken()
              ? 'authenticated'
              : 'guest',
      );
    };
    const stop = observeDirectAuthPeers();
    scheduleRefresh();
    window.addEventListener(DIRECT_AUTH_CHANGED_EVENT, changed);
    window.addEventListener(DIRECT_AUTH_CHECKING_EVENT, checkingChanged);
    window.addEventListener(DIRECT_AUTH_RECHECK_EVENT, retry);
    for (const event of ['focus', 'pageshow', 'online']) window.addEventListener(event, visible);
    document.addEventListener('visibilitychange', visible);
    void check(isRefreshDue());
    return () => {
      active = false;
      clearTimeout(refreshTimer);
      stop();
      window.removeEventListener(DIRECT_AUTH_CHANGED_EVENT, changed);
      window.removeEventListener(DIRECT_AUTH_CHECKING_EVENT, checkingChanged);
      window.removeEventListener(DIRECT_AUTH_RECHECK_EVENT, retry);
      for (const event of ['focus', 'pageshow', 'online'])
        window.removeEventListener(event, visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [setStatus, setFormVersion]);
}
