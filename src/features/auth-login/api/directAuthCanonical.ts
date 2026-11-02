import { isSafeExpiry } from './directAuthExpiry';
import type {
  CurrentOperationLookup,
  DirectAuthOperation,
  LogoutReceipt,
  TerminalOperationData,
} from './directAuthTypes';

export function matchesLiveLogin(
  current: CurrentOperationLookup,
  source: DirectAuthOperation,
  terminal: TerminalOperationData,
  now = Date.now(),
): boolean {
  const { flow, operation } = current;
  return Boolean(
    operation &&
    source.flowId === flow.flowId &&
    operation.flowId === source.flowId &&
    operation.operationId === source.operationId &&
    operation.kind === 'LOGIN' &&
    operation.startingEpoch === source.startingEpoch &&
    operation.status === 'SUCCEEDED' &&
    terminal.flowId === source.flowId &&
    terminal.operationId === source.operationId &&
    terminal.startingEpoch === source.startingEpoch &&
    terminal.status === 'SUCCEEDED' &&
    operation.resultEpoch === terminal.resultEpoch &&
    operation.resultRevision === terminal.resultRevision &&
    flow.flowEpoch === terminal.resultEpoch &&
    flow.revision === terminal.resultRevision &&
    flow.authenticated === true &&
    flow.proofState === 'ACTIVE' &&
    flow.lifecycle === 'AUTHENTICATED' &&
    isSafeExpiry(operation.clientExpiresAt) &&
    isSafeExpiry(operation.effectiveExpiresAt) &&
    operation.clientExpiresAt === String(source.expiresAt) &&
    Number(operation.effectiveExpiresAt) <= source.expiresAt &&
    Number(operation.effectiveExpiresAt) > now &&
    source.expiresAt > now &&
    operation.receiptExpiresAt &&
    Date.parse(operation.receiptExpiresAt) > now,
  );
}

export function matchesCommittedLogout(
  current: CurrentOperationLookup,
  source: DirectAuthOperation,
  receipt: LogoutReceipt,
  now = Date.now(),
): boolean {
  const { flow, operation } = current;
  return Boolean(
    operation &&
    receipt.committed === true &&
    receipt.operationId === source.operationId &&
    operation.operationId === source.operationId &&
    operation.flowId === source.flowId &&
    flow.flowId === source.flowId &&
    operation.startingEpoch === source.startingEpoch &&
    operation.kind === 'LOGOUT' &&
    operation.status === 'SUCCEEDED' &&
    source.expiresAt > now &&
    operation.resultEpoch === receipt.flowEpoch &&
    operation.resultRevision === receipt.revision &&
    flow.flowEpoch === receipt.flowEpoch &&
    flow.revision === receipt.revision &&
    BigInt(receipt.flowEpoch) > BigInt(source.startingEpoch ?? '0') &&
    !flow.authenticated &&
    flow.lifecycle === 'ANONYMOUS' &&
    flow.proofState === 'ACTIVE' &&
    operation.receiptExpiresAt &&
    Date.parse(operation.receiptExpiresAt) > now,
  );
}

export function matchesRejectedLogin(
  current: CurrentOperationLookup,
  source: DirectAuthOperation,
  terminal: TerminalOperationData,
): boolean {
  const { flow, operation } = current;
  return Boolean(
    operation &&
    ['INVALID_CREDENTIALS', 'NOT_ADMITTED'].includes(terminal.status) &&
    operation.status === terminal.status &&
    operation.kind === 'LOGIN' &&
    source.flowId === flow.flowId &&
    operation.flowId === source.flowId &&
    terminal.flowId === source.flowId &&
    operation.operationId === source.operationId &&
    terminal.operationId === source.operationId &&
    operation.startingEpoch === source.startingEpoch &&
    terminal.startingEpoch === source.startingEpoch &&
    operation.resultEpoch === terminal.resultEpoch &&
    operation.resultRevision === terminal.resultRevision &&
    flow.flowEpoch === terminal.resultEpoch &&
    flow.revision === terminal.resultRevision &&
    flow.proofState === 'ACTIVE' &&
    flow.lifecycle === 'ANONYMOUS' &&
    !flow.authenticated &&
    operation.clientExpiresAt === String(source.expiresAt) &&
    isSafeExpiry(operation.effectiveExpiresAt) &&
    Number(operation.effectiveExpiresAt) > Date.now() &&
    Number(operation.effectiveExpiresAt) <= source.expiresAt &&
    source.expiresAt > Date.now() &&
    operation.receiptExpiresAt &&
    Date.parse(operation.receiptExpiresAt) > Date.now(),
  );
}

export function matchesLiveRefresh(
  current: CurrentOperationLookup,
  source: DirectAuthOperation,
): boolean {
  const { flow, operation } = current;
  return Boolean(
    operation &&
    source.flowId === flow.flowId &&
    operation.flowId === source.flowId &&
    operation.operationId === source.operationId &&
    operation.kind === 'REFRESH' &&
    operation.startingEpoch === source.startingEpoch &&
    operation.status === 'SUCCEEDED' &&
    operation.resultEpoch !== null &&
    operation.resultRevision !== null &&
    operation.resultEpoch === flow.flowEpoch &&
    operation.resultRevision === flow.revision &&
    flow.authenticated &&
    flow.lifecycle === 'AUTHENTICATED' &&
    flow.proofState === 'ACTIVE' &&
    isSafeExpiry(operation.clientExpiresAt) &&
    isSafeExpiry(operation.effectiveExpiresAt) &&
    operation.clientExpiresAt === String(source.expiresAt) &&
    Number(operation.effectiveExpiresAt) <= source.expiresAt &&
    Number(operation.effectiveExpiresAt) > Date.now() &&
    source.expiresAt > Date.now() &&
    operation.receiptExpiresAt &&
    Date.parse(operation.receiptExpiresAt) > Date.now(),
  );
}

export function hasLiveRefreshSource(
  current: CurrentOperationLookup,
  source: DirectAuthOperation,
): boolean {
  const operation = current.operation;
  return Boolean(
    operation &&
    operation.kind === 'REFRESH' &&
    operation.status === 'SUCCEEDED' &&
    operation.flowId === source.flowId &&
    current.flow.flowId === source.flowId &&
    operation.operationId === source.operationId &&
    operation.startingEpoch === source.startingEpoch &&
    operation.resultEpoch === current.flow.flowEpoch &&
    operation.resultRevision !== null &&
    BigInt(operation.resultRevision) <= BigInt(current.flow.revision) &&
    current.flow.authenticated &&
    current.flow.lifecycle === 'AUTHENTICATED' &&
    operation.clientExpiresAt === String(source.expiresAt) &&
    isSafeExpiry(operation.effectiveExpiresAt) &&
    Number(operation.effectiveExpiresAt) <= source.expiresAt &&
    Number(operation.effectiveExpiresAt) > Date.now() &&
    source.expiresAt > Date.now() &&
    operation.receiptExpiresAt &&
    Date.parse(operation.receiptExpiresAt) > Date.now(),
  );
}

export function hasLiveRecoveryExpiry(
  recovery: DirectAuthOperation,
  data: { clientExpiresAt: string | null; effectiveExpiresAt: string | null },
  sourceCutoff: number,
): boolean {
  return (
    data.clientExpiresAt === String(recovery.expiresAt) &&
    isSafeExpiry(data.effectiveExpiresAt) &&
    Number(data.effectiveExpiresAt) > Date.now() &&
    Number(data.effectiveExpiresAt) <= recovery.expiresAt &&
    Number(data.effectiveExpiresAt) <= sourceCutoff &&
    recovery.expiresAt > Date.now()
  );
}
