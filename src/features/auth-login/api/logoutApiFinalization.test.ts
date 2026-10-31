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

import { clearAccessToken, runAuthTransition } from './authSession';
import { reconcileAuthFlow } from './authFlow';
import { logout, LogoutFinalizationError, LogoutRequestError } from './logoutApi';
import { committedLogoutResponse, resetLogoutApiTestState } from './logoutApiTestSupport';

beforeEach(resetLogoutApiTestState);

describe('logout', () => {
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
