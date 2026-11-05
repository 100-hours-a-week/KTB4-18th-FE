import { requestDirectAuth, type DirectAuthTuple } from './directAuthHttp';
import type {
  InProgressEnvelope,
  RefreshRecoveryCurrentEnvelope,
  RefreshRecoveryStatusEnvelope,
  TerminalStatusEnvelope,
} from './directAuthTypes';

export function readDirectLoginOperation(
  tuple: DirectAuthTuple,
  fetcher?: typeof fetch,
): Promise<TerminalStatusEnvelope | InProgressEnvelope> {
  return requestDirectAuth({ route: 'loginStatus', tuple, fetcher });
}
export function readRefreshRecoveryOperation(
  tuple: DirectAuthTuple,
  fetcher?: typeof fetch,
): Promise<RefreshRecoveryStatusEnvelope> {
  return requestDirectAuth({ route: 'refreshRecoveryStatus', tuple, fetcher });
}
export function readCurrentRefreshRecovery(
  tuple: DirectAuthTuple,
  fetcher?: typeof fetch,
): Promise<RefreshRecoveryCurrentEnvelope> {
  return requestDirectAuth({ route: 'refreshRecoveryCurrent', tuple, fetcher });
}
