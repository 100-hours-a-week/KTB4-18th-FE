import { readCurrentDirectOperation, readDirectAuthFlow } from './directAuthFlowApi';
import { matchesCommittedLogout } from './directAuthCanonical';
import {
  clearDirectAuthOperation,
  createDirectAuthOperation,
  persistDirectAuthOperation,
  readDirectAuthOperation,
} from './directAuthOperationStore';
import { operationTuple } from './directAuthTuple';
import { logoutDirectSession, readDirectCsrf } from './directAuthSessionApi';
import {
  announceDirectAuthChange,
  beginDirectAuthIntent,
  directAuthFlow,
  directAuthVersion,
} from './directAuthSessionState';
import { DirectAuthProtocolError, type DirectAuthOperation } from './directAuthTypes';

export async function inspectCommittedDirectLogout(
  operation: DirectAuthOperation,
  version: number,
): Promise<boolean> {
  const flowResponse = await readDirectAuthFlow();
  const receipt = flowResponse.data?.lastLogoutReceipt;
  if (!receipt || flowResponse.data?.flowId !== operation.flowId) return false;
  const current = await readCurrentDirectOperation(operationTuple(operation));
  if (version !== directAuthVersion() || !matchesCommittedLogout(current.data, operation, receipt))
    return false;
  return clearDirectAuthOperation('LOGOUT', operation);
}

export async function releaseExpiredDirectLogout(
  operation: DirectAuthOperation,
  version: number,
): Promise<boolean> {
  if (
    operation.expiresAt > Date.now() ||
    operation.flowId === null ||
    operation.startingEpoch === null
  )
    return false;
  const flowResponse = await readDirectAuthFlow();
  const flow = flowResponse.data;
  if (version !== directAuthVersion() || !flow || flow.flowId !== operation.flowId) return false;
  const current = await readCurrentDirectOperation(operationTuple(operation));
  const canonical = current.data;
  if (
    version !== directAuthVersion() ||
    canonical.flow.flowId !== operation.flowId ||
    canonical.flow.proofState !== 'ACTIVE' ||
    canonical.operation !== null
  )
    return false;
  const unchangedAuthenticatedFlow =
    canonical.flow.authenticated && canonical.flow.flowEpoch === operation.startingEpoch;
  const advancedAnonymousFlow =
    !canonical.flow.authenticated &&
    BigInt(canonical.flow.flowEpoch) > BigInt(operation.startingEpoch);
  return (
    (unchangedAuthenticatedFlow || advancedAnonymousFlow) &&
    clearDirectAuthOperation('LOGOUT', operation)
  );
}

export async function performDirectLogout(): Promise<void> {
  const flow = directAuthFlow();
  const version = beginDirectAuthIntent();
  announceDirectAuthChange();
  const pending = readDirectAuthOperation('LOGOUT');
  if (!pending && (!flow || !flow.authenticated || flow.proofState !== 'ACTIVE'))
    throw new DirectAuthProtocolError();
  if (pending && (await inspectCommittedDirectLogout(pending, version))) return;
  if (pending && pending.expiresAt <= Date.now()) throw new DirectAuthProtocolError();
  const csrfResponse = await readDirectCsrf();
  const csrf = csrfResponse.data?.csrf_token;
  if (!csrf) throw new DirectAuthProtocolError();
  if (version !== directAuthVersion()) throw new DirectAuthProtocolError();
  const operation =
    pending ??
    createDirectAuthOperation('LOGOUT', flow!.flowId, flow!.flowEpoch, crypto.randomUUID());
  persistDirectAuthOperation('LOGOUT', operation);
  const response = await logoutDirectSession(operation, operationTuple(operation), csrf);
  const current = await readCurrentDirectOperation(operationTuple(operation));
  if (
    version !== directAuthVersion() ||
    !response.data ||
    !matchesCommittedLogout(current.data, operation, response.data.logoutReceipt)
  )
    throw new DirectAuthProtocolError();
  if (!clearDirectAuthOperation('LOGOUT', operation)) throw new DirectAuthProtocolError();
  announceDirectAuthChange();
}
