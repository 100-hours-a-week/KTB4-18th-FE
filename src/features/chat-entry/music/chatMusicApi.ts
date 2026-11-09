import { AuthRequestError } from '../../auth-login/api/authSession';
import { chatSessionFetch } from '../services/chatSessionFetch';
import {
  musicId,
  musicObject,
  parseMusicQueue,
  parseRequestableMusic,
  type ChatMusicSession,
  type MusicQueuePage,
  type RequestableMusicPage,
} from './chatMusicTypes';

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
export class ChatMusicError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly retryAfter: number;
  readonly isUncertain: boolean;
  constructor(status: number | null, code: string, retryAfter = 0, isUncertain = false) {
    super(musicErrorMessage(status, code));
    this.name = 'ChatMusicError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.isUncertain = isUncertain;
  }
}
export function musicErrorMessage(status: number | null, code: string): string {
  if (code === 'MUSIC_NOT_REQUESTABLE')
    return '지금은 신청할 수 없는 곡이에요. 검색 결과를 다시 확인해 주세요.';
  if (code === 'QUEUE_FULL') return '대기열이 가득 찼어요. 곡이 재생된 뒤 다시 신청해 주세요.';
  if (code === 'VERSION_CONFLICT' || code === 'QUEUE_ITEM_NOT_WAITING')
    return '대기열이 바뀌었어요. 최신 목록을 확인해 주세요.';
  if (code === 'COMMAND_ID_CONFLICT')
    return '요청 정보를 확인하지 못했어요. 대기열을 확인해 주세요.';
  if (code === 'COMMAND_EXPIRED') return '요청 확인 기한이 지났어요. 현재 대기열을 확인해 주세요.';
  if (code === 'CURSOR_EXPIRED' || code === 'QUEUE_CHANGED')
    return '목록이 바뀌었어요. 처음부터 다시 확인해 주세요.';
  if (status === 429) return '요청이 너무 빨라요. 잠시 후 다시 시도해 주세요.';
  if (status === 401 || status === 403) return '현재 이야기방 참여 상태를 확인해 주세요.';
  if (status === 404) return '음악 신청 기능을 이용할 수 없어요.';
  if (status === 503) return '음악 서비스에 잠시 연결할 수 없어요. 잠시 후 다시 확인해 주세요.';
  return '음악 정보를 확인하지 못했어요. 다시 시도해 주세요.';
}
function url(session: ChatMusicSession, path: string, values: Record<string, string> = {}) {
  const query = new URLSearchParams({
    membership_id: String(session.membershipId),
    view_session_id: session.viewSessionId,
    ...values,
  });
  return `${baseUrl}/api/v1/chat-rooms/${session.roomId}/${path}?${query}`;
}
async function request(
  session: ChatMusicSession,
  path: string,
  values: Record<string, string>,
  init: RequestInit,
  mutation = false,
): Promise<unknown> {
  let response: Response;
  try {
    response = await chatSessionFetch(
      url(session, path, values),
      {
        ...init,
        credentials: 'include',
        cache: 'no-store',
      },
      session.ownerToken,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof AuthRequestError)
      throw new ChatMusicError(
        error.status,
        'AUTH_UNAVAILABLE',
        0,
        mutation && error.requestWasSent,
      );
    throw new ChatMusicError(null, 'NETWORK_ERROR', 0, mutation);
  }
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const data = musicObject(body) && musicObject(body.data) ? body.data : null;
    const code = typeof data?.code === 'string' ? data.code : 'REQUEST_FAILED';
    const retry = Number(response.headers.get('Retry-After') ?? 0);
    throw new ChatMusicError(
      response.status,
      code,
      Number.isFinite(retry) ? Math.min(60, Math.max(0, retry)) : 1,
      mutation && (response.status >= 500 || response.status === 401 || response.status === 403),
    );
  }
  return response.status === 204 ? null : musicObject(body) ? body.data : null;
}
export async function searchChatMusic(
  session: ChatMusicSession,
  query: string,
  cursor: string | null,
  signal: AbortSignal,
): Promise<RequestableMusicPage> {
  const data = await request(
    session,
    'requestable-music',
    { query, size: '20', ...(cursor ? { cursor } : {}) },
    { signal },
  );
  const result = parseRequestableMusic(data);
  if (!result) throw new ChatMusicError(502, 'INVALID_RESPONSE');
  return result;
}
export async function fetchMusicQueue(
  session: ChatMusicSession,
  cursor: string | null,
  signal: AbortSignal,
): Promise<MusicQueuePage> {
  const data = await request(
    session,
    'queue-items',
    { size: '20', ...(cursor ? { cursor } : {}) },
    { signal },
  );
  const result = parseMusicQueue(data);
  if (!result) throw new ChatMusicError(502, 'INVALID_RESPONSE');
  return result;
}
export type MusicMutation =
  | { id: string; kind: 'add'; musicId: number; label: string }
  | { id: string; kind: 'cancel'; queueItemId: number; expectedVersion: number; label: string };
export async function mutateMusicQueue(
  session: ChatMusicSession,
  mutation: MusicMutation,
  signal: AbortSignal,
) {
  const headers = { 'Idempotency-Key': mutation.id, 'Content-Type': 'application/json' };
  if (mutation.kind === 'cancel') {
    await request(
      session,
      `queue-items/${mutation.queueItemId}`,
      { expected_version: String(mutation.expectedVersion) },
      { method: 'DELETE', headers, signal },
      true,
    );
    return null;
  }
  const data = await request(
    session,
    'queue-items',
    {},
    {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({ music_id: mutation.musicId }),
    },
    true,
  );
  if (
    !musicObject(data) ||
    !musicId(data.queue_item_id) ||
    data.music_id !== mutation.musicId ||
    !musicId(data.version) ||
    !musicId(data.sequence_no) ||
    typeof data.status !== 'string' ||
    !['WAITING', 'PLAYING', 'CANCELED'].includes(data.status)
  )
    throw new ChatMusicError(502, 'INVALID_RESPONSE', 0, true);
  return data.status as 'WAITING' | 'PLAYING' | 'CANCELED';
}
