import { requestDirectAuth, type DirectAuthTuple } from './directAuthHttp';
import type {
  CsrfTokenEnvelope,
  DirectAuthOperation,
  LogoutEnvelope,
  RefreshEnvelope,
  RefreshRecoveryInProgressEnvelope,
  RefreshSessionRecoveryEnvelope,
} from './directAuthTypes';

type Options = { fetcher?: typeof fetch; storage?: Storage };
export function readDirectCsrf(fetcher?: typeof fetch): Promise<CsrfTokenEnvelope> {
  return requestDirectAuth({ route: 'csrf', fetcher });
}
export function refreshDirectSession(
  operation: DirectAuthOperation,
  tuple: DirectAuthTuple,
  csrf: string,
  options: Options = {},
): Promise<RefreshEnvelope> {
  return requestDirectAuth({
    route: 'refresh',
    tuple,
    csrf,
    mutation: { kind: 'REFRESH', operation, storage: options.storage },
    fetcher: options.fetcher,
  });
}
export function logoutDirectSession(
  operation: DirectAuthOperation,
  tuple: DirectAuthTuple,
  csrf: string,
  options: Options = {},
): Promise<LogoutEnvelope> {
  return requestDirectAuth({
    route: 'logout',
    tuple,
    csrf,
    mutation: { kind: 'LOGOUT', operation, storage: options.storage },
    fetcher: options.fetcher,
  });
}
export function recoverDirectRefresh(
  operation: DirectAuthOperation,
  tuple: DirectAuthTuple,
  csrf: string,
  options: Options = {},
): Promise<RefreshSessionRecoveryEnvelope | RefreshRecoveryInProgressEnvelope> {
  return requestDirectAuth({
    route: 'refreshRecovery',
    tuple,
    csrf,
    mutation: { kind: 'REFRESH_RECOVERY', operation, storage: options.storage },
    fetcher: options.fetcher,
  });
}
