import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MusicApiError, resolveLocation, type Location } from '../api/musicRecordsApi';
import { useLocation } from './useLocation';

vi.mock('../api/musicRecordsApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/musicRecordsApi')>();
  return { ...original, resolveLocation: vi.fn() };
});

const resolved: Location = {
  map_dot: { map_dot_id: 1, code: 'dot' },
  region: {
    sido: { region_id: 1, code: '11', name: '서울특별시' },
    sigungu: { region_id: 2, code: '11200', name: '성동구' },
  },
  location_resolution_token: 'token', expires_in: 300,
};

function stubAccuratePosition(onCalled: () => void = () => undefined) {
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
    geolocation: {
      getCurrentPosition: (success: PositionCallback) => {
        onCalled();
        success({ coords: { latitude: 37.5, longitude: 127, accuracy: 20 } } as GeolocationPosition);
      },
    },
  }));
}

describe('위치 판정 토큰', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('서버 응답 지연을 포함해 요청 시작 시각부터 300초를 계산한다', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    stubAccuratePosition();
    let finishResolve!: (value: Location) => void;
    vi.mocked(resolveLocation).mockImplementation(() => new Promise((resolve) => { finishResolve = resolve; }));
    const { result } = renderHook(() => useLocation());
    let acquired!: Promise<Location>;
    act(() => { acquired = result.current.acquire(); });
    await waitFor(() => expect(resolveLocation).toHaveBeenCalledOnce());
    now = 301_000;
    await act(async () => { finishResolve(resolved); await acquired; });
    expect(result.current.isExpired()).toBe(true);
  });

  it('정확한 GPS 후 역지오코딩 502는 위치 요청을 반복하지 않고 오류를 알린다', async () => {
    const gps = vi.fn();
    stubAccuratePosition(gps);
    vi.mocked(resolveLocation).mockRejectedValue(new MusicApiError(502, 'reverse geocoding failed'));
    const { result } = renderHook(() => useLocation());
    await act(async () => { await expect(result.current.acquire()).rejects.toMatchObject({ status: 502 }); });
    expect(gps).toHaveBeenCalledOnce();
    expect(result.current.error).toBe('현재 위치를 판정하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  });

  it('100m 정확도를 얻지 못하면 10초 timeout 설정으로 최대 3회, 요청 사이 3초 간격 후 수동 재시도를 안내한다', async () => {
    vi.useFakeTimers();
    const getCurrentPosition = vi.fn((_success: PositionCallback, failure: PositionErrorCallback, options: PositionOptions) => {
      expect(options).toMatchObject({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
      failure({ code: 3, message: 'timeout' } as GeolocationPositionError);
    });
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
      geolocation: { getCurrentPosition },
    }));
    const { result } = renderHook(() => useLocation());
    let request!: Promise<Location>;
    act(() => { request = result.current.acquire(); });
    const settled = request.catch((error: unknown) => error);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(await settled).toMatchObject({ message: expect.stringContaining('직접 다시 시도해 주세요') });
    expect(getCurrentPosition).toHaveBeenCalledTimes(3);
    expect(resolveLocation).not.toHaveBeenCalled();
  });
});
