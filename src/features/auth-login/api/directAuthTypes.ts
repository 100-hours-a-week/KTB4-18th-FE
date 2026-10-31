import type { ExpiryFields } from './directAuthExpiry';
export type Decimal64 = string;

export type DirectAuthOperationKind =
  | 'BOOTSTRAP'
  | 'LOGIN'
  | 'LOGIN_RECOVERY'
  | 'REFRESH'
  | 'LOGOUT'
  | 'REBOOTSTRAP'
  | 'REFRESH_RECOVERY';

export type DirectAuthOperation = {
  flowId: string | null;
  startingEpoch: Decimal64 | null;
  operationId: string;
  expiresAt: number;
};

export function isDecimal64(value: unknown, allowZero = false): value is Decimal64 {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) return false;
  if (!allowZero && value === '0') return false;
  return value.length < 19 || (value.length === 19 && value <= '9223372036854775807');
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
export type CsrfTokenData = { csrf_token: string };
export type CsrfTokenEnvelope = EnvelopeBase & {
  message?: 'csrf token issued';
  data?: CsrfTokenData;
};
export type CurrentOperationEnvelope = EnvelopeBase & {
  message: 'current auth operation';
  data: CurrentOperationLookup;
};
export type CurrentOperationFlow = {
  flowId: string;
  flowEpoch: string;
  revision: string;
  lifecycle: Lifecycle;
  authenticated: boolean;
  proofState: 'ACTIVE' | 'REBOOTSTRAP_REQUIRED';
};
export type CurrentOperationLookup = {
  flow: CurrentOperationFlow;
  operation: null | CurrentOperationSummary;
};
export type CurrentOperationSummary = ExpiryFields & {
  flowId: string;
  startingEpoch: string;
  operationId: string;
  kind: 'LOGIN' | 'REFRESH' | 'LOGOUT';
  status:
    | 'IN_PROGRESS'
    | 'SUCCEEDED'
    | 'NOT_ADMITTED'
    | 'INVALID_CREDENTIALS'
    | 'SUPERSEDED'
    | 'REAUTH_REQUIRED';
  resultEpoch: string | null;
  resultRevision: string | null;
  reasonCode: 'AUTH_BCRYPT_CAPACITY' | 'AUTH_LOGIN_IN_PROGRESS' | null;
  leaseExpiresAt: string | null;
  receiptExpiresAt: string | null;
};
export type EnvelopeBase = { message: string; data: unknown };
export type FlowData = {
  flowId: string;
  flowEpoch: string;
  revision: string;
  lifecycle: Lifecycle;
  authenticated: boolean;
  refreshGeneration: string;
  currentTicket: null;
  pendingOperations: Array<PendingOperation>;
  lastLogoutReceipt: null | LogoutReceipt;
  lastRefreshReceipt: null | RefreshReceipt;
  lastQueueCancelReceipt: null | QueueCancelReceipt;
  rebootstrapReason: 'EXISTING' | 'CREATED' | 'INVALID_COOKIE' | 'EXPIRED_COOKIE' | null;
  loginProtocol: 'direct-v2';
  flowCookieGeneration: string;
  flowCookieExpiresAt: string;
};
export type FlowEnvelope = EnvelopeBase & { message?: 'auth flow'; data?: FlowData };
export type InProgressEnvelope = EnvelopeBase & {
  message?: 'LOGIN_IN_PROGRESS';
  data?: OperationInProgressData;
};
export type Lifecycle = 'ANONYMOUS' | 'AUTHENTICATING' | 'AUTHENTICATED' | 'RETIRED';
export type LogoutData = { logoutReceipt: LogoutReceipt };
export type LogoutEnvelope = EnvelopeBase & { message?: 'logout committed'; data?: LogoutData };
export type LogoutReceipt = {
  operationId: string;
  committed: boolean;
  flowEpoch: string;
  revision: string;
  completedAt: string;
};
export type OperationInProgressData = {
  operationId: string;
  flowId: string;
  startingEpoch: string;
  status: 'IN_PROGRESS';
  resultEpoch: null;
  resultRevision: null;
};
export type PendingOperation = {
  operationId: string;
  kind: 'LOGOUT' | 'REFRESH' | 'QUEUE_CANCEL' | 'DIRECT_LOGIN';
};
export type QueueCancelReceipt = {
  operationId: string;
  committed: boolean;
  flowEpoch: string;
  revision: string;
};
export type RebootstrapData = {
  flow: CurrentOperationFlow;
  operationId: string;
  startingEpoch: string;
  resultEpoch: string;
  resultRevision: string;
};
export type RebootstrapEnvelope = EnvelopeBase & {
  message: 'auth flow rebootstrap';
  data: RebootstrapData;
};
export type RefreshEnvelope = EnvelopeBase & { message?: 'token refreshed'; data?: TokenData };
export type RefreshReceipt = {
  operationId: string;
  committed: boolean;
  flowEpoch: string;
  revision: string;
  resultGeneration: string;
};
export type RefreshRecoveryCurrentData = ExpiryFields & {
  flowId: string;
  operationId: string;
  startingEpoch: string;
  recoveryOperationId: string | null;
  status: 'NONE' | 'IN_PROGRESS' | 'SUCCEEDED' | 'RESULT_STALE' | 'EXPIRED';
  leaseExpiresAt: string | null;
  resultEpoch: string | null;
  resultRevision: string | null;
};
export type RefreshRecoveryCurrentEnvelope = EnvelopeBase & {
  message: 'current refresh recovery';
  data: RefreshRecoveryCurrentData;
};
export type RefreshRecoveryInProgressData = {
  flowId: string;
  operationId: string;
  recoveryOperationId: string;
  startingEpoch: string;
  status: 'IN_PROGRESS';
  leaseExpiresAt: string;
};
export type RefreshRecoveryInProgressEnvelope = EnvelopeBase & {
  message: 'RECOVERY_IN_PROGRESS';
  data: RefreshRecoveryInProgressData;
};
export type RefreshRecoveryStatusData = ExpiryFields & {
  flowId: string;
  operationId: string;
  recoveryOperationId: string;
  startingEpoch: string;
  status: 'NOT_RECEIVED' | 'IN_PROGRESS' | 'SUCCEEDED';
  leaseExpiresAt: string | null;
  resultEpoch: string | null;
  resultRevision: string | null;
};
export type RefreshRecoveryStatusEnvelope = EnvelopeBase & {
  message: 'refresh recovery status';
  data: RefreshRecoveryStatusData;
};
export type RefreshSessionRecoveryData = {
  flowId: string;
  operationId: string;
  recoveryOperationId: string;
  startingEpoch: string;
  resultEpoch: string;
  resultRevision: string;
  access_token: string;
  expires_in: string;
};
export type RefreshSessionRecoveryEnvelope = EnvelopeBase & {
  message: 'refresh session recovered';
  data: RefreshSessionRecoveryData;
};
export type TerminalOperationData = {
  operationId: string;
  flowId: string;
  startingEpoch: string;
  status: 'SUCCEEDED' | 'INVALID_CREDENTIALS' | 'SUPERSEDED' | 'REAUTH_REQUIRED' | 'NOT_ADMITTED';
  resultEpoch: string;
  resultRevision: string;
  reasonCode: 'AUTH_BCRYPT_CAPACITY' | 'AUTH_LOGIN_IN_PROGRESS' | null;
};
export type TerminalStatusEnvelope = EnvelopeBase & {
  message?: 'login operation';
  data?: TerminalOperationData;
};
export type TokenData = { access_token: string; expires_in: string };
export type TokenEnvelope = EnvelopeBase & { message?: 'login success'; data?: TokenData };

export type RefreshRecoveryLeaseExpiredData = ExpiryFields & {
  flowId: string;
  operationId: string;
  recoveryOperationId: string;
  startingEpoch: Decimal64;
  status: 'LEASE_EXPIRED';
  leaseExpiresAt: string;
  resultEpoch: null;
  resultRevision: null;
};

export function isDirectLoginBody(value: unknown): value is { email: string; password: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return (
    Object.keys(body).sort().join(',') === 'email,password' &&
    typeof body.email === 'string' &&
    body.email.length <= 254 &&
    /^[^\s@]+@[^\s@]+$/.test(body.email) &&
    typeof body.password === 'string' &&
    body.password.length > 0 &&
    body.password.length <= 1024
  );
}

export class DirectAuthProtocolError extends Error {
  constructor() {
    super('Invalid or unavailable direct authentication response');
    this.name = 'DirectAuthProtocolError';
  }
}
export class DirectAuthApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly data: RefreshRecoveryLeaseExpiredData | null;
  readonly retryAfter: string | null;
  constructor(
    status: number,
    code: string,
    data: RefreshRecoveryLeaseExpiredData | null,
    retryAfter: string | null,
  ) {
    super(code);
    this.name = 'DirectAuthApiError';
    this.status = status;
    this.code = code;
    this.data = data;
    this.retryAfter = retryAfter;
  }
}
