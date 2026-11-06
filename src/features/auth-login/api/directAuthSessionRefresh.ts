import { inspectCommittedDirectLogout, releaseExpiredDirectLogout } from './directAuthLogoutFlow';
import { isDirectRefreshVerified } from './authProtocolMode';
import { matchesLiveRefresh } from './directAuthCanonical';
import { readCurrentDirectOperation } from './directAuthFlowApi';
import { readDirectCsrf, refreshDirectSession } from './directAuthSessionApi';
import {
  clearDirectAuthOperation,
  createDirectAuthOperation,
  persistDirectAuthOperation,
  readDirectAuthOperation,
} from './directAuthOperationStore';
import {
  clearDirectSession,
  confirmDirectSession,
  directAuthVersion,
  getDirectAccessToken,
  directAuthFlow,
  installDirectSession,
  restoreDirectSessionAfterUnavailable,
  setDirectAuthRecoveryUnavailable,
  suspendDirectSessionForRefresh,
  type SuspendedDirectSession,
} from './directAuthSessionState';
import { operationTuple } from './directAuthTuple';
import { DirectAuthApiError, DirectAuthProtocolError } from './directAuthTypes';

const attempted = new Set<string>();
export type DirectSessionRestoreResult =
  'REFRESHED' | 'VALID' | 'INVALID' | 'UNAVAILABLE' | 'SUPERSEDED';
let pending: Promise<DirectSessionRestoreResult> | null = null;

export function restoreVerifiedDirectSession(
  options: { forceRefresh?: boolean } = {},
): Promise<DirectSessionRestoreResult> {
  if (pending) return pending;
  const initialVersion = directAuthVersion();
  let suspended: SuspendedDirectSession | null = null;
  pending = restoreOnce(
    (snapshot) => {
      suspended = snapshot;
    },
    options.forceRefresh === true && isDirectRefreshVerified(),
  )
    .then((result) => {
      if (
        result === 'INVALID' &&
        directAuthVersion() === (suspended?.version ?? initialVersion) &&
        getDirectAccessToken()
      )
        clearDirectSession();
      if (suspended && result !== 'REFRESHED' && result !== 'INVALID')
        restoreDirectSessionAfterUnavailable(suspended);
      setDirectAuthRecoveryUnavailable(result === 'UNAVAILABLE');
      return result;
    })
    .catch((error) => {
      if (
        suspended &&
        error instanceof DirectAuthApiError &&
        error.status === 401 &&
        directAuthVersion() === suspended.version
      )
        clearDirectSession();
      if (suspended && !(error instanceof DirectAuthApiError && error.status === 401))
        restoreDirectSessionAfterUnavailable(suspended);
      setDirectAuthRecoveryUnavailable(
        !(error instanceof DirectAuthApiError && error.status === 401),
      );
      throw error;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

async function restoreOnce(
  suspend: (snapshot: SuspendedDirectSession) => void,
  forceRefresh: boolean,
): Promise<DirectSessionRestoreResult> {
  const version = directAuthVersion();
  const logout = readDirectAuthOperation('LOGOUT');
  if (logout) {
    if (await inspectCommittedDirectLogout(logout, version)) return 'INVALID';
    if (logout.expiresAt > Date.now() || !(await releaseExpiredDirectLogout(logout, version)))
      return 'UNAVAILABLE';
  }
  const existing = getDirectAccessToken();
  if (existing) {
    const suspended = suspendDirectSessionForRefresh();
    if (!suspended) return 'SUPERSEDED';
    suspend(suspended);
    if (!forceRefresh) {
      const response = await fetch(
        `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}/api/v1/users/me`,
        {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: { Authorization: `Bearer ${existing}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (version !== directAuthVersion()) return 'SUPERSEDED';
      if (response.status === 200) {
        const current = await readCurrentDirectOperation();
        if (version !== directAuthVersion()) return 'SUPERSEDED';
        if (
          current.data.flow.authenticated &&
          current.data.flow.flowId === directAuthFlow()?.flowId &&
          restoreDirectSessionAfterUnavailable(suspended)
        ) {
          if (confirmDirectSession(version, existing, current.data.flow)) return 'VALID';
          if (version !== directAuthVersion() || getDirectAccessToken()) return 'SUPERSEDED';
        }
        clearDirectSession();
        return 'INVALID';
      } else {
        if (response.status !== 401) {
          restoreDirectSessionAfterUnavailable(suspended);
          throw new DirectAuthProtocolError();
        }
        // Keep the access token suspended until cookie refresh completes so a
        // transient refresh failure can restore this tab's original session.
      }
    }
  }
  let current;
  try {
    current = await readCurrentDirectOperation();
  } catch (error) {
    if (
      error instanceof DirectAuthApiError &&
      error.status === 404 &&
      error.code === 'AUTH_FLOW_NOT_FOUND'
    ) {
      clearDirectSession();
      return 'INVALID';
    }
    throw error;
  }
  if (
    version !== directAuthVersion() ||
    !isDirectRefreshVerified() ||
    getDirectAccessToken() ||
    !current.data.flow.authenticated ||
    current.data.flow.lifecycle !== 'AUTHENTICATED' ||
    current.data.flow.proofState !== 'ACTIVE'
  ) {
    if (version !== directAuthVersion()) return 'SUPERSEDED';
    if (!current.data.flow.authenticated) {
      clearDirectSession();
      return 'INVALID';
    }
    return 'UNAVAILABLE';
  }
  for (const kind of [
    'LOGIN',
    'REFRESH',
    'LOGOUT',
    'BOOTSTRAP',
    'LOGIN_RECOVERY',
    'REFRESH_RECOVERY',
    'REBOOTSTRAP',
  ] as const)
    if (readDirectAuthOperation(kind)) return 'UNAVAILABLE';
  const key = [
    current.data.flow.flowId,
    current.data.flow.flowEpoch,
    current.data.flow.revision,
  ].join(':');
  if (attempted.has(key)) return 'UNAVAILABLE';
  const csrf = (await readDirectCsrf()).data?.csrf_token;
  if (version !== directAuthVersion()) return 'SUPERSEDED';
  if (!csrf) throw new DirectAuthProtocolError();
  const source = createDirectAuthOperation(
    'REFRESH',
    current.data.flow.flowId,
    current.data.flow.flowEpoch,
    crypto.randomUUID(),
  );
  persistDirectAuthOperation('REFRESH', source);
  if (version !== directAuthVersion()) {
    if (!clearDirectAuthOperation('REFRESH', source)) throw new DirectAuthProtocolError();
    return 'SUPERSEDED';
  }
  let dispatched = false;
  let response;
  try {
    response = await refreshDirectSession(source, operationTuple(source), csrf, {
      fetcher: (input, init) => {
        dispatched = true;
        attempted.add(key);
        return fetch(input, init);
      },
    });
  } catch (error) {
    if (!dispatched) {
      clearDirectAuthOperation('REFRESH', source);
    } else if (error instanceof DirectAuthApiError && error.status === 401) {
      // An explicit invalid-session response is terminal for this tab. Release
      // the local operation marker so the login form can accept fresh credentials.
      if (!clearDirectAuthOperation('REFRESH', source)) throw new DirectAuthProtocolError();
      clearDirectSession();
    }
    throw error;
  }
  const token = response.data;
  if (
    !token?.access_token ||
    !/^[1-9][0-9]*$/.test(token.expires_in) ||
    !Number.isSafeInteger(Date.now() + Number(token.expires_in) * 1000)
  )
    throw new DirectAuthProtocolError();
  const canonical = await readCurrentDirectOperation(operationTuple(source));
  if (version !== directAuthVersion()) return 'SUPERSEDED';
  if (!matchesLiveRefresh(canonical.data, source)) throw new DirectAuthProtocolError();
  if (!clearDirectAuthOperation('REFRESH', source)) throw new DirectAuthProtocolError();
  if (!installDirectSession(version, token.access_token, token.expires_in, canonical.data.flow))
    return 'SUPERSEDED';
  return 'REFRESHED';
}
