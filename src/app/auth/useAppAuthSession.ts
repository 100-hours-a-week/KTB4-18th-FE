import { readDirectAuthOperation } from '../../features/auth-login/api/directAuthOperationStore';
import { unresolvedDirectOperation } from '../../features/auth-login/api/directAuthSessionFlow';
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { isDirectAuthEnabled } from '../../features/auth-login/api/authProtocolMode';
import {
  DIRECT_AUTH_CHANGED_EVENT,
  DIRECT_AUTH_RECHECK_EVENT,
  getDirectAccessToken,
  directAuthVersion,
  observeDirectAuthPeers,
  setDirectAuthChecking,
} from '../../features/auth-login/api/directAuthSessionState';
import { restoreVerifiedDirectSession } from '../../features/auth-login/api/directAuthSessionRefresh';
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
    const check = (): Promise<void> => {
      if (pending) {
        queued = true;
        return pending;
      }
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
          await restoreVerifiedDirectSession();
          if (active && !queued) {
            setStatus((state) =>
              state === 'logging-in' || state === 'logging-out'
                ? state
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
        } catch {
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
            queued = false;
            void check();
          }
        }
      })();
      return pending;
    };
    const changed = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      if (reason === 'peer' || reason === 'expired') {
        void check();
        return;
      }
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
      if (document.visibilityState !== 'hidden') void check();
    };
    const retry = () => {
      void check();
    };
    const stop = observeDirectAuthPeers();
    window.addEventListener(DIRECT_AUTH_CHANGED_EVENT, changed);
    window.addEventListener(DIRECT_AUTH_RECHECK_EVENT, retry);
    for (const event of ['focus', 'pageshow', 'online']) window.addEventListener(event, visible);
    document.addEventListener('visibilitychange', visible);
    void check();
    return () => {
      active = false;
      stop();
      window.removeEventListener(DIRECT_AUTH_CHANGED_EVENT, changed);
      window.removeEventListener(DIRECT_AUTH_RECHECK_EVENT, retry);
      for (const event of ['focus', 'pageshow', 'online'])
        window.removeEventListener(event, visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [setStatus, setFormVersion]);
}
