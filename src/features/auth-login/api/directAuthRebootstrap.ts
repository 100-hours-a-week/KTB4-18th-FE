import { isDirectRebootstrapVerified } from './authProtocolMode';
import { readCurrentDirectOperation, rebootstrapDirectAuth } from './directAuthFlowApi';
import {
  clearDirectAuthOperation,
  createDirectAuthOperation,
  persistDirectAuthOperation,
  readDirectAuthOperation,
  sameDirectAuthOperation,
} from './directAuthOperationStore';
import { directCsrf, unresolvedDirectOperation } from './directAuthSessionFlow';
import { beginDirectAuthIntent, directAuthVersion } from './directAuthSessionState';
import { operationTuple } from './directAuthTuple';
import {
  DirectAuthProtocolError,
  type CurrentOperationFlow,
  type DirectAuthOperation,
} from './directAuthTypes';

export type RebootstrapPlan = {
  flow: CurrentOperationFlow;
  operation: DirectAuthOperation | null;
  version: number;
};

export async function inspectRebootstrap(): Promise<RebootstrapPlan | null> {
  if (!isDirectRebootstrapVerified()) return null;
  const version = directAuthVersion();
  const current = await readCurrentDirectOperation();
  const operation = readDirectAuthOperation('REBOOTSTRAP');
  if (
    version !== directAuthVersion() ||
    (operation &&
      (operation.flowId !== current.data.flow.flowId || operation.expiresAt <= Date.now()))
  )
    return null;
  if (!operation && current.data.flow.proofState !== 'REBOOTSTRAP_REQUIRED') return null;
  return { flow: current.data.flow, operation, version };
}

export async function performRebootstrap(
  plan: RebootstrapPlan,
  onIntent?: (version: number) => void,
): Promise<{
  message: string;
  released: boolean;
  version: number;
}> {
  if (!isDirectRebootstrapVerified() || plan.version !== directAuthVersion())
    throw new DirectAuthProtocolError();
  const fresh = await inspectRebootstrap();
  if (
    !fresh ||
    fresh.flow.flowId !== plan.flow.flowId ||
    Boolean(fresh.operation) !== Boolean(plan.operation) ||
    (fresh.operation &&
      plan.operation &&
      !sameDirectAuthOperation(fresh.operation, plan.operation)) ||
    (!plan.operation &&
      (fresh.flow.flowEpoch !== plan.flow.flowEpoch || fresh.flow.revision !== plan.flow.revision))
  )
    throw new DirectAuthProtocolError();
  const version = beginDirectAuthIntent();
  onIntent?.(version);
  const operation =
    fresh.operation ??
    createDirectAuthOperation(
      'REBOOTSTRAP',
      fresh.flow.flowId,
      fresh.flow.flowEpoch,
      crypto.randomUUID(),
    );
  persistDirectAuthOperation('REBOOTSTRAP', operation);
  const csrf = await directCsrf();
  if (version !== directAuthVersion()) throw new DirectAuthProtocolError();
  const response = await rebootstrapDirectAuth(operation, operationTuple(operation), csrf);
  const current = await readCurrentDirectOperation(operationTuple(operation));
  if (
    version !== directAuthVersion() ||
    response.data.flow.proofState !== 'ACTIVE' ||
    response.data.flow.flowId !== operation.flowId ||
    response.data.operationId !== operation.operationId ||
    response.data.startingEpoch !== operation.startingEpoch ||
    response.data.flow.flowEpoch !== response.data.resultEpoch ||
    response.data.flow.revision !== response.data.resultRevision ||
    current.data.flow.proofState !== 'ACTIVE' ||
    current.data.flow.flowId !== operation.flowId ||
    current.data.flow.flowEpoch !== response.data.resultEpoch ||
    current.data.flow.revision !== response.data.resultRevision ||
    current.data.flow.authenticated !== response.data.flow.authenticated ||
    current.data.flow.lifecycle !== response.data.flow.lifecycle ||
    BigInt(response.data.resultEpoch) < BigInt(operation.startingEpoch!)
  )
    throw new DirectAuthProtocolError();
  if (!clearDirectAuthOperation('REBOOTSTRAP', operation)) throw new DirectAuthProtocolError();
  const login = readDirectAuthOperation('LOGIN');
  const terminal = current.data.operation;
  if (
    login &&
    !current.data.flow.authenticated &&
    current.data.flow.lifecycle === 'ANONYMOUS' &&
    login.flowId === current.data.flow.flowId &&
    BigInt(current.data.flow.flowEpoch) > BigInt(login.startingEpoch!) &&
    (terminal?.operationId !== login.operationId ||
      (terminal.kind === 'LOGIN' &&
        terminal.status === 'SUPERSEDED' &&
        terminal.startingEpoch === login.startingEpoch &&
        terminal.resultEpoch === current.data.flow.flowEpoch &&
        terminal.resultRevision === current.data.flow.revision))
  ) {
    if (!clearDirectAuthOperation('LOGIN', login)) throw new DirectAuthProtocolError();
    const recovery = readDirectAuthOperation('LOGIN_RECOVERY');
    if (
      recovery &&
      sameDirectAuthOperation(login, recovery) &&
      !clearDirectAuthOperation('LOGIN_RECOVERY', recovery)
    )
      throw new DirectAuthProtocolError();
  }
  const released = !current.data.flow.authenticated && !unresolvedDirectOperation();
  return {
    message: released
      ? '로그인 준비가 끝났어요. 다시 로그인해 주세요.'
      : '인증 상태를 다시 확인했어요. 기존 로그인 결과를 확인해 주세요.',
    released,
    version,
  };
}
