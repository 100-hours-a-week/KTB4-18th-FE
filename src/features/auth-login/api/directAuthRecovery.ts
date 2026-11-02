import { recoverDirectLogin } from './directAuthLoginApi';
import { isDirectSourceRecoveryVerified } from './authProtocolMode';
import {
  hasLiveRecoveryExpiry,
  hasLiveRefreshSource,
  matchesLiveLogin,
} from './directAuthCanonical';
import { readCurrentDirectOperation } from './directAuthFlowApi';
import { readCurrentRefreshRecovery, readRefreshRecoveryOperation } from './directAuthOperationApi';
import {
  clearDirectAuthOperation,
  createDirectAuthOperation,
  persistDirectAuthOperation,
  readDirectAuthOperation,
  sameDirectAuthOperation,
} from './directAuthOperationStore';
import { recoverDirectRefresh, readDirectCsrf } from './directAuthSessionApi';
import {
  beginDirectAuthIntent,
  directAuthVersion,
  installDirectSession,
} from './directAuthSessionState';
import { operationTuple } from './directAuthTuple';
import {
  DirectAuthProtocolError,
  DirectAuthApiError,
  type DirectAuthOperation,
} from './directAuthTypes';
import {
  inspectDirectLogin,
  releaseRejectedDirectLogin,
  completeDirectLogin,
} from './directAuthSessionFlow';
import type { LoginSuccessResponse } from './loginTypes';

export type SourceRecoveryPlan = {
  kind: 'login' | 'refresh';
  source: DirectAuthOperation;
  recovery: DirectAuthOperation | null;
  sourceCutoff: number;
  version: number;
};

export async function inspectDirectRecovery(
  source: DirectAuthOperation,
  version: number,
): Promise<{
  message: string;
  released: boolean;
}> {
  const result = await inspectDirectLogin(source);
  if (result.rejected && releaseRejectedDirectLogin(source, version))
    return { message: '이메일 또는 비밀번호를 확인하고 다시 로그인해 주세요.', released: true };
  const message = !result.terminal
    ? '로그인 요청을 처리하고 있어요. 상태를 다시 확인해 주세요.'
    : result.canonicalMatches
      ? '로그인 결과가 확인됐어요. 안전한 세션 복구를 아직 사용할 수 없어요.'
      : '로그인 결과를 안전하게 확인하지 못했어요. 다시 상태를 확인해 주세요.';
  return { message, released: false };
}

export async function inspectSourceRecovery(): Promise<SourceRecoveryPlan | null> {
  if (!isDirectSourceRecoveryVerified()) return null;
  const version = directAuthVersion();
  const login = readDirectAuthOperation('LOGIN');
  const source = login ?? readDirectAuthOperation('REFRESH');
  if (!source) return null;
  const current = await readCurrentDirectOperation(operationTuple(source));
  if (login) {
    const inspected = await inspectDirectLogin(source);
    const recovery = readDirectAuthOperation('LOGIN_RECOVERY');
    if (
      version !== directAuthVersion() ||
      !inspected.canonicalMatches ||
      !inspected.terminal ||
      !matchesLiveLogin(current.data, source, inspected.terminal) ||
      (recovery && !sameDirectAuthOperation(recovery, source))
    )
      return null;
    return {
      kind: 'login',
      source,
      recovery,
      sourceCutoff: Math.min(
        source.expiresAt,
        Number(current.data.operation?.effectiveExpiresAt),
        Date.parse(current.data.operation?.receiptExpiresAt ?? ''),
      ),
      version,
    };
  }
  if (!hasLiveRefreshSource(current.data, source)) return null;
  const sourceCutoff = Math.min(
    source.expiresAt,
    Number(current.data.operation!.effectiveExpiresAt),
    Date.parse(current.data.operation!.receiptExpiresAt!),
  );
  const recovery = readDirectAuthOperation('REFRESH_RECOVERY');
  let metadata;
  try {
    metadata = recovery
      ? await readRefreshRecoveryOperation({
          ...operationTuple(source),
          recoveryOperationId: recovery.operationId,
        })
      : await readCurrentRefreshRecovery(operationTuple(source));
  } catch (error) {
    if (
      !recovery ||
      !(error instanceof DirectAuthApiError) ||
      error.code !== 'AUTH_RECOVERY_LEASE_EXPIRED' ||
      !error.data ||
      error.data.recoveryOperationId !== recovery.operationId ||
      error.data.flowId !== source.flowId ||
      error.data.operationId !== source.operationId ||
      error.data.startingEpoch !== source.startingEpoch
    )
      throw error;
    metadata = { data: error.data };
  }
  if (version !== directAuthVersion()) return null;
  if (recovery) {
    if (
      recovery.operationId === source.operationId ||
      recovery.flowId !== source.flowId ||
      recovery.startingEpoch !== source.startingEpoch ||
      metadata.data.recoveryOperationId !== recovery.operationId ||
      !hasLiveRecoveryExpiry(recovery, metadata.data, sourceCutoff) ||
      (metadata.data.status !== 'SUCCEEDED' &&
        !(
          metadata.data.status === 'LEASE_EXPIRED' &&
          metadata.data.leaseExpiresAt &&
          Date.parse(metadata.data.leaseExpiresAt) <= Date.now()
        ))
    )
      return null;
  } else if (metadata.data.status !== 'NONE' || metadata.data.recoveryOperationId !== null)
    return null;
  return { kind: 'refresh', source, recovery, sourceCutoff, version };
}

export async function performSourceRecovery(
  plan: SourceRecoveryPlan,
  onIntent?: (version: number) => void,
): Promise<{
  message: string;
  success?: LoginSuccessResponse;
  version: number;
}> {
  if (!isDirectSourceRecoveryVerified() || plan.version !== directAuthVersion())
    throw new DirectAuthProtocolError();
  const fresh = await inspectSourceRecovery();
  if (
    !fresh ||
    fresh.kind !== plan.kind ||
    !sameDirectAuthOperation(fresh.source, plan.source) ||
    fresh.sourceCutoff !== plan.sourceCutoff ||
    Boolean(fresh.recovery) !== Boolean(plan.recovery) ||
    (fresh.recovery && plan.recovery && !sameDirectAuthOperation(fresh.recovery, plan.recovery))
  )
    throw new DirectAuthProtocolError();
  const version = beginDirectAuthIntent();
  onIntent?.(version);
  const recovery =
    fresh.kind === 'login'
      ? fresh.source
      : (fresh.recovery ??
        createDirectAuthOperation(
          'REFRESH_RECOVERY',
          fresh.source.flowId,
          fresh.source.startingEpoch,
          crypto.randomUUID(),
          Date.now(),
          Math.min(900000, fresh.sourceCutoff - Date.now()),
        ));
  if (fresh.kind === 'refresh' && recovery.operationId === fresh.source.operationId)
    throw new DirectAuthProtocolError();
  persistDirectAuthOperation(
    fresh.kind === 'login' ? 'LOGIN_RECOVERY' : 'REFRESH_RECOVERY',
    recovery,
  );
  const csrf = (await readDirectCsrf()).data?.csrf_token;
  if (!csrf || version !== directAuthVersion()) throw new DirectAuthProtocolError();
  if (fresh.kind === 'login') return recoverLoginSource(fresh.source, csrf, version);
  const tuple = { ...operationTuple(fresh.source), recoveryOperationId: recovery.operationId };
  const response = await recoverDirectRefresh(recovery, tuple, csrf);
  if (response.message === 'RECOVERY_IN_PROGRESS')
    return { message: '세션 복구를 처리하고 있어요. 상태를 확인해 주세요.', version };
  const token = response.data;
  if (
    !token ||
    !('access_token' in token) ||
    !Number.isSafeInteger(Date.now() + Number(token.expires_in) * 1000)
  )
    throw new DirectAuthProtocolError();
  const exact = await readRefreshRecoveryOperation(tuple);
  const current = await readCurrentDirectOperation(operationTuple(fresh.source));
  if (
    version !== directAuthVersion() ||
    !hasLiveRefreshSource(current.data, fresh.source) ||
    exact.data.status !== 'SUCCEEDED' ||
    !hasLiveRecoveryExpiry(recovery, exact.data, fresh.sourceCutoff) ||
    exact.data.resultEpoch !== token.resultEpoch ||
    exact.data.resultRevision !== token.resultRevision ||
    current.data.flow.flowEpoch !== token.resultEpoch ||
    current.data.flow.revision !== token.resultRevision ||
    current.data.flow.proofState !== 'ACTIVE'
  )
    throw new DirectAuthProtocolError();
  if (
    !clearDirectAuthOperation('REFRESH_RECOVERY', recovery) ||
    !clearDirectAuthOperation('REFRESH', fresh.source)
  )
    throw new DirectAuthProtocolError();
  if (!installDirectSession(version, token.access_token, token.expires_in, current.data.flow))
    throw new DirectAuthProtocolError();
  return {
    message: '로그인 상태를 복구했어요.',
    version,
    success: {
      message: 'login success',
      data: { access_token: token.access_token, expires_in: Number(token.expires_in) },
    },
  };
}

async function recoverLoginSource(
  source: DirectAuthOperation,
  csrf: string,
  version: number,
): Promise<{
  message: string;
  success?: LoginSuccessResponse;
  version: number;
}> {
  const response = await recoverDirectLogin(source, operationTuple(source), csrf);
  if (response.message !== 'login success')
    return { message: '로그인 복구를 처리하고 있어요. 상태를 확인해 주세요.', version };
  const token = response.data;
  if (!token || !('access_token' in token) || !(await completeDirectLogin(source, token, version)))
    throw new DirectAuthProtocolError();
  return {
    message: '로그인 상태를 복구했어요.',
    version,
    success: {
      message: 'login success',
      data: { access_token: token.access_token, expires_in: Number(token.expires_in) },
    },
  };
}
