import { requestDirectAuth, type DirectAuthTuple } from './directAuthHttp';
import type {
  CurrentOperationEnvelope,
  DirectAuthOperation,
  FlowEnvelope,
  RebootstrapEnvelope,
} from './directAuthTypes';

type Options = { fetcher?: typeof fetch; storage?: Storage };
export function readDirectAuthFlow(fetcher?: typeof fetch): Promise<FlowEnvelope> {
  return requestDirectAuth({ route: 'flow', fetcher });
}
export function readCurrentDirectOperation(
  tuple?: DirectAuthTuple,
  fetcher?: typeof fetch,
): Promise<CurrentOperationEnvelope> {
  return requestDirectAuth({ route: 'currentOperation', tuple, fetcher });
}
export function bootstrapDirectAuth(
  operation: DirectAuthOperation,
  csrf: string,
  options: Options = {},
): Promise<FlowEnvelope> {
  return requestDirectAuth({
    route: 'bootstrap',
    csrf,
    mutation: { kind: 'BOOTSTRAP', operation, storage: options.storage },
    fetcher: options.fetcher,
  });
}
export function rebootstrapDirectAuth(
  operation: DirectAuthOperation,
  tuple: DirectAuthTuple,
  csrf: string,
  options: Options = {},
): Promise<RebootstrapEnvelope> {
  return requestDirectAuth({
    route: 'rebootstrap',
    tuple,
    csrf,
    mutation: { kind: 'REBOOTSTRAP', operation, storage: options.storage },
    fetcher: options.fetcher,
  });
}
