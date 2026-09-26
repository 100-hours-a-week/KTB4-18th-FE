import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAllRecommendationHistory, updateMyProfile } from './mypageApi';

describe('mypageApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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

    const history = await getAllRecommendationHistory('access-token');

    expect(history.map((item) => item.music_id)).toEqual([12, 24, 24, 36]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends only provided profile fields with the CSRF token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: { csrf_token: 'csrf-token' } }))
      .mockResolvedValueOnce(Response.json({ data: { user_id: 1, updated_at: '2026-09-26' } }));
    vi.stubGlobal('fetch', fetchMock);

    await updateMyProfile('access-token', { nickname: '새 닉네임' });

    const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/v1/users/me');
    expect(options.headers).toEqual({
      Authorization: 'Bearer access-token',
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': 'csrf-token',
    });
    expect(JSON.parse(options.body as string)).toEqual({ nickname: '새 닉네임' });
  });
});
