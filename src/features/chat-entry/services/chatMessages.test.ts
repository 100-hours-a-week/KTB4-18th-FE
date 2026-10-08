import { describe, expect, it } from 'vitest';

import { chatBanNotice, parseChatEvent } from './chatMessages';

const message = {
  message_id: 10,
  client_message_id: '550e8400-e29b-41d4-a716-446655440000',
  room_id: 700,
  user_id: 7,
  nickname: '닉네임',
  content: '<script>hello</script>',
  created_at: '2026-10-08T00:00:00Z',
};

describe('채팅 메시지 이벤트 계약', () => {
  it('본문을 그대로 보존하고 서버 이벤트를 타입으로 변환한다', () => {
    const event = parseChatEvent(JSON.stringify({ type: 'CHAT_MESSAGE', data: message }));
    expect(event?.type).toBe('CHAT_MESSAGE');
    if (event?.type === 'CHAT_MESSAGE') {
      expect(event.message.content).toBe('<script>hello</script>');
      expect(event.message.userId).toBe(7);
    }
    expect(
      parseChatEvent(JSON.stringify({ type: 'CHAT_ACK', data: { membership_id: 900, message } })),
    ).toMatchObject({ type: 'CHAT_ACK', membershipId: 900 });
  });

  it.each([
    '{invalid',
    'null',
    JSON.stringify({ type: 'UNKNOWN', data: message }),
    JSON.stringify({ type: 'CHAT_MESSAGE', data: { ...message, user_id: '7' } }),
    JSON.stringify({ type: 'CHAT_MESSAGE', data: { ...message, created_at: 'invalid' } }),
  ])('깨진 이벤트는 무시한다: %s', (body) => {
    expect(parseChatEvent(body)).toBeNull();
  });

  it('제재 종료 시각을 검증하고 로컬 시각으로 안내한다', () => {
    expect(
      parseChatEvent(
        JSON.stringify({
          type: 'CHAT_BANNED',
          data: { room_id: 700, membership_id: 900, banned_until: '2026-10-15T00:00:00Z' },
        }),
      ),
    ).toMatchObject({ type: 'CHAT_BANNED', bannedUntil: '2026-10-15T00:00:00Z' });
    expect(chatBanNotice('2026-10-15T00:00:00Z')).toContain('제한 종료:');
    expect(chatBanNotice('invalid')).toContain('일주일');
  });
});
