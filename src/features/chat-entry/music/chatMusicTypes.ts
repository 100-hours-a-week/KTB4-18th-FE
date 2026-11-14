export interface ChatMusicSession {
  key: string;
  ownerToken: string;
  roomId: number;
  membershipId: number;
  viewSessionId: string;
  generation: number;
}
export interface RequestableMusic {
  musicId: number;
  title: string;
  artistName: string;
  albumCoverUrl: string | null;
  youtubeVideoId: string | null;
  durationMillis: number | null;
  isQueueable?: boolean;
  sources: ('RECORDED' | 'RECOMMENDED')[];
}
export interface MusicQueueItem {
  queueItemId: number;
  musicId: number;
  addedByUserId: number;
  sequenceNo: number;
  status: 'WAITING' | 'PLAYING';
  title: string;
  artistName: string;
  albumCoverUrl: string | null;
  youtubeVideoId: string | null;
}
export interface MusicPlayback {
  version: number;
  state: 'IDLE' | 'PLAYING' | 'PAUSED';
  current: MusicQueueItem | null;
  positionSeconds: number;
  stateChangedAt: string;
  serverTime: string;
  sourceVideoId: string | null;
  durationMillis: number | null;
}
export interface MusicQueuePage extends MusicPlayback {
  epoch?: number;
  items: MusicQueueItem[];
  nextCursor: string | null;
}
export interface RequestableMusicPage {
  items: RequestableMusic[];
  nextCursor: string | null;
}
type MusicEventKind = 'QUEUE_UPDATED' | 'PLAYBACK_UPDATED' | 'PLAYBACK_SYNC';
export type ChatMusicEvent = {
  [Kind in MusicEventKind]: {
    type: Kind;
    roomId: number;
    epoch: number;
    version: number;
    playback: MusicPlayback;
  };
}[MusicEventKind];

export const musicObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const musicId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const version = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const date = (value: unknown): value is string =>
  typeof value === 'string' && value.endsWith('Z') && Number.isFinite(Date.parse(value));
const nullableText = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && value.length <= 2000);
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const cursor = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && value.length > 0 && value.length <= 4096);

export function parseQueueItem(value: unknown): MusicQueueItem | null {
  if (
    !musicObject(value) ||
    !musicId(value.queue_item_id) ||
    !musicId(value.music_id) ||
    !musicId(value.added_by_user_id) ||
    !musicId(value.sequence_no) ||
    typeof value.status !== 'string' ||
    !['WAITING', 'PLAYING'].includes(value.status) ||
    !text(value.title, 1020) ||
    !text(value.artist_name, 4000) ||
    !nullableText(value.album_cover_url) ||
    !nullableText(value.youtube_video_id) ||
    (value.youtube_video_id !== null && !/^[A-Za-z0-9_-]{11}$/.test(value.youtube_video_id))
  )
    return null;
  return {
    queueItemId: value.queue_item_id,
    musicId: value.music_id,
    addedByUserId: value.added_by_user_id,
    sequenceNo: value.sequence_no,
    status: value.status as MusicQueueItem['status'],
    title: value.title,
    artistName: value.artist_name,
    albumCoverUrl: value.album_cover_url,
    youtubeVideoId: value.youtube_video_id,
  };
}
export function parsePlayback(value: unknown): MusicPlayback | null {
  if (
    !musicObject(value) ||
    !version(value.version) ||
    typeof value.state !== 'string' ||
    !['IDLE', 'PLAYING', 'PAUSED'].includes(value.state) ||
    typeof value.position_seconds !== 'number' ||
    !Number.isFinite(value.position_seconds) ||
    value.position_seconds < 0 ||
    !date(value.state_changed_at) ||
    !date(value.server_time)
  )
    return null;
  const current = value.current === null ? null : parseQueueItem(value.current);
  if (
    value.state === 'IDLE'
      ? value.current !== null || value.position_seconds !== 0
      : !current || current.status !== 'PLAYING'
  )
    return null;
  const source = value.source_video_id ?? null;
  const duration = value.duration_millis ?? null;
  if (
    (source !== null && (typeof source !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(source))) ||
    (duration !== null && (!musicId(duration) || duration > 9999999999)) ||
    (value.current_queue_item_id !== undefined &&
      value.current_queue_item_id !== (current?.queueItemId ?? null)) ||
    (current && source !== null && current.youtubeVideoId !== source) ||
    (value.state === 'IDLE' && (source !== null || duration !== null))
  )
    return null;
  return {
    version: value.version,
    state: value.state as MusicPlayback['state'],
    current,
    positionSeconds: value.position_seconds,
    stateChangedAt: value.state_changed_at,
    serverTime: value.server_time,
    sourceVideoId: source as string | null,
    durationMillis: duration as number | null,
  };
}
export function parseMusicQueue(value: unknown): MusicQueuePage | null {
  const playback = parsePlayback(value);
  if (
    !playback ||
    !musicObject(value) ||
    !Array.isArray(value.items) ||
    value.items.length > 20 ||
    !cursor(value.next_cursor) ||
    (value.epoch !== undefined && !musicId(value.epoch))
  )
    return null;
  const items = value.items.map(parseQueueItem);
  if (
    items.some((item) => !item || item.status !== 'WAITING') ||
    new Set(items.map((item) => item?.queueItemId)).size !== items.length ||
    items.some((item, index) => index > 0 && item!.sequenceNo <= items[index - 1]!.sequenceNo)
  )
    return null;
  return {
    ...playback,
    items: items as MusicQueueItem[],
    nextCursor: value.next_cursor,
    ...(value.epoch !== undefined ? { epoch: value.epoch as number } : {}),
  };
}
export function parseRequestableMusic(value: unknown): RequestableMusicPage | null {
  if (
    !musicObject(value) ||
    !Array.isArray(value.items) ||
    value.items.length > 20 ||
    !cursor(value.next_cursor)
  )
    return null;
  const items: RequestableMusic[] = [];
  for (const item of value.items) {
    if (
      !musicObject(item) ||
      !musicId(item.music_id) ||
      !text(item.title, 1020) ||
      !text(item.artist_name, 4000) ||
      !nullableText(item.album_cover_url) ||
      !nullableText(item.youtube_video_id) ||
      (item.youtube_video_id !== null && !/^[A-Za-z0-9_-]{11}$/.test(item.youtube_video_id)) ||
      (item.duration_millis !== null &&
        (!musicId(item.duration_millis) || item.duration_millis > 9999999999)) ||
      (item.is_queueable !== undefined && typeof item.is_queueable !== 'boolean') ||
      !Array.isArray(item.sources) ||
      item.sources.length < 1 ||
      item.sources.length > 2 ||
      item.sources.some((source) => source !== 'RECORDED' && source !== 'RECOMMENDED') ||
      new Set(item.sources).size !== item.sources.length ||
      items.some((old) => old.musicId === item.music_id)
    )
      return null;
    items.push({
      musicId: item.music_id,
      title: item.title,
      artistName: item.artist_name,
      albumCoverUrl: item.album_cover_url,
      youtubeVideoId: item.youtube_video_id,
      durationMillis: item.duration_millis as number | null,
      ...(typeof item.is_queueable === 'boolean' ? { isQueueable: item.is_queueable } : {}),
      sources: item.sources as RequestableMusic['sources'],
    });
  }
  return { items, nextCursor: value.next_cursor };
}
export function parseMusicEvent(value: unknown): ChatMusicEvent | null {
  if (
    !musicObject(value) ||
    typeof value.type !== 'string' ||
    !['QUEUE_UPDATED', 'PLAYBACK_UPDATED', 'PLAYBACK_SYNC'].includes(value.type) ||
    !musicObject(value.data)
  )
    return null;
  const data = value.data;
  const playback = parsePlayback(data.playback);
  if (
    !playback ||
    !musicId(data.room_id) ||
    !musicId(data.epoch) ||
    !version(data.version) ||
    data.version !== playback.version ||
    data.queue_refresh_required !== true
  )
    return null;
  const isSync = value.type === 'PLAYBACK_SYNC';
  if (
    isSync
      ? data.event_id !== null || data.event_version !== null
      : typeof data.event_id !== 'string' ||
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(data.event_id) ||
        !musicId(data.event_version) ||
        data.event_version > data.version
  )
    return null;
  return {
    type: value.type as ChatMusicEvent['type'],
    roomId: data.room_id,
    epoch: data.epoch,
    version: data.version,
    playback,
  };
}

export interface MusicVideoCandidate {
  candidateId: string;
  musicId: number;
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  durationMillis: number;
  officialStatus: 'UNREVIEWED' | 'CONFIRMED';
  expiresAt: string;
}
export interface MusicVideoPage {
  searchId: string;
  musicId: number;
  resultKind: 'READY' | 'EMPTY';
  expiresAt: string;
  items: MusicVideoCandidate[];
}
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
export function parseMusicVideos(value: unknown): MusicVideoPage | null {
  if (
    !musicObject(value) ||
    !uuid(value.search_id) ||
    !musicId(value.music_id) ||
    !date(value.expires_at) ||
    !['READY', 'EMPTY'].includes(String(value.result_kind)) ||
    !Array.isArray(value.items) ||
    value.items.length > 50 ||
    (value.result_kind === 'EMPTY' ? value.items.length !== 0 : value.items.length === 0)
  )
    return null;
  const items: MusicVideoCandidate[] = [];
  for (const item of value.items) {
    if (
      !musicObject(item) ||
      !uuid(item.candidate_id) ||
      item.music_id !== value.music_id ||
      !text(item.video_id, 11) ||
      !/^[A-Za-z0-9_-]{11}$/.test(item.video_id) ||
      !text(item.title, 1020) ||
      !text(item.channel_id, 64) ||
      !text(item.channel_title, 1020) ||
      !nullableText(item.thumbnail_url) ||
      !musicId(item.duration_millis) ||
      item.duration_millis > 9999999999 ||
      item.playback_status !== 'PLAYABLE' ||
      !['UNREVIEWED', 'CONFIRMED'].includes(String(item.official_status)) ||
      item.expires_at !== value.expires_at ||
      items.some((old) => old.candidateId === item.candidate_id || old.videoId === item.video_id)
    )
      return null;
    items.push({
      candidateId: item.candidate_id,
      musicId: value.music_id,
      videoId: item.video_id,
      title: item.title,
      channelId: item.channel_id,
      channelTitle: item.channel_title,
      thumbnailUrl: item.thumbnail_url,
      durationMillis: item.duration_millis,
      officialStatus: item.official_status as MusicVideoCandidate['officialStatus'],
      expiresAt: item.expires_at,
    });
  }
  return {
    searchId: value.search_id,
    musicId: value.music_id,
    resultKind: value.result_kind as MusicVideoPage['resultKind'],
    expiresAt: value.expires_at,
    items,
  };
}
