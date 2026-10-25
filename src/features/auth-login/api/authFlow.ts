const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const FLOW_CHANNEL_NAME = 'meomuneum:auth-flow-hint';
const FLOW_REQUEST_TIMEOUT_MS = 15_000;

export type AuthFlowLifecycle = 'ANONYMOUS' | 'QUEUED' | 'AUTHENTICATED';
export type AuthFlow = {
  flowId: string;
  flowEpoch: number;
  revision: number;
  lifecycle: AuthFlowLifecycle;
  authenticated: boolean;
  refreshGeneration?: number;
  lastLogoutReceipt?: {
    operationId: string;
    committed: true;
    flowEpoch: number;
    revision: number;
  } | null;
  lastRefreshReceipt?: {
    operationId: string;
    committed: true;
    flowEpoch: number;
    revision: number;
    resultGeneration: number;
  } | null;
  lastQueueCancelReceipt?: {
    operationId: string;
    committed: true;
    flowEpoch: number;
    revision: number;
  } | null;
};

export class AuthFlowError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(status: number | null, code: string | null = null) {
    super('Authentication flow state is unavailable');
    this.name = 'AuthFlowError';
    this.status = status;
    this.code = code;
  }
}

let currentFlow: AuthFlow | null = null;
let pendingRead: Promise<AuthFlow> | null = null;
let flowChannel: BroadcastChannel | null = null;

if (typeof window !== 'undefined') {
  const reconcileFresh = () => void reconcileAuthFlow(undefined, true).catch(() => undefined);
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === 'meomuneum:auth-epoch') reconcileFresh();
  });
  window.addEventListener('focus', reconcileFresh);
  window.addEventListener('pageshow', reconcileFresh);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconcileFresh();
  });
}

function channel(): BroadcastChannel | null {
  if (flowChannel) return flowChannel;
  try {
    if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') return null;
    flowChannel = new window.BroadcastChannel(FLOW_CHANNEL_NAME);
    flowChannel.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type === 'auth-flow-changed') void reconcileAuthFlow().catch(() => undefined);
    });
  } catch {
    flowChannel = null;
  }
  return flowChannel;
}

function publishFlowHint(): void {
  try {
    channel()?.postMessage({ type: 'auth-flow-changed' });
  } catch {
    // The database remains authoritative; a later request or page focus reconciles the tuple.
  }
}

function parseFlow(value: unknown): AuthFlow {
  if (!value || typeof value !== 'object')
    throw new AuthFlowError(502, 'AUTH_FLOW_RESPONSE_INVALID');
  const data = value as Partial<AuthFlow>;
  if (
    typeof data.flowId !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(data.flowId) ||
    !Number.isSafeInteger(data.flowEpoch) ||
    !Number.isSafeInteger(data.revision) ||
    !['ANONYMOUS', 'QUEUED', 'AUTHENTICATED'].includes(data.lifecycle ?? '') ||
    typeof data.authenticated !== 'boolean'
  ) {
    throw new AuthFlowError(502, 'AUTH_FLOW_RESPONSE_INVALID');
  }
  return data as AuthFlow;
}

function applyFlow(flow: AuthFlow): AuthFlow {
  const previous = currentFlow;
  if (
    previous &&
    previous.flowId === flow.flowId &&
    (flow.flowEpoch < previous.flowEpoch ||
      (flow.flowEpoch === previous.flowEpoch && flow.revision < previous.revision))
  ) {
    return previous;
  }
  const sameVersion =
    previous?.flowId === flow.flowId &&
    previous.flowEpoch === flow.flowEpoch &&
    previous.revision === flow.revision;
  currentFlow = flow;
  if (previous && !sameVersion) publishFlowHint();
  return currentFlow;
}

export async function reconcileAuthFlow(
  signal?: AbortSignal,
  forceFresh = false,
): Promise<AuthFlow> {
  if (pendingRead && !forceFresh) return pendingRead;
  const request = (async () => {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abortFromParent, { once: true });
    const timeout = window.setTimeout(() => controller.abort(), FLOW_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}/api/v1/auth/flow`, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as {
        data?: unknown;
        code?: string;
        message?: string;
      } | null;
      if (controller.signal.aborted) throw new AuthFlowError(null, 'AUTH_STATE_UNAVAILABLE');
      if (!response.ok) throw new AuthFlowError(response.status, body?.code ?? body?.message ?? null);
      const flow = applyFlow(parseFlow(body?.data));
      return flow;
    } catch (error) {
      if (error instanceof AuthFlowError) throw error;
      throw new AuthFlowError(null, 'AUTH_STATE_UNAVAILABLE');
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', abortFromParent);
    }
  })();
  pendingRead = request;
  try {
    return await request;
  } finally {
    if (pendingRead === request) pendingRead = null;
  }
}

export async function getAuthFlow(): Promise<AuthFlow> {
  return pendingRead ?? currentFlow ?? reconcileAuthFlow();
}

export async function authFlowHeaders(forceFresh = false): Promise<Headers> {
  const flow = forceFresh ? await reconcileAuthFlow(undefined, true) : await getAuthFlow();
  return new Headers({
    'X-Auth-Flow-Id': flow.flowId,
    'X-Auth-Flow-Epoch': String(flow.flowEpoch),
  });
}

export function updateAuthFlowFromResponse(response: Response): AuthFlow | null {
  const flowId = response.headers.get('X-Auth-Flow-Id');
  const flowEpoch = Number(response.headers.get('X-Auth-Flow-Epoch'));
  const revision = Number(response.headers.get('X-Auth-Flow-Revision'));
  if (!flowId || !Number.isSafeInteger(flowEpoch) || !Number.isSafeInteger(revision)) return null;
  if (!currentFlow || currentFlow.flowId !== flowId) return null;
  return applyFlow({ ...currentFlow, flowEpoch, revision });
}

export async function assertFlowResponseCurrent(
  requestHeaders: Headers,
  response: Response,
): Promise<AuthFlow> {
  const current = await reconcileAuthFlow(undefined, true);
  const requestFlowId = requestHeaders.get('X-Auth-Flow-Id');
  const requestEpoch = Number(requestHeaders.get('X-Auth-Flow-Epoch'));
  const responseFlowId = response.headers.get('X-Auth-Flow-Id');
  const responseEpochHeader = response.headers.get('X-Auth-Flow-Epoch');
  const responseEpoch = responseEpochHeader === null ? null : Number(responseEpochHeader);
  const responseRevisionHeader = response.headers.get('X-Auth-Flow-Revision');
  const responseRevision = responseRevisionHeader === null ? null : Number(responseRevisionHeader);
  if (
    requestFlowId !== current.flowId ||
    requestEpoch !== current.flowEpoch ||
    (responseFlowId && responseFlowId !== current.flowId) ||
    (responseEpoch !== null &&
      Number.isSafeInteger(responseEpoch) &&
      responseEpoch !== current.flowEpoch) ||
    (responseRevision !== null &&
      Number.isSafeInteger(responseRevision) &&
      responseRevision < current.revision)
  ) {
    throw new AuthFlowError(409, 'AUTH_FLOW_EPOCH_STALE');
  }
  return current;
}

export function forgetAuthFlowForTests(): void {
  currentFlow = null;
  pendingRead = null;
}

export function primeAuthFlowForTests(flow: AuthFlow): void {
  currentFlow = flow;
  pendingRead = null;
}
