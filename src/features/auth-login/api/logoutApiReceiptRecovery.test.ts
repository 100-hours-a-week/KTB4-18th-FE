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

import { clearAccessToken, getCsrfToken } from './authSession';
import { reconcileAuthFlow } from './authFlow';
import { logout, LogoutRequestError } from './logoutApi';
import { committedLogoutResponse, resetLogoutApiTestState } from './logoutApiTestSupport';

beforeEach(resetLogoutApiTestState);

describe('logout', () => {
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    );

    await logout(onServerSuccess);

    expect(onServerSuccess).toHaveBeenCalledOnce();
    expect(clearAccessToken).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem('meomuneum:pending-logout-operation')).toBeNull();
  });

  it('recovers a committed logout when a successful response body is truncated', async () => {
    const onServerSuccess = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{', { status: 200 })),
    );

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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('network lost'))),
    );

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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => committedLogoutResponse()),
    );

    await expect(logout(onServerSuccess)).rejects.toBeInstanceOf(LogoutRequestError);
    expect(onServerSuccess).not.toHaveBeenCalled();
    expect(clearAccessToken).not.toHaveBeenCalled();
  });
});
