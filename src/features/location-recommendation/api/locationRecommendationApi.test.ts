import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '../../auth-login/api/authSession';
import {
  cancelLocationRecommendation,
  createLocationRecommendation,
} from './locationRecommendationApi';

vi.mock('../../auth-login/api/authSession', () => ({
  AuthRequestError: class AuthRequestError extends Error {
    status = 401;
  },
  authenticatedFetch: vi.fn(),
}));

const operationUUID = '123e4567-e89b-42d3-a456-426614174000';
const canonicalRequestId = '223e4567-e89b-42d3-a456-426614174001';
const scopeGeneration = '323e4567-e89b-42d3-a456-426614174002';
const cancellationUUID = '423e4567-e89b-42d3-a456-426614174003';

function recommendation(status: 'READY' | 'FAILED' = 'READY') {
  return {
    requestId: canonicalRequestId,
    status,
    reason: null,
    region: { regionId: 1, code: '11110', name: '종로구', sidoName: '서울특별시' },
    tracks:
      status === 'READY'
        ? [
            {
              trackId: 'track-1',
              title: '노래',
              artist: '가수',
              previewUrl: 'https://example.com/preview.mp3',
              artworkUrl: null,
              storeUrl: null,
            },
          ]
        : [],
    scopeGeneration,
    cancelEpoch: 0,
    remainingTtlMs: status === 'READY' ? 60_000 : 0,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('createLocationRecommendation', () => {
  const input = {
    requestId: operationUUID,
    latitude: 37.5,
    longitude: 127,
    accuracyMeters: 12,
    sampleAgeMs: 3,
    trigger: 'SESSION_START' as const,
    scopeGeneration,
    cancelEpoch: 0,
  };

  it('sends the operation UUID as an idempotency key and accepts a canonical alias ID', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(
      Response.json({ message: 'ready', data: recommendation() }),
    );

    await expect(
      createLocationRecommendation({
        requestId: operationUUID,
        latitude: 37.5,
        longitude: 127,
        accuracyMeters: 12,
        sampleAgeMs: 3,
        trigger: 'SESSION_START',
        scopeGeneration,
        cancelEpoch: 0,
      }),
    ).resolves.toMatchObject({ requestId: canonicalRequestId, status: 'READY' });

    const [url, options] = vi.mocked(authenticatedFetch).mock.calls[0];
    const headers = new Headers(options?.headers);
    expect(String(url)).toContain('/api/v1/location-recommendations');
    expect(headers.get('Idempotency-Key')).toBe(operationUUID);
    expect(JSON.parse(String(options?.body))).toEqual({
      latitude: 37.5,
      longitude: 127,
      accuracyMeters: 12,
      sampleAgeMs: 3,
      trigger: 'SESSION_START',
      scopeGeneration,
      cancelEpoch: 0,
    });
  });

  it('rejects a READY response without tracks', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(
      Response.json({ message: 'ready', data: { ...recommendation(), tracks: [] } }),
    );

    await expect(
      createLocationRecommendation({
        requestId: operationUUID,
        latitude: 37.5,
        longitude: 127,
        accuracyMeters: 12,
        sampleAgeMs: 3,
        trigger: 'SESSION_START',
        scopeGeneration,
        cancelEpoch: 0,
      }),
    ).rejects.toThrow('Location recommendation request failed');
  });

  it('rejects a success envelope without a message string', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(Response.json({ data: recommendation() }));

    await expect(createLocationRecommendation(input)).rejects.toMatchObject({ status: 200 });
  });

  it('sends only entry and resume triggers', async () => {
    vi.mocked(authenticatedFetch).mockImplementation(() =>
      Promise.resolve(
        Response.json({ message: 'empty', data: { ...recommendation('FAILED'), status: 'EMPTY' } }),
      ),
    );

    await createLocationRecommendation(input);
    expect(JSON.parse(String(vi.mocked(authenticatedFetch).mock.calls[0][1]?.body)).trigger).toBe(
      'SESSION_START',
    );
    await createLocationRecommendation({ ...input, trigger: 'RESUME' });
    expect(JSON.parse(String(vi.mocked(authenticatedFetch).mock.calls[1][1]?.body)).trigger).toBe(
      'RESUME',
    );
  });

  it('preserves allowed Apple URLs and nulls unsafe media URL fields independently', async () => {
    const track = recommendation().tracks[0];
    vi.mocked(authenticatedFetch).mockResolvedValue(
      Response.json({
        message: 'ready',
        data: {
          ...recommendation(),
          tracks: [
            {
              ...track,
              previewUrl: 'https://audio-ssl.itunes.apple.com/preview.mp3',
              artworkUrl: 'https://is1-ssl.mzstatic.com/image/100x100bb.jpg',
              storeUrl: 'https://music.apple.com/kr/album/song',
            },
            {
              ...track,
              trackId: 'track-unsafe',
              previewUrl: 'https://evil.example/preview.mp3',
              artworkUrl: 'http://is1-ssl.mzstatic.com/image.jpg',
              storeUrl: 'https://evil.example/song',
            },
          ],
        },
      }),
    );

    await expect(createLocationRecommendation(input)).resolves.toMatchObject({
      tracks: [
        {
          previewUrl: 'https://audio-ssl.itunes.apple.com/preview.mp3',
          artworkUrl: 'https://is1-ssl.mzstatic.com/image/680x680bb.jpg',
          storeUrl: 'https://music.apple.com/kr/album/song',
        },
        { previewUrl: null, artworkUrl: null, storeUrl: null },
      ],
    });
  });

  it.each([
    ['missing tracks', (value: Record<string, unknown>) => delete value.tracks],
    ['missing region', (value: Record<string, unknown>) => delete value.region],
    ['missing TTL', (value: Record<string, unknown>) => delete value.remainingTtlMs],
    ['null region', (value: Record<string, unknown>) => (value.region = null)],
    [
      'more than five tracks',
      (value: Record<string, unknown>) => {
        value.tracks = Array.from({ length: 6 }, (_, index) => ({
          trackId: `track-${index}`,
          title: '노래',
          artist: '가수',
          previewUrl: null,
          artworkUrl: null,
          storeUrl: null,
        }));
      },
    ],
  ])('rejects malformed DTOs with %s', async (_, mutate) => {
    const data = recommendation() as unknown as Record<string, unknown>;
    const clone = structuredClone(data);
    mutate(clone);
    vi.mocked(authenticatedFetch).mockResolvedValue(
      Response.json({ message: 'ready', data: clone }),
    );

    await expect(createLocationRecommendation(input)).rejects.toMatchObject({ status: 200 });
  });

  it.each([401, 403, 409, 503])(
    'preserves HTTP %i while hiding the response reason',
    async (status) => {
      vi.mocked(authenticatedFetch).mockResolvedValue(
        Response.json({ message: 'UPSTREAM_UNAVAILABLE', data: null }, { status }),
      );

      await expect(createLocationRecommendation(input)).rejects.toMatchObject({
        name: 'LocationRecommendationApiError',
        status,
        message: 'Location recommendation request failed',
      });
    },
  );
});

describe('cancelLocationRecommendation', () => {
  it('sends the canonical request ID and the stable cancellation UUID', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(
      Response.json({
        message: 'cancelled',
        data: { status: 'CANCELLED', scopeGeneration, cancelEpoch: 1 },
      }),
    );

    await expect(
      cancelLocationRecommendation({
        requestId: canonicalRequestId,
        scopeGeneration,
        cancelEpoch: 0,
        cancellationUUID,
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED', cancelEpoch: 1 });

    const [url, options] = vi.mocked(authenticatedFetch).mock.calls[0];
    expect(String(url)).toContain('/api/v1/location-recommendation-context/cancellations');
    expect(new Headers(options?.headers).get('Idempotency-Key')).toBe(cancellationUUID);
    expect(JSON.parse(String(options?.body))).toEqual({
      requestId: canonicalRequestId,
      scopeGeneration,
      cancelEpoch: 0,
    });
  });
});
