import { useCallback, useState } from 'react';

import { MusicApiError, resolveLocation, type Location } from '../api/musicRecordsApi';

const MAX_ACCURACY_METERS = 100;
const POSITION_RECHECK_DELAY_MS = 500;
const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 0,
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const position = (geolocation: Geolocation) =>
  new Promise<GeolocationPosition>((resolve, reject) =>
    geolocation.getCurrentPosition(resolve, reject, POSITION_OPTIONS),
  );

function isAccuratePosition(value: GeolocationPosition) {
  const { accuracy } = value.coords;
  return Number.isFinite(accuracy) && accuracy <= MAX_ACCURACY_METERS;
}

function refinePosition(geolocation: Geolocation, initialPosition: GeolocationPosition) {
  let watchId: number | undefined;
  let deadline: number | undefined;
  let recheckTimer: number | undefined;
  return new Promise<GeolocationPosition>((resolve, reject) => {
    const acceptPrecise = (value: GeolocationPosition) => {
      if (isAccuratePosition(value)) resolve(value);
    };
    const rejectIfDenied = (error: unknown) => {
      if (readPositionErrorCode(error) === 1) reject(error);
    };
    deadline = window.setTimeout(() => resolve(initialPosition), POSITION_OPTIONS.timeout);
    watchId = geolocation.watchPosition(acceptPrecise, rejectIfDenied, POSITION_OPTIONS);
    // Some providers return an updated fix only on a fresh request.
    recheckTimer = window.setTimeout(() => {
      void position(geolocation).then(acceptPrecise, rejectIfDenied);
    }, POSITION_RECHECK_DELAY_MS);
  }).finally(() => {
    window.clearTimeout(deadline);
    window.clearTimeout(recheckTimer);
    if (watchId !== undefined) geolocation.clearWatch(watchId);
  });
}

function readPositionErrorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
}

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
      const geolocation = navigator.geolocation;
      if (!geolocation) {
        throw new Error('이 브라우저에서는 위치 확인을 사용할 수 없습니다.');
      }

      let failureMessage = '';
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const canRefine = typeof geolocation.watchPosition === 'function';
        const value = await position(geolocation)
          .then((initialPosition) =>
            canRefine && !isAccuratePosition(initialPosition)
              ? refinePosition(geolocation, initialPosition)
              : initialPosition,
          )
          .catch((error: unknown) => {
            const code = readPositionErrorCode(error);
            if (code === 1) {
              throw new Error(
                '위치 권한이 차단되어 있습니다. 브라우저와 기기 설정에서 위치 권한을 허용한 뒤 다시 시도해 주세요.',
              );
            }
            failureMessage =
              code === 3
                ? '위치 확인 시간이 초과됐습니다. 잠시 후 직접 다시 시도해 주세요.'
                : '브라우저에서 현재 위치를 가져오지 못했습니다. 기기의 위치 서비스와 네트워크를 확인한 뒤 다시 시도해 주세요.';
            return null;
          });
        if (value) {
          const { latitude, longitude, accuracy } = value.coords;
          if (isAccuratePosition(value)) {
            const requestedAt = Date.now();
            const resolved = await resolveLocation(latitude, longitude, accuracy);
            setLocation(resolved);
            setExpiresAt(requestedAt + resolved.expires_in * 1000);
            return resolved;
          }
          failureMessage =
            '위치 정확도가 100m 기준을 충족하지 못했습니다. 위치 신호가 좋은 곳에서 다시 시도해 주세요.';
          if (canRefine) break;
        }
        if (attempt < 2) await wait(3_000);
      }
      throw new Error(failureMessage);
    } catch (caught) {
      setError(
        caught instanceof MusicApiError && caught.status === 502
          ? '현재 위치를 판정하지 못했습니다. 잠시 후 다시 시도해 주세요.'
          : caught instanceof MusicApiError && caught.status === 404
            ? '현재 위치에 해당하는 지역을 찾지 못했습니다. 다시 시도해 주세요.'
            : caught instanceof Error
              ? caught.message
              : '위치를 확인하지 못했습니다.',
      );
      throw caught;
    } finally {
      setIsLocating(false);
    }
  }, []);

  const isExpired = useCallback(
    () => Boolean(location && Date.now() >= expiresAt),
    [location, expiresAt],
  );
  return { location, isLocating, error, acquire, isExpired };
}
