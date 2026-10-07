import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authenticatedFetch,
  getAccessToken,
  resetAuthSessionForTests,
  setAccessToken,
} from '../../auth-login/api/authSession';
import {
  getAllRecommendationHistory,
  getMyProfileImage,
  uploadMyProfileImage,
  updateMyProfile,
  withdrawMyAccount,
} from './mypageApi';

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
  it.each(['image/jpeg', 'image/png', 'image/webp'])(
    'uploads %s multipart image with Bearer auth and browser Content-Type',
    async (type) => {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          message: 'saved',
          data: { profile_image_url: '/api/v1/users/me/profile-image/new.png' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const file = new File(['image contents'], 'avatar', { type });
      await expect(uploadMyProfileImage(file)).resolves.toEqual({
        profile_image_url: '/api/v1/users/me/profile-image/new.png',
      });
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/v1/users/me/profile-image');
      expect(options.method).toBe('PUT');
      expect(options.credentials).toBe('include');
      expect((options.body as FormData).get('image')).toBe(file);
      expect(((options.body as FormData).get('image') as File).type).toBe(type);
      expect(((options.body as FormData).get('image') as File).size).toBe(14);
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer access-token');
      expect(new Headers(options.headers).has('Content-Type')).toBe(false);
    },
  );

  it('loads protected images as blobs through authenticatedFetch without putting tokens in URLs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('png', { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    const image = await getMyProfileImage('/api/v1/users/me/profile-image/new.png');
    expect(image.type).toBe('image/png');
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/users/me/profile-image/new.png');
    expect(options.cache).toBe('no-store');
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer access-token');
    await expect(getMyProfileImage('https://example.com/image.png')).rejects.toMatchObject({
      status: null,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('maps upload and protected image server errors into existing request errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ message: 'image too large', data: null }, { status: 413 }),
        ),
    );
    await expect(uploadMyProfileImage(new File(['png'], 'avatar.png'))).rejects.toMatchObject({
      status: 413,
      messageFromServer: '10MB 이하의 이미지만 등록할 수 있어요.',
    });
    await expect(getMyProfileImage('/api/v1/users/me/profile-image/new.png')).rejects.toMatchObject(
      { status: 413 },
    );
  });
  it.each([null, 'image is too large', 'storage failure'])(
    'maps any upload 413 message (%s) to the size guidance',
    async (message) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(Response.json({ message, data: null }, { status: 413 })),
      );
      await expect(uploadMyProfileImage(new File(['webp'], 'avatar.webp'))).rejects.toMatchObject({
        status: 413,
        messageFromServer: '10MB 이하의 이미지만 등록할 수 있어요.',
      });
    },
  );

  it.each(['invalid image', 'JPG, PNG, WEBP 형식의 이미지만 등록할 수 있어요.'])(
    'maps known upload format rejection %s',
    async (message) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementation(async () => Response.json({ message, data: null }, { status: 400 })),
      );
      await expect(uploadMyProfileImage(new File(['webp'], 'avatar.webp'))).rejects.toMatchObject({
        status: 400,
        messageFromServer: 'JPG, PNG, WEBP 형식의 이미지만 등록할 수 있어요.',
      });
      await expect(updateMyProfile({ nickname: '새 닉네임' })).rejects.toMatchObject({
        status: 400,
        messageFromServer: message,
      });
    },
  );

  it.each([
    [400, 'storage failure'],
    [500, 'invalid image'],
    [403, 'forbidden'],
  ])('preserves upload error %i %s', async (status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ message, data: null }, { status })),
    );
    await expect(uploadMyProfileImage(new File(['webp'], 'avatar.webp'))).rejects.toMatchObject({
      status,
      messageFromServer: message,
    });
  });

  it('preserves network and expired authentication upload errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failure')));
    await expect(uploadMyProfileImage(new File(['webp'], 'avatar.webp'))).rejects.toMatchObject({
      status: null,
      messageFromServer: null,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(uploadMyProfileImage(new File(['webp'], 'avatar.webp'))).rejects.toMatchObject({
      status: 401,
      messageFromServer: null,
    });
  });
});
