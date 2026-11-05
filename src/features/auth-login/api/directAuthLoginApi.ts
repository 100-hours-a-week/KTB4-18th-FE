import { requestDirectAuth, type DirectAuthTuple } from './directAuthHttp';
import type { DirectAuthOperation, InProgressEnvelope, TokenEnvelope } from './directAuthTypes';

type Options = { fetcher?: typeof fetch; storage?: Storage };
export function submitDirectLogin(
  operation: DirectAuthOperation,
  tuple: DirectAuthTuple,
  credentials: { email: string; password: string },
  csrf: string,
  options: Options = {},
): Promise<TokenEnvelope | InProgressEnvelope> {
  return requestDirectAuth({
    route: 'login',
    tuple,
    body: credentials,
    csrf,
    mutation: { kind: 'LOGIN', operation, storage: options.storage },
    fetcher: options.fetcher,
  });
}
export function recoverDirectLogin(
  operation: DirectAuthOperation,
  tuple: DirectAuthTuple,
  csrf: string,
  options: Options = {},
): Promise<TokenEnvelope | InProgressEnvelope> {
  return requestDirectAuth({
    route: 'loginRecovery',
    tuple,
    csrf,
    mutation: { kind: 'LOGIN_RECOVERY', operation, storage: options.storage },
    fetcher: options.fetcher,
  });
}
