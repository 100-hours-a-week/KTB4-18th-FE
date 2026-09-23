import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveLocation } from '../api/locationResolutions';
import { useChatLocation } from './useChatLocation';

vi.mock('../api/locationResolutions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/locationResolutions')>()),
  resolveLocation: vi.fn(),
}));

const resolution = {
  mapDot: { mapDotId: 101, code: 'DOT-001' },
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

describe('useChatLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveLocation).mockResolvedValue(resolution);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('고정밀 옵션으로 위치를 확인하고 판정 API를 호출한다', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success(position(18.5)));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const { result } = renderHook(() => useChatLocation({ accessToken: 'access-token' }));

    await act(async () => result.current.requestLocation());

    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10_000,
    });
    expect(resolveLocation).toHaveBeenCalledWith(
      { latitude: 37.3595704, longitude: 127.105399, accuracyMeters: 18.5 },
      'access-token',
      expect.any(AbortSignal),
    );
    expect(result.current.status).toBe('resolved');
    expect(result.current.resolution?.region.sigungu.name).toBe('성남시 분당구');
  });

  it('정확도가 낮으면 3초 후 다시 요청한다', async () => {
    vi.useFakeTimers();
    const getCurrentPosition = vi
      .fn()
      .mockImplementationOnce((success: PositionCallback) => success(position(150)))
      .mockImplementationOnce((success: PositionCallback) => success(position(30)));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const { result } = renderHook(() => useChatLocation({ accessToken: 'access-token' }));

    let request: Promise<void>;
    act(() => {
      request = result.current.requestLocation();
    });
    await act(async () => Promise.resolve());
    expect(result.current.status).toBe('retrying');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      await request;
    });

    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(result.current.attempt).toBe(2);
    expect(result.current.status).toBe('resolved');
  });

  it('낮은 정확도가 세 번 계속되면 자동 재시도를 멈춘다', async () => {
    vi.useFakeTimers();
    const getCurrentPosition = vi.fn((success: PositionCallback) => success(position(200)));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const { result } = renderHook(() => useChatLocation({ accessToken: 'access-token' }));

    let request: Promise<void>;
    act(() => {
      request = result.current.requestLocation();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
      await request;
    });

    expect(getCurrentPosition).toHaveBeenCalledTimes(3);
    expect(result.current.attempt).toBe(3);
    expect(result.current.status).toBe('error');
    expect(result.current.canRetry).toBe(true);
    expect(result.current.error).toContain('정확도');
    expect(resolveLocation).not.toHaveBeenCalled();
  });

  it('자동 재시도 소진 후 수동으로 다시 요청할 수 있다', async () => {
    vi.useFakeTimers();
    let positionRequestCount = 0;
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      positionRequestCount += 1;
      success(position(positionRequestCount <= 3 ? 200 : 20));
    });
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const { result } = renderHook(() => useChatLocation({ accessToken: 'access-token' }));

    let firstRequest: Promise<void>;
    act(() => {
      firstRequest = result.current.requestLocation();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
      await firstRequest;
    });
    expect(result.current.status).toBe('error');

    await act(async () => result.current.retryLocation());

    expect(getCurrentPosition).toHaveBeenCalledTimes(4);
    expect(result.current.status).toBe('resolved');
    expect(result.current.canRetry).toBe(false);
  });

  it('권한 거부 시 반복 요청 없이 수동 재시도를 제공한다', async () => {
    const permissionDenied = { code: 1, message: 'denied' } as GeolocationPositionError;
    const getCurrentPosition = vi.fn((_success: PositionCallback, failure: PositionErrorCallback) =>
      failure(permissionDenied),
    );
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const { result } = renderHook(() => useChatLocation({ accessToken: 'access-token' }));

    await act(async () => result.current.requestLocation());

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');
    expect(result.current.canRetry).toBe(true);
    expect(result.current.error).toContain('권한');
  });

  it('로그인 토큰이 없으면 위치 권한을 요청하지 않는다', async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const { result } = renderHook(() => useChatLocation({ accessToken: null }));

    await act(async () => result.current.requestLocation());

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(result.current.status).toBe('error');
    expect(result.current.canRetry).toBe(false);
    expect(result.current.error).toContain('로그인');
  });
});
