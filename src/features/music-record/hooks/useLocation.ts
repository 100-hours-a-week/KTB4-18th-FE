import { useCallback, useState } from 'react';

import { MusicApiError, resolveLocation, type Location } from '../api/musicRecordsApi';

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const position = () => new Promise<GeolocationPosition>((resolve, reject) =>
  navigator.geolocation.getCurrentPosition(resolve, reject, {
    enableHighAccuracy: true, timeout: 10_000, maximumAge: 0,
  }));

export function useLocation() {
  const [location, setLocation] = useState<Location | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [isLocating, setIsLocating] = useState(false);
  const [error, setError] = useState('');

  const acquire = useCallback(async () => {
    setIsLocating(true);
    setError('');
    setLocation(null);
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let value: GeolocationPosition | null = null;
        try { value = await position(); }
        catch { /* A later attempt may have a better satellite fix. */ }
        if (value && value.coords.accuracy <= 100) {
          const requestedAt = Date.now();
          const resolved = await resolveLocation(
            value.coords.latitude, value.coords.longitude, value.coords.accuracy,
          );
          setLocation(resolved);
          setExpiresAt(requestedAt + resolved.expires_in * 1000);
          return resolved;
        }
        if (attempt < 2) await wait(3_000);
      }
      throw new Error('100m 이내의 위치를 확인하지 못했습니다. 위치 권한과 신호를 확인한 뒤 직접 다시 시도해 주세요.');
    } catch (caught) {
      setError(caught instanceof MusicApiError && caught.status === 502
        ? '현재 위치를 판정하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        : caught instanceof MusicApiError && caught.status === 404
          ? '현재 위치에 해당하는 지역을 찾지 못했습니다. 다시 시도해 주세요.'
          : caught instanceof Error ? caught.message : '위치를 확인하지 못했습니다.');
      throw caught;
    } finally { setIsLocating(false); }
  }, []);

  const isExpired = useCallback(() => Boolean(location && Date.now() >= expiresAt), [location, expiresAt]);
  return { location, isLocating, error, acquire, isExpired };
}
