import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMapDots, invalidateMapDotsCache } from './mapApi';

const data = (cover: string) => ({
  items: [{ map_dot_id: 5, code: 'dot-5', album_cover_url: cover, latest_recorded_at: null }],
});
const response = (cover: string) =>
  Response.json({ data: data(cover) }, { headers: { ETag: cover } });

describe('기록 삭제 후 지도 캐시', () => {
  beforeEach(() => invalidateMapDotsCache());
  afterEach(() => vi.unstubAllGlobals());

  it('무효화 후 이전 ETag 없이 새 지도 정보를 조회한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(response('old')).mockResolvedValueOnce(response('new')),
    );
    const signal = new AbortController().signal;
    await fetchMapDots(signal);
    invalidateMapDotsCache();
    expect(await fetchMapDots(signal)).toEqual(data('new'));
    expect(new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers).has('If-None-Match')).toBe(
      false,
    );
  });

  it('삭제 전 요청의 늦은 응답이 새 캐시와 ETag를 덮어쓰지 않는다', async () => {
    let finishOld!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishOld = resolve;
            }),
        )
        .mockResolvedValueOnce(response('new'))
        .mockResolvedValueOnce(new Response(null, { status: 304 })),
    );
    const signal = new AbortController().signal;
    const old = fetchMapDots(signal);
    invalidateMapDotsCache();
    await fetchMapDots(signal);
    finishOld(response('old'));
    await old;
    expect(await fetchMapDots(signal)).toEqual(data('new'));
    expect(new Headers(vi.mocked(fetch).mock.calls[2][1]?.headers).get('If-None-Match')).toBe(
      'new',
    );
  });

  it('무효화 전에 시작한 304 요청은 새 캐시를 다시 조회한다', async () => {
    let finishOld!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response('old'))
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishOld = resolve;
            }),
        )
        .mockResolvedValueOnce(response('new')),
    );
    const signal = new AbortController().signal;
    await fetchMapDots(signal);
    const pending = fetchMapDots(signal);
    invalidateMapDotsCache();
    finishOld(new Response(null, { status: 304 }));
    expect(await pending).toEqual(data('new'));
    expect(new Headers(vi.mocked(fetch).mock.calls[2][1]?.headers).has('If-None-Match')).toBe(
      false,
    );
  });
});
