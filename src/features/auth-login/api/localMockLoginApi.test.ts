import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCsrfToken, runAuthTransition, setAccessToken } from './authSession';
import { isLocalMockLoginEnabled, localMockLogin, LocalMockLoginRequestError } from './localMockLoginApi';

vi.mock('./authSession', () => ({
  getCsrfToken: vi.fn(),
  runAuthTransition: vi.fn((action: () => Promise<unknown>) => action()),
  setAccessToken: vi.fn(),
}));

const successResponse = {
  message: 'login success',
  data: { access_token: 'signed-test-token', expires_in: 3600 },
};

beforeEach(() => {
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_LOCAL_MOCK_LOGIN', 'true');
  vi.mocked(getCsrfToken).mockResolvedValue('test-csrf-token');
  vi.mocked(runAuthTransition).mockImplementation((action) => action());
  vi.mocked(setAccessToken).mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(successResponse)));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('local mock login API', () => {
  it('is enabled only in development with the explicit flag', () => {
    expect(isLocalMockLoginEnabled()).toBe(true);
    vi.stubEnv('VITE_LOCAL_MOCK_LOGIN', 'false');
    expect(isLocalMockLoginEnabled()).toBe(false);
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_LOCAL_MOCK_LOGIN', 'true');
    expect(isLocalMockLoginEnabled()).toBe(false);
  });

  it('gets CSRF, posts an empty credentialed request, and stores the standard access token', async () => {
    await expect(localMockLogin()).resolves.toEqual(successResponse);

    expect(runAuthTransition).toHaveBeenCalledOnce();
    expect(getCsrfToken).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/v1/auth/local-mock-login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-TOKEN': 'test-csrf-token' },
    });
    expect(setAccessToken).toHaveBeenCalledExactlyOnceWith('signed-test-token');
  });

  it('does not call the backend or store a token when disabled', async () => {
    vi.stubEnv('VITE_LOCAL_MOCK_LOGIN', 'false');

    await expect(localMockLogin()).rejects.toBeInstanceOf(LocalMockLoginRequestError);

    expect(fetch).not.toHaveBeenCalled();
    expect(setAccessToken).not.toHaveBeenCalled();
  });

  it('never stores a token for HTTP or malformed success responses', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ message: 'wrong envelope', data: null }));

    await expect(localMockLogin()).rejects.toMatchObject({ status: 503 });
    await expect(localMockLogin()).rejects.toMatchObject({ status: 500 });

    expect(setAccessToken).not.toHaveBeenCalled();
  });

  it('does not expose a raw network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('private network detail'));

    await expect(localMockLogin()).rejects.toMatchObject({ status: null });
    await expect(localMockLogin()).rejects.not.toThrow('private network detail');
    expect(setAccessToken).not.toHaveBeenCalled();
  });
});
