import { inspectCommittedDirectLogout } from './directAuthLogoutFlow';
import { operationTuple } from './directAuthTuple';
import {
  bootstrapDirectAuth,
  readCurrentDirectOperation,
  readDirectAuthFlow,
} from './directAuthFlowApi';
import { submitDirectLogin } from './directAuthLoginApi';
import { readDirectLoginOperation } from './directAuthOperationApi';
import {
  clearDirectAuthOperation,
  createDirectAuthOperation,
  persistDirectAuthOperation,
  readDirectAuthOperation,
  sameDirectAuthOperation,
} from './directAuthOperationStore';
import { matchesLiveLogin, matchesRejectedLogin } from './directAuthCanonical';
import { readDirectCsrf } from './directAuthSessionApi';
import { directAuthVersion, installDirectSession } from './directAuthSessionState';
import {
  DirectAuthApiError,
  DirectAuthProtocolError,
  type DirectAuthOperation,
  type TerminalOperationData,
  type TokenData,
} from './directAuthTypes';

export async function directCsrf(): Promise<string> {
  const response = await readDirectCsrf();
  if (!response.data?.csrf_token) throw new DirectAuthProtocolError();
  return response.data.csrf_token;
}

export function unresolvedDirectOperation(): DirectAuthOperation | null {
  return (
    readDirectAuthOperation('LOGOUT') ??
    readDirectAuthOperation('LOGIN') ??
    readDirectAuthOperation('REFRESH') ??
    readDirectAuthOperation('BOOTSTRAP') ??
    readDirectAuthOperation('LOGIN_RECOVERY') ??
    readDirectAuthOperation('REFRESH_RECOVERY') ??
    readDirectAuthOperation('REBOOTSTRAP')
  );
}

async function loginFlow(csrf: string, version: number) {
  try {
    const existing = await readDirectAuthFlow();
    if (!existing.data) throw new DirectAuthProtocolError();
    return existing.data;
  } catch (error) {
    if (
      !(error instanceof DirectAuthApiError) ||
      error.status !== 404 ||
      !['AUTH_FLOW_REQUIRED', 'AUTH_FLOW_NOT_FOUND'].includes(error.code)
    )
      throw error;
  }
  if (readDirectAuthOperation('BOOTSTRAP')) throw new DirectAuthProtocolError();
  if (version !== directAuthVersion()) throw new DirectAuthProtocolError();
  const bootstrap = createDirectAuthOperation('BOOTSTRAP', null, null, crypto.randomUUID());
  persistDirectAuthOperation('BOOTSTRAP', bootstrap);
  const response = await bootstrapDirectAuth(bootstrap, csrf);
  if (
    !response.data ||
    response.data.loginProtocol !== 'direct-v2' ||
    response.data.authenticated ||
    response.data.lifecycle !== 'ANONYMOUS'
  )
    throw new DirectAuthProtocolError();
  if (version !== directAuthVersion()) throw new DirectAuthProtocolError();
  if (!clearDirectAuthOperation('BOOTSTRAP', bootstrap)) throw new DirectAuthProtocolError();
  return response.data;
}

export async function startDirectLogin(
  credentials: { email: string; password: string },
  version: number,
): Promise<{ operation: DirectAuthOperation; token: TokenData | null }> {
  if (unresolvedDirectOperation()) throw new DirectAuthProtocolError();
  const csrf = await directCsrf();
  const flow = await loginFlow(csrf, version);
  if (version !== directAuthVersion() || flow.authenticated || flow.lifecycle !== 'ANONYMOUS')
    throw new DirectAuthProtocolError();
  const operation = createDirectAuthOperation(
    'LOGIN',
    flow.flowId,
    flow.flowEpoch,
    crypto.randomUUID(),
  );
  persistDirectAuthOperation('LOGIN', operation);
  let response;
  try {
    response = await submitDirectLogin(operation, operationTuple(operation), credentials, csrf);
  } catch (error) {
    throw new DirectLoginAttemptError(operation, error);
  }
  if (version !== directAuthVersion()) throw new DirectAuthProtocolError();
  return {
    operation,
    token: response.message === 'login success' ? (response.data as TokenData) : null,
  };
}

export async function inspectDirectLogin(operation: DirectAuthOperation): Promise<{
  terminal: TerminalOperationData | null;
  canonicalMatches: boolean;
  rejected?: boolean;
}> {
  const persisted = readDirectAuthOperation('LOGIN');
  if (
    !persisted ||
    !sameDirectAuthOperation(persisted, operation) ||
    operation.expiresAt <= Date.now()
  )
    throw new DirectAuthProtocolError();
  const response = await readDirectLoginOperation(operationTuple(operation));
  const data = response.data;
  if (!data || typeof data !== 'object' || !('status' in data)) throw new DirectAuthProtocolError();
  if (data.status === 'IN_PROGRESS') return { terminal: null, canonicalMatches: false };
  const terminal = data as TerminalOperationData;
  const current = await readCurrentDirectOperation(operationTuple(operation));
  return {
    terminal,
    canonicalMatches: matchesLiveLogin(current.data, operation, terminal),
    rejected: matchesRejectedLogin(current.data, operation, terminal),
  };
}

export async function completeDirectLogin(
  operation: DirectAuthOperation,
  token: TokenData,
  version: number,
): Promise<boolean> {
  if (
    !token.access_token ||
    !/^[1-9][0-9]*$/.test(token.expires_in) ||
    !Number.isSafeInteger(Number(token.expires_in)) ||
    !Number.isSafeInteger(Date.now() + Number(token.expires_in) * 1000)
  )
    throw new DirectAuthProtocolError();
  const result = await inspectDirectLogin(operation);
  if (!result.terminal || !result.canonicalMatches || version !== directAuthVersion())
    throw new DirectAuthProtocolError();
  const current = await readCurrentDirectOperation(operationTuple(operation));
  if (
    !matchesLiveLogin(current.data, operation, result.terminal) ||
    version !== directAuthVersion()
  )
    throw new DirectAuthProtocolError();
  const persisted = readDirectAuthOperation('LOGIN');
  if (!persisted || !sameDirectAuthOperation(persisted, operation))
    throw new DirectAuthProtocolError();
  const recovery = readDirectAuthOperation('LOGIN_RECOVERY');
  if (
    recovery &&
    (!sameDirectAuthOperation(recovery, operation) ||
      !clearDirectAuthOperation('LOGIN_RECOVERY', recovery))
  )
    throw new DirectAuthProtocolError();
  if (!clearDirectAuthOperation('LOGIN', operation)) throw new DirectAuthProtocolError();
  return installDirectSession(version, token.access_token, token.expires_in, current.data.flow);
}

export async function restoreDirectSession(): Promise<void> {
  const pending = readDirectAuthOperation('LOGOUT');
  if (pending) {
    await inspectCommittedDirectLogout(pending, directAuthVersion());
    return;
  }
  await readCurrentDirectOperation();
}

export class DirectLoginAttemptError extends Error {
  readonly operation: DirectAuthOperation;
  readonly rejection: unknown;
  constructor(operation: DirectAuthOperation, rejection: unknown) {
    super('Direct login attempt failed');
    this.operation = operation;
    this.rejection = rejection;
  }
}

export function releaseRejectedDirectLogin(
  operation: DirectAuthOperation,
  version: number,
): boolean {
  return version === directAuthVersion() && clearDirectAuthOperation('LOGIN', operation);
}

export async function resolveDirectLoginFailure(error: unknown, version: number): Promise<boolean> {
  if (version !== directAuthVersion()) return false;
  if (!(error instanceof DirectLoginAttemptError)) return !unresolvedDirectOperation();
  const rejection = error.rejection;
  const preAdmission =
    rejection instanceof DirectAuthApiError &&
    ((rejection.status === 400 &&
      [
        'INVALID_LOGIN_REQUEST',
        'INVALID_CLIENT_EXPIRY',
        'INVALID_LOGIN_PROTOCOL',
        'INVALID_AUTH_FLOW_TUPLE',
        'INVALID_OPERATION_ID',
      ].includes(rejection.code)) ||
      (rejection.status === 403 && ['CSRF_DENIED', 'ORIGIN_NOT_ALLOWED'].includes(rejection.code)));
  if (!preAdmission) {
    const result = await inspectDirectLogin(error.operation);
    if (!result.rejected || version !== directAuthVersion()) return false;
  }
  return version === directAuthVersion() && releaseRejectedDirectLogin(error.operation, version);
}
