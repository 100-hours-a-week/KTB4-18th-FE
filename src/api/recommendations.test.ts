import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccessToken, setAccessToken } from '../features/auth-login/api/authSession';
import { recommend } from './recommendations';

describe('recommend', () => {
  beforeEach(() => setAccessToken('access-token'));
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
    sessionStorage.clear();
  });

  it('로그인 토큰을 Authorization 헤더로 전달한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'recommendation completed',
          data: {
            recommendation_id: 1,
            conversation_key: 'conversation',
            status: 'PROCESSING',
          },
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      recommend('비 오는 날', 'conversation', new AbortController().signal),
    ).resolves.toMatchObject({ status: 'PROCESSING', recommendation_id: 1 });

    const [, options] = fetchMock.mock.calls[0];
    const headers = new Headers(options.headers);
    expect(headers.get('Authorization')).toBe('Bearer access-token');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('refresh에 실패하면 익명 추천 요청을 보내지 않는다', async () => {
    clearAccessToken();
    const fetchMock = vi.fn((input: string | URL) => {
      if (String(input).endsWith('/token/csrf')) {
        return Promise.resolve(Response.json({ data: { csrf_token: 'csrf' } }));
      }
      return Promise.resolve(
        Response.json({ message: 'unauthorized', data: null }, { status: 401 }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      recommend('비 오는 날', 'conversation', new AbortController().signal),
    ).rejects.toThrow('로그인이 만료되었습니다. 다시 로그인해 주세요.');

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      expect.stringContaining('/token/csrf'),
      expect.stringContaining('/token/refresh'),
    ]);
  });
});
