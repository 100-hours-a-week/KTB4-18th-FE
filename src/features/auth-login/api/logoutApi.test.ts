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
import { logout } from './logoutApi';
import { committedLogoutResponse, resetLogoutApiTestState } from './logoutApiTestSupport';

beforeEach(resetLogoutApiTestState);

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
});
