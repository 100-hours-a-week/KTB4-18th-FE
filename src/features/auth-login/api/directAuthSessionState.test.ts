import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  beginDirectAuthIntent,
  clearDirectSession,
  directAuthenticatedFetch,
  getDirectAccessToken,
  installDirectSession,
} from './directAuthSessionState';
const flow = {
  flowId: 'f',
  flowEpoch: '1',
  revision: '2',
  authenticated: true,
  proofState: 'ACTIVE',
  lifecycle: 'AUTHENTICATED',
} as const;
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  clearDirectSession();
});
afterEach(() => vi.unstubAllGlobals());
it('keeps credentials in memory and fences late login results', () => {
  const version = beginDirectAuthIntent();
  beginDirectAuthIntent();
  expect(installDirectSession(version, 'old', '60', flow)).toBe(false);
  const next = beginDirectAuthIntent();
  expect(installDirectSession(next, 'current', '60', flow)).toBe(true);
  expect(getDirectAccessToken()).toBe('current');
  expect(sessionStorage.length).toBe(0);
  expect(localStorage.length).toBe(0);
});
it('never refreshes or retries protected requests on missing token or 401', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(directAuthenticatedFetch('/api/v1/users/me')).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  installDirectSession(beginDirectAuthIntent(), 'current', '60', flow);
  expect((await directAuthenticatedFetch('/api/v1/users/me')).status).toBe(401);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(getDirectAccessToken()).toBeNull();
});
it('rejects a protected response arriving after logout intent', async () => {
  let complete!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    ),
  );
  installDirectSession(beginDirectAuthIntent(), 'current', '60', flow);
  const response = directAuthenticatedFetch('/api/v1/users/me');
  beginDirectAuthIntent();
  complete(new Response(null, { status: 200 }));
  await expect(response).rejects.toThrow();
});

it('allows password/account transitions with the captured token after local clear', async () => {
  const { runDirectAuthTransition, directFetchWithinTransition } =
    await import('./directAuthSessionState');
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  installDirectSession(beginDirectAuthIntent(), 'current', '60', flow);
  await runDirectAuthTransition(async () => {
    clearDirectSession();
    expect(getDirectAccessToken()).toBeNull();
    expect(
      (await directFetchWithinTransition('/api/v1/users/me', { method: 'DELETE' }, 'current'))
        .status,
    ).toBe(204);
  });
  expect(fetcher).toHaveBeenCalledOnce();
  await expect(directFetchWithinTransition('/api/v1/users/me', {}, 'current')).rejects.toThrow();
});
it('fences an account transition when another intent starts', async () => {
  const { runDirectAuthTransition, directFetchWithinTransition } =
    await import('./directAuthSessionState');
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  installDirectSession(beginDirectAuthIntent(), 'current', '60', flow);
  await runDirectAuthTransition(async () => {
    beginDirectAuthIntent();
    await expect(directFetchWithinTransition('/api/v1/users/me', {}, 'current')).rejects.toThrow();
  });
  expect(fetcher).not.toHaveBeenCalled();
});
