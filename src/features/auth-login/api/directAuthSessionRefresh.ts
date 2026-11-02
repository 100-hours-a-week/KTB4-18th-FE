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
} from './directAuthSessionState';
import { operationTuple } from './directAuthTuple';
import { DirectAuthApiError, DirectAuthProtocolError } from './directAuthTypes';

const attempted = new Set<string>();
let pending: Promise<void> | null = null;

export function restoreVerifiedDirectSession(): Promise<void> {
  if (pending) return pending;
  pending = restoreOnce().finally(() => {
    pending = null;
  });
  return pending;
}

async function restoreOnce(): Promise<void> {
  let version = directAuthVersion();
  const logout = readDirectAuthOperation('LOGOUT');
  if (logout) {
    if (await inspectCommittedDirectLogout(logout, version)) return;
    if (logout.expiresAt > Date.now() || !(await releaseExpiredDirectLogout(logout, version)))
      return;
  }
  const existing = getDirectAccessToken();
  if (existing) {
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
    if (version !== directAuthVersion()) return;
    if (response.status === 200) {
      const current = await readCurrentDirectOperation();
      if (version !== directAuthVersion()) return;
      if (
        current.data.flow.authenticated &&
        current.data.flow.flowId === directAuthFlow()?.flowId
      ) {
        if (confirmDirectSession(version, existing, current.data.flow)) return;
        if (version !== directAuthVersion() || getDirectAccessToken()) return;
      }
      clearDirectSession();
      version = directAuthVersion();
      if (!current.data.flow.authenticated) return;
    } else {
      if (response.status !== 401) throw new DirectAuthProtocolError();
      clearDirectSession();
      version = directAuthVersion();
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
    )
      return;
    throw error;
  }
  if (
    version !== directAuthVersion() ||
    !isDirectRefreshVerified() ||
    getDirectAccessToken() ||
    !current.data.flow.authenticated ||
    current.data.flow.lifecycle !== 'AUTHENTICATED' ||
    current.data.flow.proofState !== 'ACTIVE'
  )
    return;
  for (const kind of [
    'LOGIN',
    'REFRESH',
    'LOGOUT',
    'BOOTSTRAP',
    'LOGIN_RECOVERY',
    'REFRESH_RECOVERY',
    'REBOOTSTRAP',
  ] as const)
    if (readDirectAuthOperation(kind)) return;
  const key = [
    current.data.flow.flowId,
    current.data.flow.flowEpoch,
    current.data.flow.revision,
  ].join(':');
  if (attempted.has(key)) return;
  const csrf = (await readDirectCsrf()).data?.csrf_token;
  if (!csrf || version !== directAuthVersion()) throw new DirectAuthProtocolError();
  const source = createDirectAuthOperation(
    'REFRESH',
    current.data.flow.flowId,
    current.data.flow.flowEpoch,
    crypto.randomUUID(),
  );
  persistDirectAuthOperation('REFRESH', source);
  if (version !== directAuthVersion()) {
    if (!clearDirectAuthOperation('REFRESH', source)) throw new DirectAuthProtocolError();
    throw new DirectAuthProtocolError();
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
    if (!dispatched) clearDirectAuthOperation('REFRESH', source);
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
  if (version !== directAuthVersion() || !matchesLiveRefresh(canonical.data, source))
    throw new DirectAuthProtocolError();
  if (!clearDirectAuthOperation('REFRESH', source)) throw new DirectAuthProtocolError();
  if (!installDirectSession(version, token.access_token, token.expires_in, canonical.data.flow))
    throw new DirectAuthProtocolError();
}
