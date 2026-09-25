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
let cachedMapGrid: MapGridDot[] | null = null;

function getApiUrl(path: string) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '';
  return `${baseUrl}${path}`;
}

export async function fetchMapDots(signal: AbortSignal): Promise<MapDotsData> {
  const headers = new Headers();
  if (cachedEtag) {
    headers.set('If-None-Match', cachedEtag);
  }

  const response = await fetch(getApiUrl('/api/v1/map-dots'), {
    headers,
    signal,
  });

  if (response.status === 304 && cachedMapDots) {
    return cachedMapDots;
  }
  if (!response.ok) {
    throw new Error(`Map dots request failed with ${response.status}`);
  }

  const payload = (await response.json()) as MapDotsEnvelope;
  if (!payload.data || !Array.isArray(payload.data.items)) {
    throw new Error('Map dots response is invalid');
  }

  cachedMapDots = payload.data;
  cachedEtag = response.headers.get('ETag');
  return cachedMapDots;
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
