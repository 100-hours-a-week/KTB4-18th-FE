import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { login } from './loginApi';
import { logout } from './logoutApi';
import { AUTH_EXPIRED_EVENT, refreshAccessToken, resetAuthSessionForTests } from './authSession';

describe('refresh 쿠키와 계정 전환 요청 순서', () => {
  beforeEach(() => { resetAuthSessionForTests(); sessionStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); resetAuthSessionForTests(); sessionStorage.clear(); });

  it('늦은 refresh 응답을 받은 뒤 로그인 요청을 보내 새 계정 쿠키가 마지막이 된다', async () => {
    let completeRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => { completeRefresh = resolve; });
    const order: string[] = [];
    vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/token/csrf')) return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
      if (url.endsWith('/token/refresh')) { order.push('refresh'); return refreshResponse; }
      if (url.endsWith('/auth/login')) {
        order.push('login');
        return Promise.resolve(Response.json({ message: 'login success', data: {
          access_token: 'new-user-token', expires_in: 3600,
        } }));
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const pending = refreshAccessToken();
    await vi.waitFor(() => expect(order).toEqual(['refresh']));
    const signingIn = login({ email: 'test@example.com', password: 'password' });
    expect(order).toEqual(['refresh']);
    completeRefresh(Response.json({ data: { access_token: 'old-user-token' } }));
    await pending;
    const result = await signingIn;
    expect(result.data.access_token).toBe('new-user-token');
    expect(sessionStorage.getItem('access_token')).not.toBe('old-user-token');
    expect(order).toEqual(['refresh', 'login']);
  });

  it('refresh가 끝난 뒤 로그아웃으로 쿠키를 삭제한다', async () => {
    let completeRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => { completeRefresh = resolve; });
    const order: string[] = [];
    sessionStorage.setItem('access_token', 'existing-token');
    vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/token/csrf')) return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
      if (url.endsWith('/token/refresh')) { order.push('refresh'); return refreshResponse; }
      if (url.endsWith('/auth/logout')) { order.push('logout'); return Promise.resolve(new Response(null, { status: 204 })); }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const pending = refreshAccessToken();
    await vi.waitFor(() => expect(order).toEqual(['refresh']));
    const signingOut = logout();
    expect(order).toEqual(['refresh']);
    completeRefresh(Response.json({ data: { access_token: 'late-token' } }));
    await pending;
    await signingOut;
    expect(order).toEqual(['refresh', 'logout']);
    expect(sessionStorage.getItem('access_token')).toBeNull();
  });

  it('데이터 요청 중 refresh 401이면 토큰을 지우고 앱에 만료를 통지한다', async () => {
    const expired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    sessionStorage.setItem('access_token', 'expired-token');
    vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/token/csrf')) return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
      if (url.endsWith('/token/refresh')) {
        return Promise.resolve(Response.json({ message: 'unauthorized', data: null }, { status: 401 }));
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    await expect(refreshAccessToken()).rejects.toMatchObject({ status: 401 });
    expect(sessionStorage.getItem('access_token')).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  });
});
