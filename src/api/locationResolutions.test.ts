import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocationResolutionError, resolveLocation } from './locationResolutions';

describe('resolveLocation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('위치 정보를 snake_case로 전송하고 판정 결과를 반환한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'location resolved',
          data: {
            map_dot: { map_dot_id: 101, code: 'DOT-001' },
            region: {
              sido: { region_id: 9, code: '41', name: '경기도' },
              sigungu: { region_id: 25, code: '41135', name: '성남시 분당구' },
            },
            location_resolution_token: 'loc-token',
            expires_in: 300,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveLocation(
      { latitude: 37.3595704, longitude: 127.105399, accuracyMeters: 18.5 },
      'access-token',
      new AbortController().signal,
    );

    expect(result.region.sigungu).toEqual({
      regionId: 25,
      code: '41135',
      name: '성남시 분당구',
    });
    expect(result.locationResolutionToken).toBe('loc-token');
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.headers).toEqual({
      Authorization: 'Bearer access-token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(options.body as string)).toEqual({
      latitude: 37.3595704,
      longitude: 127.105399,
      accuracy_meters: 18.5,
    });
  });

  it('인증 실패를 다시 로그인해야 하는 오류로 변환한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'unauthorized', data: null }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const error = await resolveLocation(
      { latitude: 37.3595704, longitude: 127.105399, accuracyMeters: 18.5 },
      'expired-token',
      new AbortController().signal,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LocationResolutionError);
    expect(error).toMatchObject({ status: 401, isRetryable: false });
    expect((error as Error).message).toContain('다시 로그인');
  });

  it(
    '필수 판정 정보가 없는 성공 응답을 재시도 가능한 오류로 처리한다',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ message: 'location resolved', data: {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );

      const error = await resolveLocation(
        { latitude: 37.3595704, longitude: 127.105399, accuracyMeters: 18.5 },
        'access-token',
        new AbortController().signal,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LocationResolutionError);
      expect(error).toMatchObject({ status: 502, isRetryable: true });
    },
  );
});
