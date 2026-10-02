import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MapData = {
  items: Array<{
    map_dot_id: number;
    code: string;
    album_cover_url: string | null;
    latest_recorded_at: string | null;
  }>;
};

const envelope = (cover: string | null): { message: string; data: MapData } => ({
  message: 'map dots retrieved',
  data: {
    items: [
      { map_dot_id: 1, code: 'KR-COAST-0001', album_cover_url: cover, latest_recorded_at: null },
    ],
  },
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe('map dot conditional cache', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reuses the in-memory body after a matching ETag returns 304', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json(envelope('https://cdn.example.com/cover.jpg'), {
          headers: { ETag: '"map-v1"' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: '"map-v1"' } }));
    const { fetchMapDots } = await import('./mapApi');
    const signal = new AbortController().signal;

    const first = await fetchMapDots(signal);
    const second = await fetchMapDots(signal);

    expect(second).toEqual(first);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers).get('If-None-Match')).toBe(
      '"map-v1"',
    );
  });

  it.each([200, 304])(
    'discards an in-flight stale %i and retries without the old ETag',
    async (status) => {
      const oldResponse = deferred<Response>();
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          Response.json(envelope('https://cdn.example.com/old.jpg'), {
            headers: { ETag: '"old"' },
          }),
        )
        .mockReturnValueOnce(oldResponse.promise)
        .mockResolvedValueOnce(
          Response.json(envelope('https://cdn.example.com/current.jpg'), {
            headers: { ETag: '"current"' },
          }),
        );
      const { fetchMapDots, invalidateMapDotsCache } = await import('./mapApi');
      const signal = new AbortController().signal;
      await fetchMapDots(signal);

      const pending = fetchMapDots(signal);
      invalidateMapDotsCache();
      oldResponse.resolve(
        status === 304
          ? new Response(null, { status: 304, headers: { ETag: '"old"' } })
          : Response.json(envelope('https://cdn.example.com/old.jpg'), {
              headers: { ETag: '"old"' },
            }),
      );

      const result = await pending;
      expect(result.items[0].album_cover_url).toBe('https://cdn.example.com/current.jpg');
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
      expect(new Headers(vi.mocked(fetch).mock.calls[2][1]?.headers).has('If-None-Match')).toBe(
        false,
      );
    },
  );

  it('does not retry or cache a stale response after the caller aborts', async () => {
    const oldResponse = deferred<Response>();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json(envelope('https://cdn.example.com/old.jpg'), {
          headers: { ETag: '"old"' },
        }),
      )
      .mockReturnValueOnce(oldResponse.promise);
    const { fetchMapDots, invalidateMapDotsCache } = await import('./mapApi');
    await fetchMapDots(new AbortController().signal);

    const controller = new AbortController();
    const pending = fetchMapDots(controller.signal);
    invalidateMapDotsCache();
    controller.abort();
    oldResponse.resolve(Response.json(envelope('https://cdn.example.com/stale.jpg')));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});

const data = (cover: string) => ({
  items: [{ map_dot_id: 5, code: 'dot-5', album_cover_url: cover, latest_recorded_at: null }],
});
const response = (cover: string) =>
  Response.json({ data: data(cover) }, { headers: { ETag: cover } });

describe('기록 삭제 후 지도 캐시', () => {
  let fetchMapDots: typeof import('./mapApi').fetchMapDots;
  let invalidateMapDotsCache: typeof import('./mapApi').invalidateMapDotsCache;
  beforeEach(async () => {
    vi.resetModules();
    ({ fetchMapDots, invalidateMapDotsCache } = await import('./mapApi'));
    invalidateMapDotsCache();
  });
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
