import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  forgetAuthFlowForTests,
  getAuthFlow,
  AuthFlowError,
  primeAuthFlowForTests,
  reconcileAuthFlow,
  updateAuthFlowFromResponse,
  type AuthFlow,
} from './authFlow';

const flowId = '123e4567-e89b-42d3-a456-426614174000';

function flow(lifecycle: AuthFlow['lifecycle'], revision: number, epoch = 1): AuthFlow {
  return {
    flowId,
    flowEpoch: epoch,
    revision,
    lifecycle,
    authenticated: lifecycle === 'AUTHENTICATED',
  };
}

function response(value: AuthFlow): Response {
  return Response.json({ data: value });
}

afterEach(() => {
  vi.useRealTimers();
  forgetAuthFlowForTests();
  vi.unstubAllGlobals();
});

describe('authoritative auth flow reconciliation', () => {
  it('merges server lifecycle fields when a GET returns the same tuple as a mutation response', async () => {
    primeAuthFlowForTests(flow('ANONYMOUS', 2));
    updateAuthFlowFromResponse(
      new Response(null, {
        headers: {
          'X-Auth-Flow-Id': flowId,
          'X-Auth-Flow-Epoch': '2',
          'X-Auth-Flow-Revision': '3',
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(flow('AUTHENTICATED', 3, 2))),
    );

    await expect(reconcileAuthFlow(undefined, true)).resolves.toMatchObject({
      lifecycle: 'AUTHENTICATED',
      authenticated: true,
      flowEpoch: 2,
      revision: 3,
    });
  });

  it('fails closed when a legacy flow snapshot contains a removed queue lifecycle', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(flow('ANONYMOUS', 2)));
    fetchMock.mockResolvedValueOnce(
      Response.json({
        message: 'auth flow',
        data: { ...flow('ANONYMOUS', 2), lifecycle: 'QUEUED' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(reconcileAuthFlow(undefined, true)).rejects.toBeInstanceOf(AuthFlowError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('times out a stalled central flow read and reports unavailable state', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const fetchMock = vi.fn((_: string, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = reconcileAuthFlow(undefined, true);
    const failure = expect(pending).rejects.toMatchObject({
      status: null,
      code: 'AUTH_STATE_UNAVAILABLE',
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await failure;

    expect(signal.aborted).toBe(true);
  });

  it('reconciles the server tuple on peer auth-epoch storage events', async () => {
    primeAuthFlowForTests(flow('ANONYMOUS', 1));
    const fetchMock = vi.fn(async () => response(flow('AUTHENTICATED', 2, 2)));
    vi.stubGlobal('fetch', fetchMock);

    window.dispatchEvent(new StorageEvent('storage', { key: 'meomuneum:auth-epoch' }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await vi.waitFor(async () =>
      expect(await getAuthFlow()).toMatchObject({ lifecycle: 'AUTHENTICATED', flowEpoch: 2 }),
    );
  });
});

it('keeps legacy flow network disabled in direct mode, including cached reads', async () => {
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_AUTH_DIRECT_V2_ENABLED', 'true');
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  try {
    await expect(reconcileAuthFlow()).rejects.toThrow();
    const auth = await import('./authFlow');
    await expect(auth.getAuthFlow()).rejects.toThrow();
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});
