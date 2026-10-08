export interface ChatMessage {
  messageId: number;
  clientMessageId: string;
  roomId: number;
  userId: number;
  nickname: string;
  content: string;
  createdAt: string;
}
export type ChatEvent =
  | { type: 'CHAT_BANNED'; roomId: number; membershipId: number; bannedUntil: string }
  | { type: 'CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'CHAT_ACK'; membershipId: number; message: ChatMessage }
  | {
      type: 'CHAT_REJECTED';
      roomId: number;
      membershipId: number;
      clientMessageId: string;
      reason: string;
      retryAfterMs: number;
    };

const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const string = (value: unknown): value is string => typeof value === 'string';
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function message(value: unknown): ChatMessage | null {
  if (
    !object(value) ||
    !number(value.message_id) ||
    !number(value.room_id) ||
    !number(value.user_id) ||
    !string(value.client_message_id) ||
    !string(value.nickname) ||
    !string(value.content) ||
    !string(value.created_at) ||
    !Number.isFinite(Date.parse(value.created_at))
  )
    return null;
  return {
    messageId: value.message_id,
    clientMessageId: value.client_message_id,
    roomId: value.room_id,
    userId: value.user_id,
    nickname: value.nickname,
    content: value.content,
    createdAt: value.created_at,
  };
}

export function parseChatEvent(body: string): ChatEvent | null {
  try {
    const event: unknown = JSON.parse(body);
    if (!object(event) || !object(event.data)) return null;
    const data = event.data;
    if (
      event.type === 'CHAT_BANNED' &&
      number(data.room_id) &&
      number(data.membership_id) &&
      string(data.banned_until) &&
      Number.isFinite(Date.parse(data.banned_until))
    ) {
      return {
        type: 'CHAT_BANNED',
        roomId: data.room_id,
        membershipId: data.membership_id,
        bannedUntil: data.banned_until,
      };
    }
    if (event.type === 'CHAT_MESSAGE') {
      const parsed = message(data);
      return parsed ? { type: event.type, message: parsed } : null;
    }
    if (event.type === 'CHAT_ACK' && number(data.membership_id)) {
      const parsed = message(data.message);
      return parsed
        ? { type: event.type, membershipId: data.membership_id, message: parsed }
        : null;
    }
    if (
      event.type === 'CHAT_REJECTED' &&
      number(data.room_id) &&
      number(data.membership_id) &&
      string(data.client_message_id) &&
      string(data.reason) &&
      typeof data.retry_after_ms === 'number' &&
      Number.isFinite(data.retry_after_ms) &&
      data.retry_after_ms >= 0
    )
      return {
        type: event.type,
        roomId: data.room_id,
        membershipId: data.membership_id,
        clientMessageId: data.client_message_id,
        reason: data.reason,
        retryAfterMs: data.retry_after_ms,
      };
  } catch {
    // Never log message bodies or server-supplied text.
  }
  return null;
}

export const REJECTION_MESSAGES: Record<string, string> = {
  EMPTY_CONTENT: '메시지를 입력해 주세요.',
  CONTENT_TOO_LONG: '메시지는 300자까지 보낼 수 있어요.',
  INVALID_CONTENT: '올바른 텍스트 메시지를 입력해 주세요.',
  RATE_LIMIT: '메시지는 1초에 한 번 보낼 수 있어요. 잠시 후 다시 보내 주세요.',
  DUPLICATE_CONTENT: '같은 메시지는 두 번까지만 보낼 수 있어요.',
  URL_NOT_ALLOWED: 'URL이 포함된 메시지는 보낼 수 없어요.',
  PERSONAL_INFORMATION: '개인정보가 포함된 메시지는 보낼 수 없어요.',
  CLIENT_ID_CONFLICT: '이 메시지를 재전송할 수 없어요. 새 메시지로 작성해 주세요.',
  RETRY_UNAVAILABLE: '재전송 가능한 시간이 지났어요.',
  NOT_READY: '채팅방 연결이 완료된 후 보내 주세요.',
};

export function chatBanNotice(until?: string) {
  const date = until && Number.isFinite(Date.parse(until)) ? new Date(until) : null;
  return date
    ? `채팅 이용이 제한되었습니다. 제한 종료: ${date.toLocaleString('ko-KR')}`
    : '채팅 이용이 일주일간 제한되어 입장할 수 없습니다.';
}
