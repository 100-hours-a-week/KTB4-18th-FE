import type { LocationRecommendationTrack } from '../locationRecommendationTypes';

const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';

type ItunesTrackResult = {
  trackId?: unknown;
  kind?: unknown;
  trackName?: unknown;
  artistName?: unknown;
  previewUrl?: unknown;
  artworkUrl100?: unknown;
  trackViewUrl?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

type AppleUrlKind = 'preview' | 'artwork' | 'store';

function isAllowedAppleHost(hostname: string, kind: AppleUrlKind): boolean {
  const host = hostname.toLowerCase();
  if (kind === 'store') return host === 'itunes.apple.com' || host === 'music.apple.com';
  if (kind === 'preview') return host === 'itunes.apple.com' || host.endsWith('.itunes.apple.com');
  return host === 'mzstatic.com' || host.endsWith('.mzstatic.com');
}

function normalizeAppleUrl(value: unknown, kind: AppleUrlKind) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !isAllowedAppleHost(url.hostname, kind)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function upscaleArtwork(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!isAllowedAppleHost(url.hostname, 'artwork')) return value;
    url.pathname = url.pathname.replace(/\/\d+x\d+(bb|-?\d+)(\.[^/]+)$/i, '/680x680$1$2');
    return url.toString();
  } catch {
    return value;
  }
}

function parseTrackResults(value: unknown): ItunesTrackResult[] {
  if (!isRecord(value) || !Array.isArray(value.results)) return [];
  return value.results.filter(isRecord) as ItunesTrackResult[];
}

function chooseExactTrack(
  track: LocationRecommendationTrack,
  results: ItunesTrackResult[],
): ItunesTrackResult | null {
  const title = normalizeSearchText(track.title);
  const artist = normalizeSearchText(track.artist);
  const exactIdMatch = results.find(
    (result) => result.kind === 'song' && String(result.trackId ?? '') === track.trackId,
  );
  if (exactIdMatch) return exactIdMatch;

  const exactTitleMatches = results.filter(
    (result) =>
      result.kind === 'song' &&
      typeof result.trackName === 'string' &&
      normalizeSearchText(result.trackName) === title,
  );
  const exactArtistMatches = exactTitleMatches.filter(
    (result) =>
      typeof result.artistName === 'string' && normalizeSearchText(result.artistName) === artist,
  );
  return exactArtistMatches.length === 1 ? exactArtistMatches[0] : null;
}

function withoutRecommendationMedia(
  track: LocationRecommendationTrack,
): LocationRecommendationTrack {
  return { ...track, previewUrl: null, artworkUrl: null, storeUrl: null };
}

export async function resolveItunesTrack(
  track: LocationRecommendationTrack,
  signal: AbortSignal,
): Promise<LocationRecommendationTrack> {
  const noMediaTrack = withoutRecommendationMedia(track);
  const term = `${track.artist} ${track.title}`.trim();
  const url = new URL(ITUNES_SEARCH_URL);
  url.searchParams.set('term', term);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', '8');

  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-store', signal });
    if (!response.ok) return noMediaTrack;
    const result = chooseExactTrack(track, parseTrackResults(await response.json()));
    if (!result) return noMediaTrack;

    return {
      ...track,
      title: typeof result.trackName === 'string' ? result.trackName : track.title,
      artist: typeof result.artistName === 'string' ? result.artistName : track.artist,
      previewUrl: normalizeAppleUrl(result.previewUrl, 'preview'),
      artworkUrl: upscaleArtwork(normalizeAppleUrl(result.artworkUrl100, 'artwork')),
      storeUrl: normalizeAppleUrl(result.trackViewUrl, 'store'),
    };
  } catch {
    return noMediaTrack;
  }
}
