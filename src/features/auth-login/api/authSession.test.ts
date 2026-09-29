import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { login } from './loginApi';
import { logout } from './logoutApi';
import {
  AUTH_EXPIRED_EVENT,
  authenticatedFetch,
  clearAccessToken,
  getAccessToken,
  getAccessTokenExpiresAt,
  refreshAccessToken,
  resetAuthSessionForTests,
  runAuthTransition,
  setAccessToken,
  shouldRefreshAccessToken,
} from './authSession';

function accessTokenWithExpiration(expiresAt: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(expiresAt / 1000) }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${payload}.signature`;
}

describe('refresh 쿠키와 계정 전환 요청 순서', () => {
  beforeEach(() => {
    resetAuthSessionForTests();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetAuthSessionForTests();
    sessionStorage.clear();
  });

  it('새로고침 후 sessionStorage access token을 복구한다', () => {
    sessionStorage.setItem('access_token', 'persisted-token');

    resetAuthSessionForTests();
    expect(getAccessToken()).toBe('persisted-token');
  });

  it('access JWT 만료 10분 전부터 refresh가 필요하다고 판단한다', () => {
    const now = Date.now();
    setAccessToken(accessTokenWithExpiration(now + 9 * 60 * 1000));
    expect(getAccessTokenExpiresAt()).toBeGreaterThan(now);
    expect(shouldRefreshAccessToken(now)).toBe(true);

    setAccessToken(accessTokenWithExpiration(now + 11 * 60 * 1000));
    expect(shouldRefreshAccessToken(now)).toBe(false);
  });

  it('로그인은 CSRF 세션 없이 Origin 정책과 access token 응답을 사용한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        message: 'login success',
        data: { access_token: 'login-access-token', expires_in: 3600 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await login({ email: 'test@example.com', password: 'password' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(options.headers).has('X-CSRF-TOKEN')).toBe(false);
    expect(getAccessToken()).toBe('login-access-token');
  });

  it('로그인 시작 뒤 도착한 이전 refresh 응답은 폐기하고 새 계정 쿠키를 보존한다', async () => {
    let completeRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      completeRefresh = resolve;
    });
    const order: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
        if (url.endsWith('/token/refresh')) {
          order.push('refresh');
          return refreshResponse;
        }
        if (url.endsWith('/auth/login')) {
          order.push('login');
          return Promise.resolve(
            Response.json({
              message: 'login success',
              data: {
                access_token: 'new-user-token',
                expires_in: 3600,
              },
            }),
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const pending = refreshAccessToken();
    await vi.waitFor(() => expect(order).toEqual(['refresh']));
    const signingIn = login({ email: 'test@example.com', password: 'password' });
    expect(order).toEqual(['refresh']);
    completeRefresh(Response.json({ data: { access_token: 'old-user-token' } }));
    await expect(pending).rejects.toMatchObject({ status: null });
    const result = await signingIn;
    expect(result.data.access_token).toBe('new-user-token');
    expect(getAccessToken()).toBe('new-user-token');
    expect(order).toEqual(['refresh', 'login']);
  });

  it('refresh가 끝난 뒤 로그아웃으로 쿠키를 삭제한다', async () => {
    let completeRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      completeRefresh = resolve;
    });
    const order: string[] = [];
    const logoutHeaders: Headers[] = [];
    setAccessToken('existing-token');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
        if (url.endsWith('/token/refresh')) {
          order.push('refresh');
          return refreshResponse;
        }
        if (url.endsWith('/auth/logout')) {
          order.push('logout');
          logoutHeaders.push(new Headers(init?.headers));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const pending = refreshAccessToken();
    await vi.waitFor(() => expect(order).toEqual(['refresh']));
    const signingOut = logout();
    expect(order).toEqual(['refresh']);
    completeRefresh(Response.json({ data: { access_token: 'late-token' } }));
    await expect(pending).rejects.toMatchObject({ status: null });
    await signingOut;
    expect(order).toEqual(['refresh', 'logout']);
    expect(logoutHeaders[0]?.get('Authorization')).toBe('Bearer existing-token');
    expect(getAccessToken()).toBeNull();
  });

  it('데이터 요청 중 refresh 401이면 토큰을 지우고 앱에 만료를 통지한다', async () => {
    const expired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    setAccessToken('expired-token');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
        if (url.endsWith('/token/refresh')) {
          return Promise.resolve(
            Response.json({ message: 'unauthorized', data: null }, { status: 401 }),
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    await expect(refreshAccessToken()).rejects.toMatchObject({ status: 401 });
    expect(getAccessToken()).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  });

  it('저장된 access token을 refresh 없이 먼저 사용한다', async () => {
    setAccessToken('saved-token');
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/protected');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/protected');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe(
      'Bearer saved-token',
    );
  });

  it('새로고침 뒤 세션 저장소에서 읽은 토큰을 즉시 Bearer로 사용한다', async () => {
    sessionStorage.setItem('access_token', 'reloaded-token');
    resetAuthSessionForTests();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/protected');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe(
      'Bearer reloaded-token',
    );
  });

  it('access token이 없으면 refresh를 완료한 뒤 새 토큰으로 보호 요청을 보낸다', async () => {
    const order: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/token/csrf')) {
          order.push('csrf');
          return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
        }
        if (url.endsWith('/token/refresh')) {
          order.push('refresh');
          expect(new Headers(init?.headers).has('Authorization')).toBe(false);
          return Promise.resolve(Response.json({ data: { access_token: 'fresh-token' } }));
        }
        order.push('protected');
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fresh-token');
        return Promise.resolve(Response.json({ data: 'ok' }));
      }),
    );

    await authenticatedFetch('/api/protected');

    expect(order).toEqual(['csrf', 'refresh', 'protected']);
    expect(getAccessToken()).toBe('fresh-token');
    expect(sessionStorage.getItem('access_token')).toBe('fresh-token');
  });

  it('access token 요청이 401이면 refresh 후 한 번만 재시도한다', async () => {
    setAccessToken('expired-token');
    const protectedHeaders: Array<string | null> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
        if (url.endsWith('/token/refresh'))
          return Promise.resolve(Response.json({ data: { access_token: 'rotated-token' } }));
        protectedHeaders.push(new Headers(init?.headers).get('Authorization'));
        return Promise.resolve(
          protectedHeaders.length === 1
            ? Response.json({ message: 'unauthorized' }, { status: 401 })
            : Response.json({ data: 'ok' }),
        );
      }),
    );

    const response = await authenticatedFetch('/api/protected');

    expect(response.status).toBe(200);
    expect(protectedHeaders).toEqual(['Bearer expired-token', 'Bearer rotated-token']);
    expect(getAccessToken()).toBe('rotated-token');
  });

  it('refresh 이후 도착한 이전 401을 최신 access token으로 한 번 재시도한다', async () => {
    setAccessToken('old-token');
    let completeSlowRequest!: (response: Response) => void;
    const slowResponse = new Promise<Response>((resolve) => {
      completeSlowRequest = resolve;
    });
    const slowHeaders: Array<string | null> = [];
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/token/csrf')) {
        return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
      }
      if (url.endsWith('/token/refresh')) {
        return Promise.resolve(Response.json({ data: { access_token: 'new-token' } }));
      }
      const authorization = new Headers(init?.headers).get('Authorization');
      if (url.endsWith('/slow')) {
        slowHeaders.push(authorization);
        return slowHeaders.length === 1
          ? slowResponse
          : Promise.resolve(Response.json({ data: 'retried' }));
      }
      if (url.endsWith('/fast') && authorization === 'Bearer old-token') {
        return Promise.resolve(Response.json({ message: 'unauthorized' }, { status: 401 }));
      }
      return Promise.resolve(Response.json({ data: 'ok' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const slowRequest = authenticatedFetch('/slow');
    await vi.waitFor(() => expect(slowHeaders).toEqual(['Bearer old-token']));
    await expect(authenticatedFetch('/fast')).resolves.toMatchObject({ status: 200 });
    completeSlowRequest(Response.json({ message: 'unauthorized' }, { status: 401 }));

    await expect(slowRequest).resolves.toMatchObject({ status: 200 });
    expect(slowHeaders).toEqual(['Bearer old-token', 'Bearer new-token']);
  });

  it('익명 fallback 진행 중 다른 탭의 계정 epoch가 바뀌면 이전 응답을 폐기한다', async () => {
    sessionStorage.clear();
    let finishAnonymousRequest!: (response: Response) => void;
    const anonymousResponse = new Promise<Response>((resolve) => {
      finishAnonymousRequest = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        if (String(input).endsWith('/api/v1/auth/token/csrf')) {
          return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
        }
        if (String(input).endsWith('/api/v1/auth/token/refresh')) {
          return Promise.resolve(
            Response.json({ message: 'unauthorized', data: null }, { status: 401 }),
          );
        }
        return anonymousResponse;
      }),
    );

    const pending = authenticatedFetch(
      '/api/public-or-guest',
      {},
      {
        allowAnonymousOnRefreshUnauthorized: true,
      },
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    window.localStorage.setItem('meomuneum:auth-epoch', 'peer-account-changed');
    window.dispatchEvent(new StorageEvent('storage', { key: 'meomuneum:auth-epoch' }));
    finishAnonymousRequest(Response.json({ data: 'stale account' }));

    await expect(pending).rejects.toMatchObject({ status: null });
  });

  it('다른 탭에서 계정 epoch가 바뀐 뒤 도착한 401을 재생하지 않는다', async () => {
    setAccessToken('previous-account-token');
    let completeProtected!: (response: Response) => void;
    const protectedResponse = new Promise<Response>((resolve) => {
      completeProtected = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(protectedResponse);
    vi.stubGlobal('fetch', fetchMock);

    const pending = authenticatedFetch('/api/protected');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    window.localStorage.setItem('meomuneum:auth-epoch', 'peer-account-changed');
    window.dispatchEvent(new StorageEvent('storage', { key: 'meomuneum:auth-epoch' }));
    completeProtected(Response.json({ message: 'unauthorized' }, { status: 401 }));

    await expect(pending).rejects.toMatchObject({ status: null });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getAccessToken()).toBeNull();
  });

  it('시작 시 access token이 없고 refresh 401이면 추천을 익명으로 한 번 보낸다', async () => {
    const headers: Array<string | null> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
        if (url.endsWith('/token/refresh'))
          return Promise.resolve(
            Response.json({ message: 'unauthorized', data: null }, { status: 401 }),
          );
        headers.push(new Headers(init?.headers).get('Authorization'));
        return Promise.resolve(Response.json({ data: 'anonymous-result' }));
      }),
    );

    const response = await authenticatedFetch(
      '/api/recommendations',
      { method: 'POST', body: '{"prompt":"music"}' },
      { allowAnonymousOnRefreshUnauthorized: true },
    );

    expect(response.status).toBe(200);
    expect(headers).toEqual([null]);
    expect(getAccessToken()).toBeNull();
  });

  it('기존 access token이 거부되고 refresh도 401이면 익명 추천으로 재전송하지 않는다', async () => {
    setAccessToken('expired-token');
    const headers: Array<string | null> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
        if (url.endsWith('/token/refresh'))
          return Promise.resolve(
            Response.json({ message: 'unauthorized', data: null }, { status: 401 }),
          );
        headers.push(new Headers(init?.headers).get('Authorization'));
        return Promise.resolve(Response.json({ message: 'unauthorized' }, { status: 401 }));
      }),
    );

    await expect(
      authenticatedFetch(
        '/api/recommendations',
        { method: 'POST', body: '{"prompt":"music"}' },
        { allowAnonymousOnRefreshUnauthorized: true },
      ),
    ).rejects.toMatchObject({ status: 401 });

    expect(headers).toEqual(['Bearer expired-token']);
    expect(getAccessToken()).toBeNull();
  });

  it('로그인 전환 중 완료된 이전 보호 응답을 폐기한다', async () => {
    setAccessToken('old-user-token');
    let completeProtected!: (response: Response) => void;
    const protectedResponse = new Promise<Response>((resolve) => {
      completeProtected = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(protectedResponse);
    vi.stubGlobal('fetch', fetchMock);

    const pending = authenticatedFetch('/api/protected');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const transition = runAuthTransition(async () => undefined);
    completeProtected(Response.json({ data: 'old-user-data' }));

    await expect(pending).rejects.toMatchObject({ status: null });
    await transition;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refresh 중 로그인 전환이 시작되면 이전 요청을 익명으로 재생하지 않는다', async () => {
    let completeRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      completeRefresh = resolve;
    });
    const protectedHeaders: Array<string | null> = [];
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/token/csrf'))
        return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
      if (url.endsWith('/token/refresh')) return refreshResponse;
      protectedHeaders.push(new Headers(init?.headers).get('Authorization'));
      return Promise.resolve(Response.json({ data: 'anonymous-result' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = authenticatedFetch(
      '/api/recommendations',
      { method: 'POST', body: '{"prompt":"music"}' },
      { allowAnonymousOnRefreshUnauthorized: true },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const transition = runAuthTransition(async () => undefined);
    completeRefresh(Response.json({ message: 'unauthorized', data: null }, { status: 401 }));

    await expect(pending).rejects.toMatchObject({ status: 401 });
    await transition;
    expect(protectedHeaders).toEqual([]);
  });

  it('인증 전환을 기다린 이전 요청은 새 계정의 refresh를 시작하지 않는다', async () => {
    let finishTransition!: () => void;
    let transitionStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      transitionStarted = resolve;
    });
    const transition = runAuthTransition(
      () =>
        new Promise<void>((resolve) => {
          finishTransition = resolve;
          transitionStarted();
        }),
    );
    await started;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const pendingRefresh = refreshAccessToken(0, 0);

    finishTransition();
    await transition;

    await expect(pendingRefresh).rejects.toMatchObject({ status: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('FormData 요청에서 브라우저 multipart boundary를 보존한다', async () => {
    setAccessToken('saved-token');
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const body = new FormData();
    body.append('file', new Blob(['audio']), 'voice.webm');

    await authenticatedFetch('/api/transcribe', { method: 'POST', body });

    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('Content-Type')).toBe(false);
  });

  it('sessionStorage 일시 오류 후 다시 접근되면 인증 복구를 재시도한다', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new DOMException('temporarily blocked', 'SecurityError');
    });
    expect(getAccessToken()).toBeNull();

    let refreshCount = 0;
    const fetchMock = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/token/csrf')) {
        return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
      }
      if (url.endsWith('/api/v1/auth/token/refresh')) {
        refreshCount += 1;
        return Promise.resolve(Response.json({ data: { access_token: 'recovered-token' } }));
      }
      return Promise.resolve(Response.json({ data: 'ok' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await authenticatedFetch('/api/protected');

    expect(response.ok).toBe(true);
    expect(refreshCount).toBe(1);
    expect(getAccessToken()).toBe('recovered-token');
  });

  it('refresh POST 403은 새 CSRF 값으로 한 번만 다시 시도한다', async () => {
    const order: string[] = [];
    const csrfValues = ['csrf-one', 'csrf-two'];
    let csrfCount = 0;
    let refreshCount = 0;
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/token/csrf')) {
        order.push('csrf');
        return Promise.resolve(Response.json({ data: { csrf_token: csrfValues[csrfCount++] } }));
      }
      if (url.endsWith('/api/v1/auth/token/refresh')) {
        order.push(`refresh:${new Headers(init?.headers).get('X-CSRF-TOKEN')}`);
        refreshCount += 1;
        return Promise.resolve(
          refreshCount === 1
            ? Response.json({ message: 'csrf rejected', data: null }, { status: 403 })
            : Response.json({ data: { access_token: 'refreshed-token' } }),
        );
      }
      order.push('protected');
      return Promise.resolve(Response.json({ data: 'ok' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/protected');

    expect(order).toEqual(['csrf', 'refresh:csrf-one', 'csrf', 'refresh:csrf-two', 'protected']);
    expect(refreshCount).toBe(2);
  });

  it('CSRF GET 403은 refresh나 보호 API를 호출하지 않는다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ message: 'forbidden', data: null }, { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(authenticatedFetch('/api/protected')).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ['5xx', () => Promise.resolve(Response.json({ message: 'unavailable' }, { status: 503 })), 503],
    ['network error', () => Promise.reject(new TypeError('offline')), null],
  ])(
    'refresh %s는 보호 API를 진행하지 않고 재시도 가능한 오류로 남긴다',
    async (_label, refreshResult, status) => {
      const fetchMock = vi.fn((input: string | URL) => {
        if (String(input).endsWith('/api/v1/auth/token/csrf')) {
          return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
        }
        return refreshResult();
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(authenticatedFetch('/api/protected')).rejects.toMatchObject({ status });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(getAccessToken()).toBeNull();
    },
  );

  it('동시에 도착한 두 access 401은 refresh 한 번만 공유한다', async () => {
    setAccessToken('expired-token');
    const release401: Array<(response: Response) => void> = [];
    let refreshCount = 0;
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/token/csrf')) {
        return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
      }
      if (url.endsWith('/api/v1/auth/token/refresh')) {
        refreshCount += 1;
        return Promise.resolve(Response.json({ data: { access_token: 'fresh-token' } }));
      }
      if (new Headers(init?.headers).get('Authorization') === 'Bearer expired-token') {
        return new Promise<Response>((resolve) => release401.push(resolve));
      }
      return Promise.resolve(Response.json({ data: 'ok' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = authenticatedFetch('/api/protected');
    const second = authenticatedFetch('/api/protected');
    await vi.waitFor(() => expect(release401).toHaveLength(2));
    release401.forEach((resolve) =>
      resolve(Response.json({ message: 'unauthorized', data: null }, { status: 401 })),
    );

    const responses = await Promise.all([first, second]);

    expect(responses.every((response) => response.ok)).toBe(true);
    expect(refreshCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('cross-tab Web Locks queue competing transitions and BroadcastChannel invalidates peers', async () => {
    const originalBroadcastChannel = Object.getOwnPropertyDescriptor(window, 'BroadcastChannel');
    const originalAddEventListener = window.addEventListener;
    const storageListeners: EventListenerOrEventListenerObject[] = [];
    const order: string[] = [];
    const channelMessages: unknown[] = [];
    let activeLocks = 0;
    let maximumActiveLocks = 0;
    let releaseFirstAction!: () => void;
    const firstActionGate = new Promise<void>((resolve) => {
      releaseFirstAction = resolve;
    });
    let lockTail = Promise.resolve();
    const lockRequest = vi.fn(
      (_name: string, _options: LockOptions, callback: () => Promise<unknown>) => {
        const previous = lockTail;
        let unlock!: () => void;
        lockTail = new Promise<void>((resolve) => {
          unlock = resolve;
        });
        return previous.then(async () => {
          activeLocks += 1;
          maximumActiveLocks = Math.max(maximumActiveLocks, activeLocks);
          try {
            return await callback();
          } finally {
            activeLocks -= 1;
            unlock();
          }
        });
      },
    );
    class FakeBroadcastChannel extends EventTarget {
      static instances: FakeBroadcastChannel[] = [];
      readonly name: string;
      closed = false;

      constructor(name: string) {
        super();
        this.name = name;
        FakeBroadcastChannel.instances.push(this);
      }

      postMessage(data: unknown) {
        for (const peer of FakeBroadcastChannel.instances) {
          if (peer !== this && !peer.closed && peer.name === this.name) {
            queueMicrotask(() => peer.dispatchEvent(new MessageEvent('message', { data })));
          }
        }
      }

      close() {
        this.closed = true;
      }
    }
    Object.defineProperty(window, 'BroadcastChannel', {
      configurable: true,
      value: FakeBroadcastChannel,
    });
    window.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'storage') storageListeners.push(listener);
      originalAddEventListener.call(window, type, listener, options);
    }) as typeof window.addEventListener;
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    vi.stubGlobal('navigator', { locks: { request: lockRequest } });

    try {
      vi.resetModules();
      const firstTab = await import('./authSession');
      vi.resetModules();
      const secondTab = await import('./authSession');
      const externalTab = new FakeBroadcastChannel('meomuneum:auth-state');
      externalTab.addEventListener('message', (event) =>
        channelMessages.push((event as MessageEvent).data),
      );
      const first = firstTab.runAuthTransition(async () => {
        order.push('first:start');
        await firstActionGate;
        order.push('first:end');
      });
      await vi.waitFor(() => expect(lockRequest).toHaveBeenCalledTimes(1));
      const second = secondTab.runAuthTransition(async () => {
        order.push('second:start');
        order.push('second:end');
      });
      await vi.waitFor(() => expect(lockRequest).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(order).toEqual(['first:start']);
      expect(maximumActiveLocks).toBe(1);
      expect(lockRequest.mock.calls.map(([name, options]) => [name, options])).toEqual([
        ['meomuneum:auth-transition', { mode: 'exclusive' }],
        ['meomuneum:auth-transition', { mode: 'exclusive' }],
      ]);

      releaseFirstAction();
      await Promise.all([first, second]);
      expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
      await vi.waitFor(() => expect(channelMessages).toHaveLength(2));
      expect(channelMessages).toEqual([{ type: 'auth-changed' }, { type: 'auth-changed' }]);

      firstTab.setAccessToken('peer-session-token');
      expect(firstTab.getAccessToken()).toBe('peer-session-token');
      externalTab.postMessage({ type: 'auth-changed' });
      await vi.waitFor(() => expect(firstTab.getAccessToken()).toBeNull());
      expect(secondTab.getAccessToken()).toBeNull();
    } finally {
      releaseFirstAction();
      for (const listener of storageListeners) window.removeEventListener('storage', listener);
      for (const channel of FakeBroadcastChannel.instances) channel.close();
      window.addEventListener = originalAddEventListener;
      if (originalBroadcastChannel) {
        Object.defineProperty(window, 'BroadcastChannel', originalBroadcastChannel);
      } else {
        Reflect.deleteProperty(window, 'BroadcastChannel');
      }
      sessionStorage.clear();
      window.localStorage.removeItem('meomuneum:auth-epoch');
    }
  });

  it('sessionStorage 읽기에 실패하면 보호 API를 토큰 없이 보내지 않는다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(getAccessToken()).toBeNull();
    await expect(authenticatedFetch('/api/protected')).rejects.toMatchObject({ status: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sessionStorage 저장 실패 뒤 refresh 결과로 보호 API를 보내지 않는다', async () => {
    const order: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        order.push(
          url.endsWith('/token/csrf')
            ? 'csrf'
            : url.endsWith('/token/refresh')
              ? 'refresh'
              : 'protected',
        );
        if (url.endsWith('/token/csrf'))
          return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
        if (url.endsWith('/token/refresh'))
          return Promise.resolve(Response.json({ data: { access_token: 'fresh-token' } }));
        return Promise.resolve(Response.json({ data: 'unexpected' }));
      }),
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'QuotaExceededError');
    });

    await expect(authenticatedFetch('/api/protected')).rejects.toMatchObject({ status: null });
    expect(order).toEqual(['csrf', 'refresh']);
  });

  it('sessionStorage 삭제 실패 뒤 오래된 token을 인증에 재사용하지 않는다', async () => {
    sessionStorage.setItem('access_token', 'old-token');
    resetAuthSessionForTests();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    clearAccessToken();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(getAccessToken()).toBeNull();
    await expect(authenticatedFetch('/api/protected')).rejects.toMatchObject({ status: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
