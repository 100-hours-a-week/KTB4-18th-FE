import { AuthRequestError, authenticatedFetch } from '../../auth-login/api/authSession';
import {
  LOCATION_RECOMMENDATION_FE_TIMEOUT_MS,
  type LocationRecommendationCancellation,
  type LocationRecommendationContext,
  type LocationRecommendationDisplayClaim,
  type LocationRecommendationRegion,
  type LocationRecommendationResult,
  type LocationRecommendationStatus,
  type LocationRecommendationTrack,
} from '../locationRecommendationTypes';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const API_ROOT = `${baseUrl}/api/v1/location-recommendations`;
const CONTEXT_URL = `${baseUrl}/api/v1/location-recommendation-context`;

export class LocationRecommendationApiError extends Error {
  readonly status: number | null;

  constructor(status: number | null) {
    super('Location recommendation request failed');
    this.name = 'LocationRecommendationApiError';
    this.status = status;
  }
}

export class LocationRecommendationTimeoutError extends Error {
  constructor() {
    super('Location recommendation timed out');
    this.name = 'LocationRecommendationTimeoutError';
  }
}

type Envelope<T> = { message: string; data: T | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isAllowedAppleUrl(
  value: unknown,
  allowedHosts: readonly string[],
): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

const PREVIEW_HOSTS = ['itunes.apple.com'] as const;
const ARTWORK_HOSTS = ['mzstatic.com'] as const;
const STORE_HOSTS = ['itunes.apple.com', 'music.apple.com'] as const;

function parseMediaUrl(value: unknown, allowedHosts: readonly string[]): string | null {
  return isAllowedAppleUrl(value, allowedHosts) ? value : null;
}

function parseTrack(value: unknown): LocationRecommendationTrack | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.trackId !== 'string' ||
    !value.trackId.trim() ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    typeof value.artist !== 'string' ||
    !value.artist.trim()
  ) {
    return null;
  }
  return {
    trackId: value.trackId,
    title: value.title,
    artist: value.artist,
    previewUrl: parseMediaUrl(value.previewUrl, PREVIEW_HOSTS),
    artworkUrl: parseMediaUrl(value.artworkUrl, ARTWORK_HOSTS),
    storeUrl: parseMediaUrl(value.storeUrl, STORE_HOSTS),
  };
}

function parseRegion(value: unknown): LocationRecommendationRegion | null {
  if (!isRecord(value)) return null;
  if (
    !Number.isSafeInteger(value.regionId) ||
    typeof value.code !== 'string' ||
    !value.code.trim() ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    typeof value.sidoName !== 'string' ||
    !value.sidoName.trim()
  ) {
    return null;
  }
  return {
    regionId: value.regionId as number,
    code: value.code,
    name: value.name,
    sidoName: value.sidoName,
  };
}

function parseStatus(value: unknown): value is LocationRecommendationStatus {
  return (
    value === 'PROCESSING' ||
    value === 'READY' ||
    value === 'EMPTY' ||
    value === 'FAILED' ||
    value === 'CANCELLED' ||
    value === 'SUPERSEDED' ||
    value === 'EXPIRED'
  );
}

async function requestData<T>(
  url: string,
  options: RequestInit,
  validate: (value: unknown) => value is T,
): Promise<T> {
  let response: Response;
  try {
    response = await authenticatedFetch(url, {
      credentials: 'include',
      cache: 'no-store',
      ...options,
    });
  } catch (caught) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (caught instanceof AuthRequestError) throw new LocationRecommendationApiError(caught.status);
    throw new LocationRecommendationApiError(null);
  }
  const body = (await response.json().catch(() => null)) as Envelope<unknown> | null;
  if (!response.ok || !body || typeof body.message !== 'string' || !validate(body.data)) {
    throw new LocationRecommendationApiError(response.status);
  }
  return body.data;
}

function isContext(value: unknown): value is LocationRecommendationContext {
  return (
    isRecord(value) &&
    isUuid(value.scopeGeneration) &&
    Number.isSafeInteger(value.cancelEpoch) &&
    (value.cancelEpoch as number) >= 0 &&
    typeof value.kstDate === 'string' &&
    (value.activeRequestId === null || isUuid(value.activeRequestId))
  );
}

function parseRecommendation(value: unknown): LocationRecommendationResult | null {
  if (!isRecord(value) || !isUuid(value.requestId) || !parseStatus(value.status)) return null;
  if (
    (value.reason !== null && typeof value.reason !== 'string') ||
    !isUuid(value.scopeGeneration) ||
    !Number.isSafeInteger(value.cancelEpoch) ||
    (value.cancelEpoch as number) < 0
  ) {
    return null;
  }
  const region = parseRegion(value.region);
  if (region === null) return null;
  const tracks = value.tracks;
  if (!Array.isArray(tracks) || tracks.length > 5) return null;
  const parsedTracks = tracks.map(parseTrack);
  if (parsedTracks.some((track) => track === null)) return null;
  if (value.status === 'READY' && (parsedTracks.length < 1 || parsedTracks.length > 5)) return null;
  if (value.status !== 'READY' && parsedTracks.length > 0) return null;
  const remainingTtlMs = value.remainingTtlMs;
  if (!Number.isSafeInteger(remainingTtlMs) || (remainingTtlMs as number) < 0) {
    return null;
  }
  return {
    requestId: value.requestId,
    status: value.status,
    reason: value.reason,
    region,
    tracks: parsedTracks as LocationRecommendationTrack[],
    scopeGeneration: value.scopeGeneration,
    cancelEpoch: value.cancelEpoch as number,
    remainingTtlMs: remainingTtlMs as number,
  };
}

function isRecommendation(value: unknown): value is LocationRecommendationResult {
  return parseRecommendation(value) !== null;
}

async function requestRecommendation(
  url: string,
  options: RequestInit,
): Promise<LocationRecommendationResult> {
  const response = await requestData(url, options, isRecommendation);
  const parsed = parseRecommendation(response);
  if (!parsed) throw new LocationRecommendationApiError(null);
  return parsed;
}

function isDisplayClaim(value: unknown): value is LocationRecommendationDisplayClaim {
  return (
    isRecord(value) &&
    isUuid(value.requestId) &&
    typeof value.displayAllowed === 'boolean' &&
    (value.reason === null || typeof value.reason === 'string')
  );
}

function isCancellation(value: unknown): value is LocationRecommendationCancellation {
  return (
    isRecord(value) &&
    value.status === 'CANCELLED' &&
    isUuid(value.scopeGeneration) &&
    Number.isSafeInteger(value.cancelEpoch) &&
    (value.cancelEpoch as number) >= 0
  );
}

export function getLocationRecommendationContext(signal?: AbortSignal) {
  return requestData(CONTEXT_URL, { method: 'GET', signal }, isContext);
}

export async function createLocationRecommendation(
  input: {
    requestId: string;
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    sampleAgeMs: number;
    trigger: 'SESSION_START' | 'RESUME';
    scopeGeneration: string;
    cancelEpoch: number;
  },
  signal?: AbortSignal,
): Promise<LocationRecommendationResult> {
  const timeoutController = new AbortController();
  const timer = window.setTimeout(
    () => timeoutController.abort(new LocationRecommendationTimeoutError()),
    LOCATION_RECOMMENDATION_FE_TIMEOUT_MS,
  );
  const abortFromCaller = () => timeoutController.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (signal?.aborted) abortFromCaller();
  try {
    const result = await requestRecommendation(API_ROOT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': input.requestId,
      },
      body: JSON.stringify({
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyMeters: input.accuracyMeters,
        sampleAgeMs: input.sampleAgeMs,
        trigger: input.trigger,
        scopeGeneration: input.scopeGeneration,
        cancelEpoch: input.cancelEpoch,
      }),
      signal: timeoutController.signal,
    });
    return result;
  } catch (caught) {
    if (timeoutController.signal.reason instanceof LocationRecommendationTimeoutError) {
      throw timeoutController.signal.reason;
    }
    throw caught;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function getLocationRecommendationStatus(requestId: string, signal?: AbortSignal) {
  return requestRecommendation(`${API_ROOT}/${encodeURIComponent(requestId)}`, {
    method: 'GET',
    signal,
  });
}

export function claimLocationRecommendationDisplay(
  requestId: string,
  context: Pick<LocationRecommendationContext, 'scopeGeneration' | 'cancelEpoch'>,
  claimId: string,
  signal?: AbortSignal,
) {
  return requestData(
    `${API_ROOT}/${encodeURIComponent(requestId)}/display-claims`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': claimId },
      body: JSON.stringify(context),
      signal,
    },
    isDisplayClaim,
  );
}

export function cancelLocationRecommendation(
  input: {
    requestId: string;
    scopeGeneration: string;
    cancelEpoch: number;
    cancellationUUID: string;
  },
  signal?: AbortSignal,
) {
  return requestData(
    `${CONTEXT_URL}/cancellations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': input.cancellationUUID },
      body: JSON.stringify({
        requestId: input.requestId,
        scopeGeneration: input.scopeGeneration,
        cancelEpoch: input.cancelEpoch,
      }),
      signal,
    },
    isCancellation,
  );
}
