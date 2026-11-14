import { getAccessToken, getSharedAuthEpoch } from '../features/auth-login/api/authSession';
import { resolveLocation } from './locationResolutions';

/** Optional, fresh, account-bound location. Permission prompts belong to the existing location flow. */
export async function recommendationLocationToken(
  signal: AbortSignal,
): Promise<string | undefined> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const owner = getAccessToken();
  if (!owner || !navigator.geolocation || !navigator.permissions) return undefined;
  const epoch = getSharedAuthEpoch();
  const request = new AbortController();
  const abort = () => request.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 4000);
  try {
    const permission = await Promise.race([
      navigator.permissions.query({ name: 'geolocation' }),
      new Promise<never>((_, reject) =>
        request.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        ),
      ),
    ]);
    if (permission.state !== 'granted') return undefined;
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      if (request.signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const cancelled = () => reject(new DOMException('Aborted', 'AbortError'));
      request.signal.addEventListener('abort', cancelled, { once: true });
      navigator.geolocation.getCurrentPosition(
        (value) => {
          request.signal.removeEventListener('abort', cancelled);
          resolve(value);
        },
        (error) => {
          request.signal.removeEventListener('abort', cancelled);
          reject(error);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 3000 },
      );
    });
    if (
      !Number.isFinite(position.coords.accuracy) ||
      position.coords.accuracy > 100 ||
      position.coords.accuracy < 0
    )
      return undefined;
    const resolved = await resolveLocation(
      {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
      },
      request.signal,
      owner,
    );
    if (signal.aborted || getSharedAuthEpoch() !== epoch)
      throw new DOMException('Aborted', 'AbortError');
    return resolved.locationResolutionToken;
  } catch {
    if (signal.aborted || getSharedAuthEpoch() !== epoch)
      throw new DOMException('Aborted', 'AbortError');
    return undefined;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
