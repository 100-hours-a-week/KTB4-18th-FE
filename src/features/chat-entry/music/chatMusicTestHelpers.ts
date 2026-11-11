import type { ChatMusicSession } from './chatMusicTypes';

export const MUSIC_SID = '550e8400-e29b-41d4-a716-446655440000';
export const MUSIC_VIEW = '550e8400-e29b-41d4-a716-446655440001';
export const musicToken = (sid = MUSIC_SID, revision = 1) =>
  `header.${btoa(JSON.stringify({ sub: '7', sid, jti: revision }))}.signature`;
export function musicSession(): ChatMusicSession {
  return {
    key: `7:${MUSIC_SID}:700:900:${MUSIC_VIEW}`,
    ownerToken: musicToken(),
    roomId: 700,
    membershipId: 900,
    viewSessionId: MUSIC_VIEW,
    generation: 1,
  };
}
export function candidate(id = 1) {
  return {
    music_id: id,
    title: `노래 ${id}`,
    artist_name: `가수 ${id}`,
    album_cover_url: null,
    youtube_video_id: 'abcdefghijk',
    duration_millis: 120000,
    sources: ['RECORDED', 'RECOMMENDED'],
  };
}
export function queueItem(id = 1, status = 'WAITING') {
  return {
    queue_item_id: id,
    music_id: id,
    added_by_user_id: 8,
    sequence_no: id,
    status,
    title: `노래 ${id}`,
    artist_name: `가수 ${id}`,
    album_cover_url: null,
    youtube_video_id: 'abcdefghijk',
  };
}
export function queuePage(
  version = 1,
  items: unknown[] = [queueItem()],
  next: string | null = null,
) {
  return {
    items,
    next_cursor: next,
    version,
    state: 'PLAYING',
    current: queueItem(99, 'PLAYING'),
    position_seconds: 0,
    state_changed_at: '2026-11-09T05:00:00Z',
    server_time: '2026-11-09T05:00:01Z',
  };
}
export function musicEvent(version = 2, type = 'QUEUE_UPDATED', epoch = 1) {
  return {
    type,
    data: {
      room_id: 700,
      epoch,
      version,
      event_id: type === 'PLAYBACK_SYNC' ? null : MUSIC_VIEW,
      event_version: type === 'PLAYBACK_SYNC' ? null : version,
      queue_refresh_required: true,
      playback: queuePage(version),
    },
  };
}
export function musicResponse(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(status === 204 ? null : JSON.stringify({ message: 'synthetic', data }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
export function added(id = 1, status = 'WAITING', version = 2) {
  return { queue_item_id: id, music_id: id, sequence_no: id, status, version };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function videoPage(musicId = 1) {
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  return {
    search_id: '550e8400-e29b-41d4-a716-446655440050',
    music_id: musicId,
    result_kind: 'READY',
    expires_at: expiresAt,
    items: [1, 2].map((index) => ({
      candidate_id: `550e8400-e29b-41d4-a716-44665544005${index}`,
      music_id: musicId,
      video_id: index === 1 ? 'abcdefghijk' : 'ABCDEFGHIJK',
      title: `영상 ${index}`,
      channel_id: 'synthetic-channel',
      channel_title: '영상 채널',
      thumbnail_url: null,
      duration_millis: 120000,
      playback_status: 'PLAYABLE',
      official_status: index === 1 ? 'UNREVIEWED' : 'CONFIRMED',
      expires_at: expiresAt,
    })),
  };
}
