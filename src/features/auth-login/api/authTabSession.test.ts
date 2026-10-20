import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AUTH_EXPIRED_EVENT,
  AUTH_SESSION_AVAILABLE_EVENT,
  getAccessToken,
  refreshAccessToken,
  resetAuthSessionForTests,
  runAuthTransition,
  setAccessToken,
} from './authSession';

const EPOCH_KEY = 'meomuneum:auth-epoch';
const OPERATION_KEY = 'meomuneum:pending-refresh-operation';
const epoch = (state: string) => JSON.stringify({ id: crypto.randomUUID(), state });
function peer(value: string) {
  localStorage.setItem(EPOCH_KEY, value);
  window.dispatchEvent(new StorageEvent('storage', { key: EPOCH_KEY, newValue: value }));
}
function installRefresh(result: () => Promise<Response>) {
  const fetcher = vi.fn((input: string | URL) =>
    String(input).endsWith('/token/csrf')
      ? Promise.resolve(Response.json({ data: { csrf_token: 'test-csrf' } }))
      : result(),
  );
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
beforeEach(() => {
  resetAuthSessionForTests();
  sessionStorage.clear();
});
afterEach(() => {
  resetAuthSessionForTests();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('빈 탭은 로그인 재호출 없이 CSRF와 공유 쿠키로 기존 세션을 복구한다', async () => {
  const fetcher = installRefresh(async () =>
    Response.json({ data: { access_token: 'same-session-token' } }),
  );
  expect(getAccessToken()).toBeNull();
  await expect(refreshAccessToken()).resolves.toBe('same-session-token');
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/v1/auth/token/csrf',
    '/api/v1/auth/token/refresh',
  ]);
  const init = vi.mocked(fetch).mock.calls[1][1];
  expect(init?.credentials).toBe('include');
  expect(new Headers(init?.headers).get('X-CSRF-TOKEN')).toBe('test-csrf');
  expect(new Headers(init?.headers).get('X-Refresh-Operation-Id')).toMatch(/^[0-9a-f-]{36}$/);
});

it('로그인 성공의 중복 storage 알림은 만료 없이 한 번만 복구를 요청한다', () => {
  setAccessToken('old-session');
  const expired = vi.fn();
  const available = vi.fn();
  window.addEventListener(AUTH_EXPIRED_EVENT, expired);
  window.addEventListener(AUTH_SESSION_AVAILABLE_EVENT, available);
  try {
    const next = epoch('available');
    peer(next);
    peer(next);
    expect(getAccessToken()).toBeNull();
    expect(expired).not.toHaveBeenCalled();
    expect(available).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
    window.removeEventListener(AUTH_SESSION_AVAILABLE_EVENT, available);
  }
});

it('정상 로그인은 토큰 없이 복구 가능 상태만 공유하고 오래된 refresh marker를 지운다', async () => {
  localStorage.setItem(
    OPERATION_KEY,
    JSON.stringify({ id: 'stale', createdAt: 0, retryCutoffAt: 1 }),
  );
  await runAuthTransition(async () => setAccessToken('new-private-access-token'));
  const marker = localStorage.getItem(EPOCH_KEY)!;
  expect(JSON.parse(marker)).toEqual({ id: expect.any(String), state: 'available' });
  expect(marker).not.toContain('new-private-access-token');
  expect(localStorage.getItem(OPERATION_KEY)).toBeNull();
  expect(getAccessToken()).toBe('new-private-access-token');
});

it('현재 epoch로 복구한 새 탭은 같은 epoch의 늦은 알림으로 토큰을 지우지 않는다', async () => {
  const current = epoch('available');
  localStorage.setItem(EPOCH_KEY, current);
  installRefresh(async () => Response.json({ data: { access_token: 'restored-current-token' } }));
  await refreshAccessToken();
  peer(current);
  expect(getAccessToken()).toBe('restored-current-token');
});

it('로그아웃 알림은 한 번 만료시키고 refresh 복구를 다시 시작하지 않는다', () => {
  setAccessToken('logged-in');
  const expired = vi.fn();
  const available = vi.fn();
  window.addEventListener(AUTH_EXPIRED_EVENT, expired);
  window.addEventListener(AUTH_SESSION_AVAILABLE_EVENT, available);
  try {
    const next = epoch('signed-out');
    peer(next);
    peer(next);
    expect(getAccessToken()).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
    expect(available).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
    window.removeEventListener(AUTH_SESSION_AVAILABLE_EVENT, available);
  }
});

it('로그아웃 전에 시작한 refresh 성공 응답은 이전 인증을 복원하지 않는다', async () => {
  let finish!: (response: Response) => void;
  installRefresh(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = refreshAccessToken();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  peer(epoch('signed-out'));
  finish(Response.json({ data: { access_token: 'late-token' } }));
  await expect(pending).rejects.toMatchObject({ status: null });
  expect(getAccessToken()).toBeNull();
});

it('이전 refresh 진행 중 새 로그인 알림이 오면 새 세션은 독립 복구한다', async () => {
  let finish!: (response: Response) => void;
  let calls = 0;
  installRefresh(() =>
    ++calls === 1
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(Response.json({ data: { access_token: 'current-session' } })),
  );
  const old = refreshAccessToken();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  peer(epoch('available'));
  await expect(refreshAccessToken()).resolves.toBe('current-session');
  finish(Response.json({ data: { access_token: 'previous-session' } }));
  await expect(old).rejects.toMatchObject({ status: null });
  expect(getAccessToken()).toBe('current-session');
});

it('저장소에서 놓친 로그인 변경을 발견해도 인증 만료로 처리하지 않는다', () => {
  setAccessToken('old-session');
  const expired = vi.fn();
  window.addEventListener(AUTH_EXPIRED_EVENT, expired);
  try {
    localStorage.setItem(EPOCH_KEY, epoch('available'));
    expect(getAccessToken()).toBeNull();
    expect(expired).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  }
});

it('구형 epoch는 기존 인증 제거 동작을 유지한다', () => {
  setAccessToken('old-session');
  const expired = vi.fn();
  window.addEventListener(AUTH_EXPIRED_EVENT, expired);
  try {
    peer('legacy-change');
    expect(getAccessToken()).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  }
});
