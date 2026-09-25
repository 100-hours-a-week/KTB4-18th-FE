import {
  resolveLocation,
  type LocationCoordinates,
  type LocationResolution,
} from '../../../api/locationResolutions';

const MAX_ACCURACY_METERS = 100;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3_000;
const LOCATION_TIMEOUT_MS = 10_000;

const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: LOCATION_TIMEOUT_MS,
};

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function getCurrentPosition(signal: AbortSignal): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }

    const handleAbort = () => reject(abortError());
    signal.addEventListener('abort', handleAbort, { once: true });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        signal.removeEventListener('abort', handleAbort);
        if (signal.aborted) {
          reject(abortError());
          return;
        }
        resolve(position);
      },
      (error) => {
        signal.removeEventListener('abort', handleAbort);
        reject(error);
      },
      GEOLOCATION_OPTIONS,
    );
  });
}

function wait(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timerId = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = () => {
      window.clearTimeout(timerId);
      reject(abortError());
    };
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function coordinatesFrom(position: GeolocationPosition): LocationCoordinates | null {
  if (position.coords.accuracy > MAX_ACCURACY_METERS) {
    return null;
  }
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy,
  };
}

function locationErrorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as GeolocationPositionError).code;
    if (code === 1) {
      return '주기적인 지역 확인을 위해 위치 권한을 허용해 주세요.';
    }
    if (code === 3) {
      return '위치 확인 시간이 초과되었습니다. 다음 확인 때 다시 시도합니다.';
    }
  }
  return '현재 위치를 다시 확인하지 못했습니다. 다음 확인 때 다시 시도합니다.';
}

export async function resolveCurrentChatLocation(
  accessToken: string,
  signal: AbortSignal,
): Promise<LocationResolution> {
  if (!navigator.geolocation) {
    throw new Error('이 브라우저에서는 위치 확인을 지원하지 않습니다.');
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const position = await getCurrentPosition(signal);
      const coordinates = coordinatesFrom(position);
      if (coordinates) {
        return await resolveLocation(coordinates, accessToken, signal);
      }
      lastError = new Error('위치 정확도가 충분하지 않습니다.');
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        throw caught;
      }
      lastError = caught;
      if (typeof caught === 'object' && caught !== null && 'code' in caught) {
        if ((caught as GeolocationPositionError).code === 1) {
          break;
        }
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      await wait(RETRY_DELAY_MS, signal);
    }
  }

  if (lastError instanceof Error && lastError.message.includes('정확도')) {
    throw new Error('위치 정확도가 충분하지 않아 지역 이동을 확인하지 못했습니다.');
  }
  throw new Error(locationErrorMessage(lastError));
}
