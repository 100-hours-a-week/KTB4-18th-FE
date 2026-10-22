import {
  AuthRequestError,
  authenticatedFetch,
  getCsrfToken,
} from '../../auth-login/api/authSession';
import { invalidateMapDotsCache } from '../../mainMap/mapApi';
import { getHighResolutionArtworkUrl } from '../../../shared/albumArtwork';

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
> & {
  music?: Pick<Music, 'provider' | 'external_music_id'>;
};
export type Page<T> = { items: T[]; next_cursor: string | null; has_next: boolean };

export class MusicApiError extends Error {
  readonly status: number | null;
  readonly requestWasSent: boolean;
  constructor(status: number | null, message: string, requestWasSent = false) {
    super(message);
    this.status = status;
    this.requestWasSent = requestWasSent;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.data == null) {
    throw new MusicApiError(response.status, body?.message ?? '요청을 처리하지 못했습니다.');
  }
  return body.data as T;
}

async function fetchProtectedResponse(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  let response: Response;
  try {
    response = await authenticatedFetch(`${baseUrl}/api/v1${path}`, {
      ...options,
      credentials: 'include',
      headers,
    });
  } catch (caught) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (caught instanceof AuthRequestError) {
      const status = caught.status;
      throw new MusicApiError(
        status,
        status === 401
          ? '로그인이 만료되었습니다. 다시 로그인해 주세요.'
          : '인증을 확인하지 못했습니다. 다시 시도해 주세요.',
        caught.requestWasSent,
      );
    }
    throw new MusicApiError(null, '서버에 연결하지 못했습니다. 다시 시도해 주세요.', true);
  }
  return response;
}

async function fetchProtectedData<T>(path: string, options: RequestInit = {}): Promise<T> {
  return parseResponse<T>(await fetchProtectedResponse(path, options));
}

export const searchMusic = async (query: string, cursor?: string | null) => {
  const params = new URLSearchParams({ query, provider: 'ITUNES', size: '20' });
  if (cursor) params.set('cursor', cursor);
  const page = await fetchProtectedData<Page<Music>>(`/music/search?${params}`);
  return {
    ...page,
    items: page.items.map((music) => ({
      ...music,
      album_cover_url: getHighResolutionArtworkUrl(music.album_cover_url),
    })),
  };
};
export async function registerSelectedMusic(
  externalTrackId: string,
  signal?: AbortSignal,
): Promise<Music & { music_id: number }> {
  let csrf: string;
  try {
    signal?.throwIfAborted();
    csrf = await getCsrfToken(signal);
    signal?.throwIfAborted();
  } catch (caught) {
    if (signal?.aborted) throw signal.reason;
    if (caught instanceof MusicApiError) throw caught;
    throw new MusicApiError(
      caught instanceof AuthRequestError ? caught.status : null,
      '곡을 선택할 수 없습니다. 다시 시도해 주세요.',
      false,
    );
  }
  const data = await fetchProtectedData<{ music?: unknown; created?: unknown }>('/songs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf },
    body: JSON.stringify({ externalTrackId }),
    signal,
  });
  signal?.throwIfAborted();
  const music = data.music;
  if (
    typeof data.created !== 'boolean' ||
    !music ||
    typeof music !== 'object' ||
    !('music_id' in music) ||
    typeof music.music_id !== 'number' ||
    !Number.isSafeInteger(music.music_id) ||
    music.music_id <= 0 ||
    !('provider' in music) ||
    music.provider !== 'ITUNES' ||
    !('external_music_id' in music) ||
    music.external_music_id !== externalTrackId ||
    !('title' in music) ||
    typeof music.title !== 'string' ||
    !('artist_name' in music) ||
    typeof music.artist_name !== 'string' ||
    !('album_cover_url' in music) ||
    (typeof music.album_cover_url !== 'string' && music.album_cover_url !== null) ||
    !('preview_url' in music) ||
    (typeof music.preview_url !== 'string' && music.preview_url !== null) ||
    !('youtube_video_id' in music) ||
    (typeof music.youtube_video_id !== 'string' && music.youtube_video_id !== null) ||
    !('is_queueable' in music) ||
    typeof music.is_queueable !== 'boolean'
  ) {
    throw new MusicApiError(null, '선택한 곡의 정보를 확인하지 못했습니다.', true);
  }
  return {
    music_id: music.music_id,
    provider: music.provider,
    external_music_id: music.external_music_id,
    title: music.title,
    artist_name: music.artist_name,
    album_cover_url: getHighResolutionArtworkUrl(music.album_cover_url),
    preview_url: music.preview_url,
    youtube_video_id: music.youtube_video_id,
    is_queueable: music.is_queueable,
  };
}
export const resolveLocation = (latitude: number, longitude: number, accuracy_meters: number) =>
  fetchProtectedData<Location>('/locations/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude, longitude, accuracy_meters }),
  });
export const createMusicRecord = async (
  music: Music,
  locationResolutionToken: string,
  customPlaceName: string,
  emotionMemo: string,
) => {
  const created = await fetchProtectedData<CreatedRecord>('/music-records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      music: { provider: music.provider, external_music_id: music.external_music_id },
      location_resolution_token: locationResolutionToken,
      custom_place_name: customPlaceName.trim() || null,
      emotion_memo: emotionMemo.trim() || null,
    }),
  });
  invalidateMapDotsCache();
  return created;
};
export const getMusicRecords = (cursor?: string | null) =>
  fetchProtectedData<Page<MusicRecord>>(
    `/users/me/music-records${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );

export async function getAllMusicRecords(): Promise<MusicRecord[]> {
  const records: MusicRecord[] = [];
  let cursor: string | null = null;

  while (true) {
    const page = await getMusicRecords(cursor);
    records.push(...page.items);
    if (!page.has_next) {
      return records;
    }
    if (!page.next_cursor)
      throw new MusicApiError(null, '다음 음악 기록 위치를 확인하지 못했습니다.');
    cursor = page.next_cursor;
  }
}
export const getMusicRecord = (recordId: number) =>
  fetchProtectedData<MusicRecordDetail>(`/music-records/${recordId}`);
export const updateMusicRecord = async (
  recordId: number,
  changes: MusicRecordChanges,
  signal?: AbortSignal,
) => {
  const updated = await fetchProtectedData<{ record_id: number; updated_at: string }>(
    `/music-records/${recordId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
      signal,
    },
  );
  invalidateMapDotsCache();
  return updated;
};

export async function deleteMusicRecord(recordId: number, signal?: AbortSignal): Promise<void> {
  const response = await fetchProtectedResponse(`/music-records/${recordId}`, {
    method: 'DELETE',
    signal,
  });
  if (response.status !== 204) {
    await parseResponse<never>(response);
    throw new MusicApiError(response.status, '음악 기록 삭제 응답을 확인하지 못했습니다.');
  }
  invalidateMapDotsCache();
}

export async function deleteMusicRecords(recordIds: number[], signal?: AbortSignal): Promise<void> {
  const response = await fetchProtectedResponse('/music-records', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ record_ids: recordIds }),
    signal,
  });
  if (response.status !== 204) {
    await parseResponse<never>(response);
    throw new MusicApiError(response.status, '음악 기록 삭제 응답을 확인하지 못했습니다.');
  }
  invalidateMapDotsCache();
}
