import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./authSession', () => ({
  clearAccessToken: vi.fn(),
  getAccessToken: vi.fn(() => 'access-token'),
  getCsrfToken: vi.fn().mockResolvedValue('csrf-token'),
  runAuthTransition: vi.fn(async (action: () => Promise<void>) => action()),
}));

import { clearAccessToken, getAccessToken, getCsrfToken, runAuthTransition } from './authSession';
import { logout, LogoutFinalizationError, LogoutRequestError } from './logoutApi';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAccessToken).mockReturnValue('access-token');
  vi.mocked(getCsrfToken).mockResolvedValue('csrf-token');
  vi.mocked(runAuthTransition).mockImplementation(async (action) => action());
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
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    await logout(() => order.push('server-success'));

    expect(order).toEqual(['server-success', 'auth-finalization']);
    expect(clearAccessToken).toHaveBeenCalledOnce();
  });

  it('distinguishes post-2xx local finalization failure from server failure', async () => {
    const onServerSuccess = vi.fn();
    vi.mocked(runAuthTransition).mockImplementationOnce(async (action) => {
      await action();
      throw new Error('epoch storage unavailable');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    await expect(logout(onServerSuccess)).rejects.toBeInstanceOf(LogoutFinalizationError);
    expect(onServerSuccess).toHaveBeenCalledOnce();
  });

  it('does not start cleanup when the logout request fails', async () => {
    const onServerSuccess = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    await expect(logout(onServerSuccess)).rejects.toBeInstanceOf(LogoutRequestError);
    expect(onServerSuccess).not.toHaveBeenCalled();
    expect(clearAccessToken).not.toHaveBeenCalled();
  });
});
