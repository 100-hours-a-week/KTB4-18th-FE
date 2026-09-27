import { afterEach, describe, expect, it, vi } from 'vitest';
import { recommend } from './recommendations';

describe('recommend', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('로그인 토큰을 Authorization 헤더로 전달한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'recommendation completed',
          data: {
            recommendation_id: 1,
            conversation_key: 'conversation',
            status: 'COMPLETED',
            items: [
              {
                rank_no: 1,
                music: {
                  music_id: 1,
                  title: '밤편지',
                  artist_name: '아이유',
                  album_cover_url: null,
                  preview_url: null,
                },
              },
            ],
            completed_at: '2026-09-27T00:00:00Z',
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      recommend('비 오는 날', 'conversation', 'access-token', new AbortController().signal),
    ).resolves.toMatchObject({ status: 'COMPLETED' });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toEqual({
      Authorization: 'Bearer access-token',
      'Content-Type': 'application/json',
    });
  });
});
