import type { MapDotsData, MapGridDot } from './mapTypes';

interface MapDotsEnvelope {
  message: string;
  data: MapDotsData;
}

interface MapGridResponse {
  zones: MapGridDot[];
}

let cachedMapDots: MapDotsData | null = null;
let cachedEtag: string | null = null;
let mapDotsGeneration = 0;
let cachedMapGrid: MapGridDot[] | null = null;

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }
}

function getApiUrl(path: string) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '';
  return `${baseUrl}${path}`;
}

/** 음악 기록이 저장된 뒤 호출해 지도 도트와 ETag를 함께 폐기한다. */
export function invalidateMapDotsCache() {
  mapDotsGeneration += 1;
  cachedMapDots = null;
  cachedEtag = null;
}

export async function fetchMapDots(signal: AbortSignal): Promise<MapDotsData> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requestGeneration = mapDotsGeneration;
    const headers = new Headers();
    if (attempt === 0 && cachedEtag) {
      headers.set('If-None-Match', cachedEtag);
    }

    const response = await fetch(getApiUrl('/api/v1/map-dots'), {
      headers,
      signal,
    });

    if (requestGeneration !== mapDotsGeneration) {
      throwIfAborted(signal);
      if (cachedMapDots) return cachedMapDots;
      if (attempt === 0) continue;
      throw new Error('Map dots changed while the request was in flight');
    }

    if (response.status === 304) {
      if (cachedMapDots) return cachedMapDots;
      if (attempt === 0) continue;
      throw new Error('Map dots response is not cached');
    }
    if (!response.ok) {
      throw new Error(`Map dots request failed with ${response.status}`);
    }

    const payload = (await response.json()) as MapDotsEnvelope;
    if (requestGeneration !== mapDotsGeneration) {
      throwIfAborted(signal);
      if (cachedMapDots) return cachedMapDots;
      if (attempt === 0) continue;
      throw new Error('Map dots changed while the response was being parsed');
    }
    if (!payload.data || !Array.isArray(payload.data.items)) {
      throw new Error('Map dots response is invalid');
    }

    cachedMapDots = payload.data;
    cachedEtag = response.headers.get('ETag');
    return cachedMapDots;
  }

  throw new Error('Map dots changed while loading');
}

export async function fetchMapGrid(signal: AbortSignal): Promise<MapGridDot[]> {
  if (cachedMapGrid) {
    return cachedMapGrid;
  }

  const response = await fetch(`${import.meta.env.BASE_URL}map-zone-grid.json`, { signal });
  if (!response.ok) {
    throw new Error('Fallback map grid is unavailable');
  }

  const payload = (await response.json()) as MapGridResponse;
  if (!Array.isArray(payload.zones) || payload.zones.length !== 1050) {
    throw new Error('Map grid is invalid');
  }

  cachedMapGrid = payload.zones;
  return cachedMapGrid;
}
