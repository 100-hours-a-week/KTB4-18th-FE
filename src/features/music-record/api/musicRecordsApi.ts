import {
  AuthRequestError,
  getAccessToken,
  getCsrfToken,
  refreshAccessToken,
} from '../../auth-login/api/authSession';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export type RegionPart = { region_id: number; code: string; name: string };
export type Region = { sido: RegionPart; sigungu: RegionPart };
export type Music = {
  music_id: number | null;
  provider: 'ITUNES';
  external_music_id: string;
  title: string;
  artist_name: string;
  album_cover_url: string | null;
  preview_url: string | null;
  youtube_video_id: string | null;
  is_queueable: boolean;
};
export type RecordMusicSummary = Pick<
  Music,
  'music_id' | 'title' | 'artist_name' | 'album_cover_url'
>;
export type Location = {
  map_dot: { map_dot_id: number; code: string };
  region: Region;
  location_resolution_token: string;
  expires_in: number;
};
export type MusicRecord = {
  record_id: number;
  music: RecordMusicSummary;
  map_dot_id: number;
  region: Region;
  custom_place_name: string | null;
  emotion_memo: string | null;
  created_at: string;
};
export type CreatedRecord = Pick<
  MusicRecord,
  'record_id' | 'map_dot_id' | 'region' | 'custom_place_name' | 'created_at'
>;
export type MusicRecordDetail = MusicRecord & { updated_at: string | null };
export type MusicRecordChanges = Partial<
  Pick<MusicRecordDetail, 'custom_place_name' | 'emotion_memo'>
>;
export type Page<T> = { items: T[]; next_cursor: string | null; has_next: boolean };

export class MusicApiError extends Error {
  readonly status: number | null;
  constructor(status: number | null, message: string) {
    super(message);
    this.status = status;
  }
}

async function fetchData<T>(
  path: string,
  options: RequestInit = {},
  hasRetried = false,
): Promise<T> {
  const headers = new Headers(options.headers);
  const accessToken = getAccessToken();
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) {
    try {
      headers.set('X-CSRF-TOKEN', await getCsrfToken());
    } catch {
      throw new MusicApiError(null, '보안 토큰을 불러오지 못했습니다.');
    }
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1${path}`, {
      ...options,
      credentials: 'include',
      headers,
    });
  } catch {
    throw new MusicApiError(null, '서버에 연결하지 못했습니다. 다시 시도해 주세요.');
  }
  if (response.status === 401 && !hasRetried) {
    try {
      await refreshAccessToken();
    } catch (caught) {
      if (caught instanceof AuthRequestError && caught.status === 401) {
        throw new MusicApiError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
      }
      throw new MusicApiError(null, '인증을 확인하지 못했습니다. 다시 시도해 주세요.');
    }
    return fetchData<T>(path, options, true);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.data == null) {
    throw new MusicApiError(response.status, body?.message ?? '요청을 처리하지 못했습니다.');
  }
  return body.data as T;
}

export const searchMusic = (query: string, cursor?: string | null) => {
  const params = new URLSearchParams({ query, provider: 'ITUNES', size: '20' });
  if (cursor) params.set('cursor', cursor);
  return fetchData<Page<Music>>(`/music/search?${params}`);
};
export const resolveLocation = (latitude: number, longitude: number, accuracy_meters: number) =>
  fetchData<Location>('/locations/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude, longitude, accuracy_meters }),
  });
export const createMusicRecord = (
  music: Music,
  locationResolutionToken: string,
  customPlaceName: string,
  emotionMemo: string,
) =>
  fetchData<CreatedRecord>('/music-records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      music: { provider: music.provider, external_music_id: music.external_music_id },
      location_resolution_token: locationResolutionToken,
      custom_place_name: customPlaceName.trim() || null,
      emotion_memo: emotionMemo.trim() || null,
    }),
  });
export const getMusicRecords = (cursor?: string | null) =>
  fetchData<Page<MusicRecord>>(
    `/users/me/music-records${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
export const getMusicRecord = (recordId: number) =>
  fetchData<MusicRecordDetail>(`/music-records/${recordId}`);
export const updateMusicRecord = (
  recordId: number,
  changes: MusicRecordChanges,
  signal?: AbortSignal,
) =>
  fetchData<{ record_id: number; updated_at: string }>(`/music-records/${recordId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
    signal,
  });
