import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./authSession', () => ({
  clearAccessToken: vi.fn(),
  getAccessToken: vi.fn(() => 'access-token'),
  getCsrfToken: vi.fn().mockResolvedValue('csrf-token'),
  runAuthTransition: vi.fn(async (action: () => Promise<void>) => action()),
}));
vi.mock('./authFlow', () => ({
  authFlowHeaders: vi.fn(
    async () =>
      new Headers({
        'X-Auth-Flow-Id': '123e4567-e89b-42d3-a456-426614174000',
        'X-Auth-Flow-Epoch': '8',
      }),
  ),
  reconcileAuthFlow: vi.fn().mockImplementation(async () => {
    const intent = JSON.parse(
      window.localStorage.getItem('meomuneum:pending-logout-operation') ?? 'null',
    );
    return {
      flowId: '123e4567-e89b-42d3-a456-426614174000',
      flowEpoch: 9,
      revision: 12,
      lifecycle: 'ANONYMOUS',
      authenticated: false,
      lastLogoutReceipt: {
        operationId: intent?.operationId,
        committed: true,
        flowEpoch: 9,
        revision: 12,
      },
    };
  }),
}));

import { clearAccessToken, getAccessToken, getCsrfToken, runAuthTransition } from './authSession';
import { reconcileAuthFlow } from './authFlow';
import { logout, LogoutFinalizationError, LogoutRequestError } from './logoutApi';

function currentAnonymousLogoutFlow() {
  const intent = JSON.parse(
    window.localStorage.getItem('meomuneum:pending-logout-operation') ?? 'null',
  );
  if (!intent) {
    return {
      flowId: '123e4567-e89b-42d3-a456-426614174000',
      flowEpoch: 8,
      revision: 11,
      lifecycle: 'AUTHENTICATED' as const,
      authenticated: true,
      lastLogoutReceipt: null,
    };
  }
  return {
    flowId: '123e4567-e89b-42d3-a456-426614174000',
    flowEpoch: intent.flowEpoch + 1,
    revision: 12,
    lifecycle: 'ANONYMOUS' as const,
    authenticated: false,
    lastLogoutReceipt: {
      operationId: intent.operationId,
      committed: true as const,
      flowEpoch: intent.flowEpoch + 1,
      revision: 12,
    },
  };
}

function committedLogoutResponse(): Response {
  return new Response(
    JSON.stringify({
      message: 'logout committed',
      data: {
        logoutReceipt: {
          operationId: JSON.parse(
            window.localStorage.getItem('meomuneum:pending-logout-operation') ?? 'null',
          )?.operationId,
          committed: true,
          flowEpoch: (JSON.parse(
            window.localStorage.getItem('meomuneum:pending-logout-operation') ?? 'null',
          )?.flowEpoch ?? 8) + 1,
          revision: 12,
        },
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Flow-Id': '123e4567-e89b-42d3-a456-426614174000',
        'X-Auth-Flow-Epoch': String((JSON.parse(
          window.localStorage.getItem('meomuneum:pending-logout-operation') ?? 'null',
        )?.flowEpoch ?? 8) + 1),
      },
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(getAccessToken).mockReturnValue('access-token');
  vi.mocked(getCsrfToken).mockReset().mockResolvedValue('csrf-token');
  vi.mocked(runAuthTransition).mockImplementation(async (action) => action());
  vi.mocked(reconcileAuthFlow).mockImplementation(async () => currentAnonymousLogoutFlow());
});

describe('logout', () => {
  it('announces server success before local auth finalization', async () => {
    const order: string[] = [];
    vi.mocked(runAuthTransition).mockImplementationOnce(async (action) => {
      await action();
      order.push('auth-finalization');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => committedLogoutResponse()),
    );

    await logout(() => order.push('server-success'));

    expect(order).toEqual(['server-success', 'auth-finalization']);
    expect(reconcileAuthFlow).toHaveBeenCalledTimes(2);
    expect(clearAccessToken).toHaveBeenCalledOnce();
  });

  it('clears the token before reconciling so the shared epoch becomes signed out', async () => {
    const order: string[] = [];
    vi.mocked(clearAccessToken).mockImplementation(() => order.push('clear-token'));
    let reads = 0;
    vi.mocked(reconcileAuthFlow).mockImplementation(async () => {
      order.push('reconcile-flow');
      reads += 1;
      if (reads === 1) {
        return {
          flowId: '123e4567-e89b-42d3-a456-426614174000',
          flowEpoch: 8,
          revision: 11,
          lifecycle: 'AUTHENTICATED',
          authenticated: true,
          lastLogoutReceipt: null,
        };
      }
      const intent = JSON.parse(
        window.localStorage.getItem('meomuneum:pending-logout-operation') ?? 'null',
      );
      return {
        flowId: '123e4567-e89b-42d3-a456-426614174000',
        flowEpoch: 9,
        revision: 12,
        lifecycle: 'ANONYMOUS',
        authenticated: false,
        lastLogoutReceipt: {
          operationId: intent?.operationId,
          committed: true,
          flowEpoch: 9,
          revision: 12,
        },
      };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => committedLogoutResponse()),
    );

    await logout();

    expect(order).toEqual(['reconcile-flow', 'reconcile-flow', 'clear-token']);
  });

  it('replaces a logout operation saved for an older flow epoch', async () => {
    const previousOperationId = '123e4567-e89b-42d3-a456-426614174099';
    let flowReads = 0;
    vi.mocked(reconcileAuthFlow).mockImplementation(async () => {
      flowReads += 1;
      return flowReads === 1
        ? {
            flowId: '123e4567-e89b-42d3-a456-426614174000',
            flowEpoch: 8,
            revision: 11,
            lifecycle: 'AUTHENTICATED',
            authenticated: true,
            lastLogoutReceipt: null,
          }
        : currentAnonymousLogoutFlow();
    });
    window.localStorage.setItem(
      'meomuneum:pending-logout-operation',
      JSON.stringify({
        flowId: '123e4567-e89b-42d3-a456-426614174000',
        flowEpoch: 7,
        operationId: previousOperationId,
      }),
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/api/v1/auth/logout');
      expect(init?.method).toBe('POST');
      return committedLogoutResponse();
    });
    vi.stubGlobal('fetch', fetcher);

    await logout();

    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get('X-Auth-Flow-Epoch')).toBe('8');
    expect(headers.get('Idempotency-Key')).not.toBe(previousOperationId);
    expect(clearAccessToken).toHaveBeenCalledOnce();
  });

  it('reconciles a stored committed logout after reload without sending it again', async () => {
    window.localStorage.setItem(
      'meomuneum:pending-logout-operation',
      JSON.stringify({
        flowId: '123e4567-e89b-42d3-a456-426614174000',
        flowEpoch: 8,
        operationId: '123e4567-e89b-42d3-a456-426614174098',
      }),
    );
    const onServerSuccess = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await logout(onServerSuccess);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onServerSuccess).toHaveBeenCalledOnce();
    expect(clearAccessToken).toHaveBeenCalledOnce();
  });

  it('recovers a committed logout after an ambiguous HTTP 503 response', async () => {
    const onServerSuccess = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));

    await logout(onServerSuccess);

    expect(onServerSuccess).toHaveBeenCalledOnce();
    expect(clearAccessToken).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem('meomuneum:pending-logout-operation')).toBeNull();
  });

  it('recovers a committed logout when a successful response body is truncated', async () => {
    const onServerSuccess = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status: 200 })));

    await logout(onServerSuccess);

    expect(reconcileAuthFlow).toHaveBeenCalledTimes(3);
    expect(onServerSuccess).toHaveBeenCalledOnce();
    expect(clearAccessToken).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem('meomuneum:pending-logout-operation')).toBeNull();
  });

  it('recovers a stored logout receipt before requesting CSRF', async () => {
    window.localStorage.setItem(
      'meomuneum:pending-logout-operation',
      JSON.stringify({
        flowId: '123e4567-e89b-42d3-a456-426614174000',
        flowEpoch: 8,
        operationId: '123e4567-e89b-42d3-a456-426614174097',
      }),
    );
    vi.mocked(getCsrfToken).mockRejectedValueOnce(new Error('CSRF endpoint unavailable'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(logout()).resolves.toBeUndefined();

    expect(getCsrfToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(clearAccessToken).toHaveBeenCalledOnce();
    vi.mocked(getCsrfToken).mockResolvedValue('csrf-token');
  });

  it('recovers a committed logout when the request response is lost', async () => {
    const onServerSuccess = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network lost'))));

    await logout(onServerSuccess);

    expect(onServerSuccess).toHaveBeenCalledOnce();
    expect(clearAccessToken).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem('meomuneum:pending-logout-operation')).toBeNull();
    expect(reconcileAuthFlow).toHaveBeenCalledTimes(3);
  });

  it('does not accept an old logout receipt after a newer login epoch', async () => {
    const onServerSuccess = vi.fn();
    window.localStorage.setItem(
      'meomuneum:pending-logout-operation',
      JSON.stringify({
        flowId: '123e4567-e89b-42d3-a456-426614174000',
        flowEpoch: 8,
        operationId: '123e4567-e89b-42d3-a456-426614174099',
      }),
    );
    vi.mocked(reconcileAuthFlow).mockImplementation(async () => {
      const intent = JSON.parse(
        window.localStorage.getItem('meomuneum:pending-logout-operation') ?? 'null',
      );
      return {
        flowId: '123e4567-e89b-42d3-a456-426614174000',
        flowEpoch: 10,
        revision: 14,
        lifecycle: 'AUTHENTICATED',
        authenticated: true,
        lastLogoutReceipt: {
          operationId: intent?.operationId,
          committed: true,
          flowEpoch: 9,
          revision: 12,
        },
      };
    });
    vi.stubGlobal('fetch', vi.fn(async () => committedLogoutResponse()));

    await expect(logout(onServerSuccess)).rejects.toBeInstanceOf(LogoutRequestError);
    expect(onServerSuccess).not.toHaveBeenCalled();
    expect(clearAccessToken).not.toHaveBeenCalled();
  });

  it('distinguishes post-2xx local finalization failure from server failure', async () => {
    const onServerSuccess = vi.fn();
    vi.mocked(runAuthTransition).mockImplementationOnce(async (action) => {
      await action();
      throw new Error('epoch storage unavailable');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => committedLogoutResponse()),
    );

    await expect(logout(onServerSuccess)).rejects.toBeInstanceOf(LogoutFinalizationError);
    expect(onServerSuccess).toHaveBeenCalledOnce();
  });

  it('does not start cleanup when the logout request fails', async () => {
    const onServerSuccess = vi.fn();
    vi.mocked(reconcileAuthFlow)
      .mockResolvedValueOnce({
        flowId: '123e4567-e89b-42d3-a456-426614174000',
        flowEpoch: 8,
        revision: 11,
        lifecycle: 'AUTHENTICATED',
        authenticated: true,
        lastLogoutReceipt: null,
      })
      .mockResolvedValue({
        flowId: '123e4567-e89b-42d3-a456-426614174000',
        flowEpoch: 9,
        revision: 12,
        lifecycle: 'ANONYMOUS',
        authenticated: false,
        lastLogoutReceipt: null,
      });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    await expect(logout(onServerSuccess)).rejects.toBeInstanceOf(LogoutRequestError);
    expect(onServerSuccess).not.toHaveBeenCalled();
    expect(clearAccessToken).not.toHaveBeenCalled();
  });
});
