import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MusicApiError, registerSelectedMusic } from './musicRecordsApi';
import { resetAuthSessionForTests, setAccessToken } from '../../auth-login/api/authSession';

const registered = {
  music_id: 42,
  provider: 'ITUNES',
  external_music_id: '123',
  title: '서버 제목',
  artist_name: '서버 가수',
  album_cover_url: 'https://example.com/100x100bb.jpg',
  preview_url: 'https://example.com/preview.m4a',
  youtube_video_id: 'server-video',
  is_queueable: true,
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  resetAuthSessionForTests();
  setAccessToken('test-token');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  resetAuthSessionForTests();
});

function stubRegistration(data: unknown, status = 201) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/auth/token/csrf'))
      return Response.json({ message: 'csrf token issued', data: { csrf_token: 'csrf-fixture' } });
    return Response.json({ message: 'song registered', data }, { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('명시적으로 선택한 곡 등록 계약', () => {
  it.each([200, 201])(
    'HTTP %s의 전체 Music과 내부 ID를 사용하고 인증/CSRF 계약을 지킨다',
    async (status) => {
      const fetchMock = stubRegistration({ music: registered, created: status === 201 }, status);
      const controller = new AbortController();
      const result = await registerSelectedMusic('123', controller.signal);
      expect(result).toEqual({
        ...registered,
        album_cover_url: 'https://example.com/680x680bb.jpg',
      });
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        expect.stringContaining('/api/v1/auth/token/csrf'),
        expect.stringContaining('/api/v1/songs'),
      ]);
      const request = vi.mocked(fetch).mock.calls[1][1]!;
      expect(request).toMatchObject({
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
      });
      expect(JSON.parse(String(request.body))).toEqual({ externalTrackId: '123' });
      const headers = new Headers(request.headers);
      expect(headers.get('Authorization')).toBe('Bearer test-token');
      expect(headers.get('X-CSRF-TOKEN')).toBe('csrf-fixture');
      expect(headers.get('Content-Type')).toBe('application/json');
    },
  );

  it.each([
    { music: null, created: true },
    { music: { ...registered, music_id: null }, created: true },
    { music: { ...registered, music_id: 0 }, created: true },
    { music: { ...registered, music_id: 1.1 }, created: true },
    { music: { ...registered, external_music_id: '456' }, created: false },
    { music: { ...registered, provider: 'OTHER' }, created: true },
    { music: { ...registered, artist_name: null }, created: true },
    { music: { ...registered, preview_url: 1 }, created: true },
    { music: { ...registered, youtube_video_id: undefined }, created: true },
    { music: { ...registered, is_queueable: 'true' }, created: true },
    { music: registered, created: 'true' },
  ])('손상된 등록 응답은 완료로 처리하지 않는다: %j', async (data) => {
    stubRegistration(data);
    await expect(registerSelectedMusic('123')).rejects.toMatchObject({
      status: null,
      requestWasSent: true,
    });
  });

  it.each([401, 403])(
    'CSRF %s 실패는 등록 POST를 보내지 않고 MusicApiError로 정규화한다',
    async (status) => {
      const fetchMock = vi.fn(async () => Response.json({ data: null }, { status }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(registerSelectedMusic('123')).rejects.toMatchObject({
        status,
        requestWasSent: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('CSRF 연결 실패도 등록 미전송 오류로 처리한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fixture offline')));
    await expect(registerSelectedMusic('123')).rejects.toBeInstanceOf(MusicApiError);
    await expect(registerSelectedMusic('123')).rejects.toMatchObject({
      status: null,
      requestWasSent: false,
    });
    expect(
      vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/auth/token/csrf')),
    ).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 429, 500, 502, 503, 504])(
    '등록 HTTP %s를 보존한다',
    async (status) => {
      stubRegistration(null, status);
      await expect(registerSelectedMusic('123')).rejects.toMatchObject({ status });
    },
  );

  it('중단된 요청은 CSRF/POST를 보내지 않고 취소 원인을 보존한다', async () => {
    const fetchMock = stubRegistration({ music: registered, created: true });
    const controller = new AbortController();
    const reason = new DOMException('fixture abort', 'AbortError');
    controller.abort(reason);
    await expect(registerSelectedMusic('123', controller.signal)).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CSRF 완료 중 취소되면 등록 POST를 보내지 않는다', async () => {
    const controller = new AbortController();
    const reason = new DOMException('fixture timeout', 'TimeoutError');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort(reason);
        return Response.json({ data: { csrf_token: 'csrf-fixture' } });
      }),
    );
    await expect(registerSelectedMusic('123', controller.signal)).rejects.toBe(reason);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('POST 전송 중 취소는 원래 abort 사유를 보존한다', async () => {
    const controller = new AbortController();
    const reason = new DOMException('fixture abort', 'AbortError');
    const fetchMock = stubRegistration({ music: registered, created: true });
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/auth/token/csrf'))
        return Response.json({ data: { csrf_token: 'csrf-fixture' } });
      controller.abort(reason);
      throw new TypeError('aborted transport');
    });
    await expect(registerSelectedMusic('123', controller.signal)).rejects.toBe(reason);
  });
});
