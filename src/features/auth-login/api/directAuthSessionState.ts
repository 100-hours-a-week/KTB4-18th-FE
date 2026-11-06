import type { CurrentOperationFlow } from './directAuthTypes';

export const DIRECT_AUTH_RECHECK_EVENT = 'meomuneum:direct-auth-recheck';
export const DIRECT_AUTH_CHECKING_EVENT = 'meomuneum:direct-auth-checking';
let isChecking = true;
let recoveryUnavailable = false;
const checkOwners = new Set<symbol>();
function publishCheckingState(): void {
  const next = checkOwners.size > 0 || isChecking;
  if (publishedChecking === next) return;
  publishedChecking = next;
  window.dispatchEvent(new Event(DIRECT_AUTH_CHECKING_EVENT));
}
let publishedChecking = true;
export function setDirectAuthChecking(value: boolean): void {
  isChecking = value;
  publishCheckingState();
}
export function beginDirectAuthChecking(): () => void {
  const owner = Symbol('direct-auth-check');
  checkOwners.add(owner);
  publishCheckingState();
  return () => {
    if (!checkOwners.delete(owner)) return;
    publishCheckingState();
  };
}
export function getDirectAuthChecking(): boolean {
  return checkOwners.size > 0 || isChecking;
}
export function setDirectAuthRecoveryUnavailable(value: boolean): void {
  recoveryUnavailable = value;
}
export function isDirectAuthRecoveryUnavailable(): boolean {
  return recoveryUnavailable;
}
export type SuspendedDirectSession = {
  token: string;
  issuedAt: number;
  expiresAt: number;
  flow: CurrentOperationFlow | null;
  version: number;
};
export function suspendDirectSessionForRefresh(): SuspendedDirectSession | null {
  if (!token || tokenExpiresAt <= Date.now()) return null;
  const snapshot = { token, issuedAt: tokenIssuedAt, expiresAt: tokenExpiresAt, flow, version };
  clearTimeout(expiryTimer);
  token = null;
  tokenExpiresAt = 0;
  tokenIssuedAt = 0;
  return snapshot;
}
export function restoreDirectSessionAfterUnavailable(snapshot: SuspendedDirectSession): boolean {
  if (version !== snapshot.version || token !== null || snapshot.expiresAt <= Date.now())
    return false;
  token = snapshot.token;
  tokenIssuedAt = snapshot.issuedAt;
  tokenExpiresAt = snapshot.expiresAt;
  flow = snapshot.flow;
  const expiresAt = snapshot.expiresAt;
  expiryTimer = setTimeout(
    () => {
      if (token === snapshot.token && tokenExpiresAt === expiresAt && expiresAt <= Date.now()) {
        version += 1;
        token = null;
        tokenExpiresAt = 0;
        tokenIssuedAt = 0;
        changed('expired');
      }
    },
    Math.min(2147483647, Math.max(0, expiresAt - Date.now())),
  );
  changed('installed');
  return true;
}
export function subscribeDirectAuthChecking(listener: () => void): () => void {
  window.addEventListener(DIRECT_AUTH_CHECKING_EVENT, listener);
  return () => window.removeEventListener(DIRECT_AUTH_CHECKING_EVENT, listener);
}

export const DIRECT_AUTH_CHANGED_EVENT = 'meomuneum:direct-auth-changed';
let version = 0;
let token: string | null = null;
let tokenExpiresAt = 0;
let tokenIssuedAt = 0;
let flow: CurrentOperationFlow | null = null;
let channel: BroadcastChannel | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let transition: { token: string; version: number } | null = null;

function changed(reason: 'intent' | 'installed' | 'peer' | 'expired' | 'cleared') {
  window.dispatchEvent(new CustomEvent(DIRECT_AUTH_CHANGED_EVENT, { detail: { reason } }));
}

export function beginDirectAuthIntent(): number {
  clearTimeout(expiryTimer);
  recoveryUnavailable = false;
  version += 1;
  token = null;
  tokenExpiresAt = 0;
  tokenIssuedAt = 0;
  changed('intent');
  return version;
}

export function directAuthVersion(): number {
  return version;
}

export function directAuthFlow(): CurrentOperationFlow | null {
  return flow;
}

export function getDirectAccessToken(): string | null {
  if (tokenExpiresAt <= Date.now()) return null;
  return token;
}

export function getDirectAccessTokenExpiresAt(): number | null {
  return token && tokenExpiresAt > Date.now() ? tokenExpiresAt : null;
}

export function getDirectAccessTokenRefreshAt(): number | null {
  const expiresAt = getDirectAccessTokenExpiresAt();
  if (expiresAt === null) return null;
  const lifetime = expiresAt - tokenIssuedAt;
  const earlyWindow = Math.min(10 * 60 * 1000, Math.max(0, lifetime * 0.2));
  return expiresAt - earlyWindow;
}

export function installDirectSession(
  expectedVersion: number,
  nextToken: string,
  expiresIn: string,
  canonical: CurrentOperationFlow,
): boolean {
  const ttl = Number(expiresIn);
  if (
    version !== expectedVersion ||
    !nextToken ||
    !Number.isSafeInteger(ttl) ||
    ttl <= 0 ||
    !Number.isSafeInteger(Date.now() + ttl * 1000)
  )
    return false;
  token = nextToken;
  recoveryUnavailable = false;
  tokenIssuedAt = Date.now();
  tokenExpiresAt = Date.now() + ttl * 1000;
  flow = canonical;
  clearTimeout(expiryTimer);
  const deadline = tokenExpiresAt;
  expiryTimer = setTimeout(
    () => {
      if (token === nextToken && tokenExpiresAt === deadline && deadline <= Date.now()) {
        version += 1;
        token = null;
        tokenExpiresAt = 0;
        tokenIssuedAt = 0;
        changed('expired');
      }
    },
    Math.min(2147483647, Math.max(0, deadline - Date.now())),
  );
  changed('installed');
  channel?.postMessage({ type: 'changed' });
  return true;
}

export function clearDirectSession(): void {
  recoveryUnavailable = false;
  const owned = transition?.version === version ? transition : null;
  beginDirectAuthIntent();
  if (owned) owned.version = version;
  changed('cleared');
}

export function announceDirectAuthChange(): void {
  channel?.postMessage({ type: 'changed' });
}

export function observeDirectAuthPeers(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const active = new BroadcastChannel('meomuneum:direct-auth');
  channel = active;
  active.onmessage = (event: MessageEvent<unknown>) => {
    if (
      event.data &&
      typeof event.data === 'object' &&
      Object.keys(event.data).join(',') === 'type' &&
      (event.data as { type?: unknown }).type === 'changed'
    ) {
      version += 1;
      changed('peer');
    }
  };
  return () => {
    if (channel === active) channel = null;
    active.close();
  };
}

export async function directAuthenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  expectedToken?: string,
): Promise<Response> {
  if (typeof Request !== 'undefined' && input instanceof Request)
    throw new Error('Unsupported authenticated request');
  const currentToken = getDirectAccessToken();
  const currentVersion = version;
  if (!currentToken || (expectedToken !== undefined && expectedToken !== currentToken))
    throw new Error('Authentication required');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${currentToken}`);
  const response = await fetch(input, { ...init, headers, credentials: 'include' });
  if (version !== currentVersion || getDirectAccessToken() !== currentToken)
    throw new Error('Authentication changed');
  return response;
}

export async function runDirectAuthTransition<T>(action: () => Promise<T>): Promise<T> {
  const current = getDirectAccessToken();
  if (transition || !current) throw new Error('Authentication transition unavailable');
  const owned = { token: current, version };
  transition = owned;
  try {
    return await action();
  } finally {
    if (transition === owned) transition = null;
    announceDirectAuthChange();
  }
}

export function isDirectTransitionToken(value: string): boolean {
  return transition?.token === value && transition.version === version;
}

export async function directFetchWithinTransition(
  input: RequestInfo | URL,
  init: RequestInit,
  expectedToken: string,
): Promise<Response> {
  const owned = transition;
  if (
    !owned ||
    !isDirectTransitionToken(expectedToken) ||
    (typeof Request !== 'undefined' && input instanceof Request)
  )
    throw new Error('Authentication transition changed');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${expectedToken}`);
  const response = await fetch(input, { ...init, headers, credentials: 'include' });
  if (transition !== owned || owned.version !== version) throw new Error('Authentication changed');
  return response;
}

export function confirmDirectSession(
  expectedVersion: number,
  expectedToken: string,
  canonical: CurrentOperationFlow,
): boolean {
  if (version !== expectedVersion || getDirectAccessToken() !== expectedToken) return false;
  flow = canonical;
  return true;
}
