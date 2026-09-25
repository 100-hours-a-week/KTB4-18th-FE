import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveLocation } from '../../../api/locationResolutions';
import { resolveCurrentChatLocation } from './resolveCurrentChatLocation';

vi.mock('../../../api/locationResolutions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/locationResolutions')>()),
  resolveLocation: vi.fn(),
}));

const resolvedLocation = {
  mapDot: null,
  region: {
    sido: { regionId: 9, code: '41', name: '경기도' },
    sigungu: { regionId: 25, code: '41135', name: '성남시 분당구' },
  },
  locationResolutionToken: 'loc-token',
  expiresIn: 300,
};

function position(accuracy: number): GeolocationPosition {
  return {
    coords: {
      latitude: 37.3595704,
      longitude: 127.105399,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: Date.now(),
    toJSON: () => ({}),
  };
}

describe('resolveCurrentChatLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveLocation).mockResolvedValue(resolvedLocation);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('고정밀·캐시 미사용 옵션으로 현재 위치를 판정한다', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success(position(20)));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const signal = new AbortController().signal;

    const result = await resolveCurrentChatLocation('access-token', signal);

    expect(result).toEqual(resolvedLocation);
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10_000,
    });
  });

  it('정확도가 낮으면 3초 후 다시 요청한다', async () => {
    vi.useFakeTimers();
    const getCurrentPosition = vi
      .fn()
      .mockImplementationOnce((success: PositionCallback) => success(position(180)))
      .mockImplementationOnce((success: PositionCallback) => success(position(30)));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });

    const request = resolveCurrentChatLocation('access-token', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(request).resolves.toEqual(resolvedLocation);
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it('화면 이탈 신호가 오면 재시도 대기를 취소한다', async () => {
    vi.useFakeTimers();
    const getCurrentPosition = vi.fn((success: PositionCallback) => success(position(180)));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const controller = new AbortController();

    const request = resolveCurrentChatLocation('access-token', controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });
});
