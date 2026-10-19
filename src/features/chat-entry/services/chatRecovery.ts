import { chatSessionFetch } from './chatSessionFetch';
import type { ChatRoomMembership } from '../../../api/chatRooms';
import { authenticatedFetch, AuthRequestError } from '../../auth-login/api/authSession';
import { parseChatMessage, type ChatGap, type ChatMessage } from './chatMessages';

export interface ChatRecoveryPage {
  items: ChatMessage[];
  nextCursor: string | null;
  hasNext: boolean;
  snapshotMessageId: number;
  gaps: ChatGap[];
}

export class ChatRecoveryError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly bannedUntil?: string;
  constructor(status: number | null, code = '', bannedUntil?: string) {
    super('이전 메시지를 복구하지 못했어요. 복구를 다시 시도해 주세요.');
    this.name = 'ChatRecoveryError';
    this.status = status;
    this.code = code;
    this.bannedUntil = bannedUntil;
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

async function fetchChatPage(
  membership: ChatRoomMembership,
  viewId: string,
  cursor: string | null,
  signal: AbortSignal,
  mode: 'history' | 'recovery',
  ownerToken?: string,
): Promise<ChatRecoveryPage> {
  const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  const query = new URLSearchParams({
    membership_id: String(membership.membershipId),
    mode,
    ...(cursor ? { cursor } : {}),
    size: '50',
  });
  let response: Response;
  try {
    const request =
      mode === 'history'
        ? (input: RequestInfo | URL, init: RequestInit) =>
            chatSessionFetch(input, init, ownerToken!)
        : authenticatedFetch;
    response = await request(`${base}/api/v1/chat-rooms/${membership.roomId}/messages?${query}`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'X-Chat-View-Session': viewId },
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ChatRecoveryError(error instanceof AuthRequestError ? error.status : null);
  }
  const body: unknown = await response.json().catch(() => null);
  const data = object(body) && object(body.data) ? body.data : null;
  if (!response.ok) {
    throw new ChatRecoveryError(
      response.status,
      typeof data?.code === 'string' ? data.code : '',
      typeof data?.banned_until === 'string' ? data.banned_until : undefined,
    );
  }
  if (
    !data ||
    !Array.isArray(data.items) ||
    data.items.length > 50 ||
    typeof data.has_next !== 'boolean' ||
    !(
      data.next_cursor === null ||
      (typeof data.next_cursor === 'string' &&
        data.next_cursor.length > 0 &&
        data.next_cursor.length <= 4096)
    ) ||
    data.has_next !== (data.next_cursor !== null) ||
    typeof data.snapshot_message_id !== 'number' ||
    !Number.isSafeInteger(data.snapshot_message_id) ||
    data.snapshot_message_id < 0 ||
    !Array.isArray(data.gaps)
  )
    throw new ChatRecoveryError(502);
  const items = data.items.map(parseChatMessage);
  if (
    items.some(
      (item) =>
        !item ||
        item.roomId !== membership.roomId ||
        item.messageId > (data.snapshot_message_id as number),
    )
  ) {
    throw new ChatRecoveryError(502);
  }
  const gaps: ChatGap[] = data.gaps.map((value: unknown) => {
    if (
      !object(value) ||
      !['ABSENCE', 'RETENTION'].includes(String(value.reason)) ||
      typeof value.before_message_id !== 'number' ||
      !Number.isSafeInteger(value.before_message_id) ||
      value.before_message_id < 0 ||
      typeof value.resumed_at !== 'string' ||
      !Number.isFinite(Date.parse(value.resumed_at))
    )
      throw new ChatRecoveryError(502);
    return {
      reason: value.reason as ChatGap['reason'],
      beforeMessageId: value.before_message_id,
      resumedAt: value.resumed_at,
    };
  });
  return {
    items: items as ChatMessage[],
    nextCursor: data.next_cursor as string | null,
    hasNext: data.has_next,
    snapshotMessageId: data.snapshot_message_id,
    gaps,
  };
}

export function fetchChatRecovery(
  membership: ChatRoomMembership,
  viewId: string,
  cursor: string,
  signal: AbortSignal,
): Promise<ChatRecoveryPage> {
  return fetchChatPage(membership, viewId, cursor, signal, 'recovery');
}

export function fetchChatHistory(
  membership: ChatRoomMembership,
  viewId: string,
  cursor: string | null,
  signal: AbortSignal,
  ownerToken: string,
): Promise<ChatRecoveryPage> {
  return fetchChatPage(membership, viewId, cursor, signal, 'history', ownerToken);
}
