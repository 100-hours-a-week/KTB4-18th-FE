import { useCallback, useEffect, useRef, useState } from 'react';

import {
  LocationResolutionError,
  resolveLocation,
  type LocationCoordinates,
  type LocationResolution,
} from '../api/locationResolutions';

const MAX_ACCURACY_METERS = 100;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3_000;
const LOCATION_TIMEOUT_MS = 10_000;

const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: LOCATION_TIMEOUT_MS,
};

export type ChatLocationStatus =
  | 'idle'
  | 'requestingPermission'
  | 'retrying'
  | 'resolving'
  | 'resolved'
  | 'error';

interface UseChatLocationOptions {
  accessToken: string | null;
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, GEOLOCATION_OPTIONS);
  });
}

function isGeolocationError(error: unknown): error is GeolocationPositionError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function positionErrorMessage(error: unknown) {
  if (!isGeolocationError(error)) {
    return '현재 위치를 확인하지 못했습니다. 다시 시도해 주세요.';
  }
  switch (error.code) {
    case 1:
      return '채팅방 자동 입장을 위해 위치 권한을 허용해 주세요.';
    case 2:
      return (
        '현재 위치를 확인할 수 없습니다. ' +
        '위치 서비스를 켠 뒤 다시 시도해 주세요.'
      );
    case 3:
      return '위치 확인 시간이 초과되었습니다. 다시 시도해 주세요.';
    default:
      return '현재 위치를 확인하지 못했습니다. 다시 시도해 주세요.';
  }
}

export function useChatLocation({ accessToken }: UseChatLocationOptions) {
  const [status, setStatus] = useState<ChatLocationStatus>('idle');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [canRetry, setCanRetry] = useState(false);
  const [resolution, setResolution] = useState<LocationResolution | null>(null);
  const mountedRef = useRef(true);
  const runIdRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const retryResolveRef = useRef<(() => void) | null>(null);
  const resolutionRequestRef = useRef<AbortController | null>(null);

  const cancelRetryWait = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryResolveRef.current?.();
    retryResolveRef.current = null;
  }, []);

  const waitForRetry = useCallback(
    () =>
      new Promise<void>((resolve) => {
        retryResolveRef.current = resolve;
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          retryResolveRef.current = null;
          resolve();
        }, RETRY_DELAY_MS);
      }),
    [],
  );

  const requestLocation = useCallback(async () => {
    const runId = ++runIdRef.current;
    resolutionRequestRef.current?.abort();
    resolutionRequestRef.current = null;
    cancelRetryWait();

    setError('');
    setCanRetry(false);
    setResolution(null);
    setAttempt(0);

    if (!accessToken) {
      setStatus('error');
      setError('채팅방에 입장하려면 로그인이 필요합니다.');
      return;
    }
    if (!navigator.geolocation) {
      setStatus('error');
      setError('이 브라우저에서는 위치 확인을 지원하지 않습니다.');
      return;
    }

    let coordinates: LocationCoordinates | null = null;
    let lastPositionError =
      '현재 위치를 확인하지 못했습니다. 다시 시도해 주세요.';

    for (let currentAttempt = 1; currentAttempt <= MAX_ATTEMPTS; currentAttempt += 1) {
      if (!mountedRef.current || runId !== runIdRef.current) {
        return;
      }
      setAttempt(currentAttempt);
      setStatus('requestingPermission');

      try {
        const position = await getCurrentPosition();
        if (!mountedRef.current || runId !== runIdRef.current) {
          return;
        }
        if (position.coords.accuracy <= MAX_ACCURACY_METERS) {
          coordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          };
          break;
        }
        lastPositionError =
          '위치 정확도가 충분하지 않습니다. ' +
          '탁 트인 장소에서 다시 시도해 주세요.';
      } catch (caught) {
        if (!mountedRef.current || runId !== runIdRef.current) {
          return;
        }
        lastPositionError = positionErrorMessage(caught);
        if (isGeolocationError(caught) && caught.code === 1) {
          setStatus('error');
          setError(lastPositionError);
          setCanRetry(true);
          return;
        }
      }

      if (currentAttempt < MAX_ATTEMPTS) {
        setStatus('retrying');
        await waitForRetry();
      }
    }

    if (!coordinates) {
      if (mountedRef.current && runId === runIdRef.current) {
        setStatus('error');
        setError(lastPositionError);
        setCanRetry(true);
      }
      return;
    }

    const controller = new AbortController();
    resolutionRequestRef.current = controller;
    setStatus('resolving');
    try {
      const nextResolution = await resolveLocation(coordinates, accessToken, controller.signal);
      if (!mountedRef.current || runId !== runIdRef.current || controller.signal.aborted) {
        return;
      }
      setResolution(nextResolution);
      setStatus('resolved');
    } catch (caught) {
      if (!mountedRef.current || runId !== runIdRef.current || controller.signal.aborted) {
        return;
      }
      setStatus('error');
      setError(
        caught instanceof Error ? caught.message : '현재 위치를 판정하지 못했습니다.',
      );
      setCanRetry(
        !(caught instanceof LocationResolutionError) || caught.status !== 401,
      );
    } finally {
      if (resolutionRequestRef.current === controller) {
        resolutionRequestRef.current = null;
      }
    }
  }, [accessToken, cancelRetryWait, waitForRetry]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
      cancelRetryWait();
      resolutionRequestRef.current?.abort();
    };
  }, [cancelRetryWait]);

  return {
    status,
    attempt,
    error,
    canRetry,
    resolution,
    isLoading:
      status === 'requestingPermission' || status === 'retrying' || status === 'resolving',
    requestLocation,
    retryLocation: requestLocation,
  };
}
