import { clearAccessToken, getAccessToken, getCsrfToken, runAuthTransition } from './authSession';
import { reconcileAuthFlow, type AuthFlow } from './authFlow';

const PENDING_LOGOUT_KEY = 'meomuneum:pending-logout-operation';

export class LogoutRequestError extends Error {
  readonly status: number | null;

  constructor(status: number | null) {
    super('Logout request failed');
    this.status = status;
  }
}

export class LogoutFinalizationError extends Error {
  constructor() {
    super('Logout succeeded, but local authentication state could not be finalized');
    this.name = 'LogoutFinalizationError';
  }
}

type PendingLogout = { flowId: string; flowEpoch: number; operationId: string };

export async function logout(onServerSuccess?: () => void): Promise<void> {
  let serverSucceeded = false;
  try {
    await runAuthTransition(() =>
      submitLogout(() => {
        serverSucceeded = true;
        onServerSuccess?.();
      }),
    );
  } catch (error) {
    if (serverSucceeded) throw new LogoutFinalizationError();
    throw error;
  }
}

function readPendingLogout(): PendingLogout | null {
  try {
    const stored = window.localStorage.getItem(PENDING_LOGOUT_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<PendingLogout>;
    if (
      typeof parsed.flowId === 'string' &&
      Number.isSafeInteger(parsed.flowEpoch) &&
      typeof parsed.operationId === 'string' &&
      parsed.operationId.length >= 16
    ) {
      return parsed as PendingLogout;
    }
    return null;
  } catch {
    throw new LogoutRequestError(null);
  }
}

function pendingLogout(flowId: string, flowEpoch: number): PendingLogout {
  try {
    const stored = window.localStorage.getItem(PENDING_LOGOUT_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<PendingLogout>;
      if (
        parsed.flowId === flowId &&
        parsed.flowEpoch === flowEpoch &&
        Number.isSafeInteger(parsed.flowEpoch) &&
        typeof parsed.operationId === 'string' &&
        parsed.operationId.length >= 16
      ) {
        return parsed as PendingLogout;
      }
    }
    const next = { flowId, flowEpoch, operationId: crypto.randomUUID() };
    window.localStorage.setItem(PENDING_LOGOUT_KEY, JSON.stringify(next));
    return next;
  } catch {
    throw new LogoutRequestError(null);
  }
}

async function submitLogout(onServerSuccess: () => void): Promise<void> {
  let intent: PendingLogout | null = null;
  let requestStarted = false;
  let response: Response;

  try {
    const currentFlow = await reconcileAuthFlow(undefined, true);
    const previousIntent = readPendingLogout();
    if (previousIntent && isCurrentLogoutReceipt(currentFlow, previousIntent)) {
      intent = previousIntent;
      await finalizeLogout(intent, onServerSuccess);
      return;
    }
    const csrf = await getCsrfToken();
    const flowId = currentFlow.flowId;
    const flowEpoch = currentFlow.flowEpoch;
    if (!flowId || !Number.isSafeInteger(flowEpoch)) throw new LogoutRequestError(null);
    const tuple = new Headers({
      'X-Auth-Flow-Id': flowId,
      'X-Auth-Flow-Epoch': String(flowEpoch),
    });
    intent = pendingLogout(flowId, flowEpoch);
    const accessToken = getAccessToken();
    const headers = new Headers(tuple);
    headers.set('X-Auth-Flow-Id', intent.flowId);
    headers.set('X-Auth-Flow-Epoch', String(intent.flowEpoch));
    headers.set('X-CSRF-TOKEN', csrf);
    headers.set('Idempotency-Key', intent.operationId);
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    requestStarted = true;
    response = await fetch(
      `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}/api/v1/auth/logout`,
      { method: 'POST', credentials: 'include', cache: 'no-store', headers },
    );
  } catch (error) {
    if (error instanceof LogoutRequestError) throw error;
    if (requestStarted && intent && (await committedLogoutStillCurrent(intent))) {
      await finalizeLogout(intent, onServerSuccess);
      return;
    }
    throw new LogoutRequestError(null);
  }

  if (!response.ok) {
    if (
      response.status >= 500 &&
      intent &&
      (await committedLogoutStillCurrent(intent))
    ) {
      await finalizeLogout(intent, onServerSuccess);
      return;
    }
    throw new LogoutRequestError(response.status);
  }
  const body = (await response.json().catch(() => null)) as {
    data?: { logoutReceipt?: Record<string, unknown> };
  } | null;
  const receipt = body?.data?.logoutReceipt;
  const receiptEpoch = Number(receipt?.flowEpoch);
  const receiptRevision = Number(receipt?.revision);
  if (!intent) throw new LogoutRequestError(response.status);
  const responseReceiptIsInvalid =
    response.status !== 200 ||
    response.headers.get('X-Auth-Flow-Id') !== intent.flowId ||
    Number(response.headers.get('X-Auth-Flow-Epoch')) !== receiptEpoch ||
    receipt?.operationId !== intent.operationId ||
    receipt?.committed !== true ||
    receiptEpoch !== intent.flowEpoch + 1 ||
    !Number.isSafeInteger(receiptRevision);
  if (responseReceiptIsInvalid) {
    if (await committedLogoutStillCurrent(intent)) {
      await finalizeLogout(intent, onServerSuccess);
      return;
    }
    throw new LogoutRequestError(response.status);
  }
  await finalizeLogout(intent, onServerSuccess);
}

async function committedLogoutStillCurrent(intent: PendingLogout): Promise<boolean> {
  try {
    const flow = await reconcileAuthFlow(undefined, true);
    return isCurrentLogoutReceipt(flow, intent);
  } catch {
    return false;
  }
}

function isCurrentLogoutReceipt(flow: AuthFlow, intent: PendingLogout): boolean {
  const receipt = flow.lastLogoutReceipt;
  return (
    flow.flowId === intent.flowId &&
    flow.flowEpoch === intent.flowEpoch + 1 &&
    flow.lifecycle === 'ANONYMOUS' &&
    !flow.authenticated &&
    receipt?.committed === true &&
    receipt.operationId === intent.operationId &&
    receipt.flowEpoch === flow.flowEpoch &&
    receipt.revision <= flow.revision
  );
}

async function finalizeLogout(intent: PendingLogout, onServerSuccess: () => void): Promise<void> {
  let flow: AuthFlow;
  try {
    flow = await reconcileAuthFlow(undefined, true);
  } catch {
    throw new LogoutFinalizationError();
  }
  if (!isCurrentLogoutReceipt(flow, intent)) throw new LogoutRequestError(409);

  onServerSuccess();
  clearAccessToken();
  try {
    window.localStorage.removeItem(PENDING_LOGOUT_KEY);
  } catch {
    throw new LogoutFinalizationError();
  }
}
