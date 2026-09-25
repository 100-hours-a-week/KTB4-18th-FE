const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

interface ApiBody<T> {
  message?: string;
  data?: T | null;
}

interface LocationResolutionBody {
  map_dot?: {
    map_dot_id: number;
    code: string;
  } | null;
  region?: {
    sido?: RegionBody;
    sigungu?: RegionBody;
  };
  location_resolution_token?: string;
  expires_in?: number;
}

interface RegionBody {
  region_id: number;
  code: string;
  name: string;
}

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

export interface RegionSummary {
  regionId: number;
  code: string;
  name: string;
}

export interface LocationResolution {
  mapDot: {
    mapDotId: number;
    code: string;
  } | null;
  region: {
    sido: RegionSummary;
    sigungu: RegionSummary;
  };
  locationResolutionToken: string;
  expiresIn: number;
}

export class LocationResolutionError extends Error {
  readonly status: number | null;
  readonly isRetryable: boolean;

  constructor(message: string, status: number | null, isRetryable: boolean) {
    super(message);
    this.name = 'LocationResolutionError';
    this.status = status;
    this.isRetryable = isRetryable;
  }
}

function userMessage(status: number, serverMessage?: string) {
  switch (status) {
    case 400:
      return '현재 위치를 확인할 수 없습니다. ' + '위치 정확도를 높인 뒤 다시 시도해 주세요.';
    case 401:
      return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
    case 404:
      return '현재 위치에 해당하는 행정구역을 찾지 못했습니다.';
    default:
      return serverMessage ?? '현재 위치를 판정하지 못했습니다.';
  }
}

function toRegionSummary(region: RegionBody): RegionSummary {
  return {
    regionId: region.region_id,
    code: region.code,
    name: region.name,
  };
}

export async function resolveLocation(
  coordinates: LocationCoordinates,
  accessToken: string,
  signal: AbortSignal,
): Promise<LocationResolution> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/locations/resolve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        accuracy_meters: coordinates.accuracyMeters,
      }),
      signal,
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') {
      throw caught;
    }
    throw new LocationResolutionError(
      '서버에 연결하지 못했습니다. ' + '연결 상태를 확인하고 다시 시도해 주세요.',
      null,
      true,
    );
  }

  const body = (await response.json().catch(() => null)) as ApiBody<LocationResolutionBody> | null;
  if (!response.ok) {
    throw new LocationResolutionError(
      userMessage(response.status, body?.message),
      response.status,
      response.status >= 500,
    );
  }

  const data = body?.data;
  const sido = data?.region?.sido;
  const sigungu = data?.region?.sigungu;
  if (
    !sido ||
    !sigungu ||
    typeof data?.location_resolution_token !== 'string' ||
    typeof data.expires_in !== 'number'
  ) {
    throw new LocationResolutionError(
      '위치 판정 결과를 확인할 수 없습니다. 다시 시도해 주세요.',
      502,
      true,
    );
  }

  return {
    mapDot: data.map_dot
      ? {
          mapDotId: data.map_dot.map_dot_id,
          code: data.map_dot.code,
        }
      : null,
    region: {
      sido: toRegionSummary(sido),
      sigungu: toRegionSummary(sigungu),
    },
    locationResolutionToken: data.location_resolution_token,
    expiresIn: data.expires_in,
  };
}
