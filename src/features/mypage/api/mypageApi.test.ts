import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authenticatedFetch,
  getAccessToken,
  resetAuthSessionForTests,
  setAccessToken,
} from '../../auth-login/api/authSession';
import { getAllRecommendationHistory, updateMyProfile, withdrawMyAccount } from './mypageApi';

describe('mypageApi', () => {
  beforeEach(() => {
    resetAuthSessionForTests();
    setAccessToken('access-token');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetAuthSessionForTests();
    sessionStorage.clear();
  });

  it('collects nested recommendation items from every cursor page', async () => {
    const fetchMock = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/recommendations?size=100')) {
        return Promise.resolve(
          Response.json({
            message: 'recommendations',
            data: {
              groups: [
                {
                  recommendations: [
                    {
                      items: [
                        { rank_no: 1, music_id: 12, title: '첫 곡', artist_name: '가수' },
                        { rank_no: 2, music_id: 24, title: '둘째 곡', artist_name: '가수' },
                      ],
                    },
                  ],
                },
              ],
              next_cursor: 'cursor-2',
              has_next: true,
            },
          }),
        );
      }
      if (url.endsWith('/recommendations?size=100&cursor=cursor-2')) {
        return Promise.resolve(
          Response.json({
            message: 'recommendations',
            data: {
              groups: [
                {
                  recommendations: [
                    {
                      items: [
                        { rank_no: 1, music_id: 24, title: '둘째 곡', artist_name: '가수' },
                        { rank_no: 2, music_id: 36, title: '셋째 곡', artist_name: '가수' },
                      ],
                    },
                  ],
                },
              ],
              next_cursor: null,
              has_next: false,
            },
          }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const history = await getAllRecommendationHistory();

    expect(history.map((item) => item.music_id)).toEqual([12, 24, 24, 36]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends protected profile mutations with Bearer access and no CSRF token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ data: { user_id: 1, updated_at: '2026-09-26' } }));
    vi.stubGlobal('fetch', fetchMock);

    await updateMyProfile({ nickname: '새 닉네임' });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/users/me');
    const headers = new Headers(options.headers);
    expect(headers.get('Authorization')).toBe('Bearer access-token');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.has('X-CSRF-TOKEN')).toBe(false);
    expect(JSON.parse(options.body as string)).toEqual({ nickname: '새 닉네임' });
  });

  it('clears access immediately and serializes withdrawal as an auth transition', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await withdrawMyAccount('temporary-password');

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/users/me');
    expect(options.method).toBe('DELETE');
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer access-token');
    expect(new Headers(options.headers).has('X-CSRF-TOKEN')).toBe(false);
    expect(getAccessToken()).toBeNull();
  });

  it('successful withdrawal invalidates a protected response already in flight', async () => {
    let finishProtected!: (response: Response) => void;
    const protectedResponse = new Promise<Response>((resolve) => {
      finishProtected = resolve;
    });
    const fetchMock = vi.fn((input: string | URL) => {
      if (String(input) === '/api/protected') return protectedResponse;
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const pendingProtectedRequest = authenticatedFetch('/api/protected');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await withdrawMyAccount('temporary-password');
    finishProtected(Response.json({ data: 'old account data' }));

    await expect(pendingProtectedRequest).rejects.toMatchObject({ status: null });
    expect(getAccessToken()).toBeNull();
  });

  it('restores the access token when withdrawal fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ message: 'invalid password', data: null }, { status: 400 }),
        ),
    );

    await expect(withdrawMyAccount('wrong-password')).rejects.toMatchObject({ status: 400 });
    expect(getAccessToken()).toBe('access-token');
  });
});
