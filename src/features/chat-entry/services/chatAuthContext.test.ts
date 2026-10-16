import { describe, expect, it } from 'vitest';
import { chatAuthContext, sameChatAuthContext } from './chatAuthContext';

const sid = '550e8400-e29b-41d4-a716-446655440000';
const token = (sub: unknown, session: unknown) =>
  'header.' + btoa(JSON.stringify({ sub, sid: session })) + '.signature';

describe('채팅 인증 문맥', () => {
  it('동일 계정의 같은 세션은 유지하고 다른 세션과 계정은 구분한다', () => {
    const owner = chatAuthContext(token('7', sid));
    expect(sameChatAuthContext(owner, chatAuthContext(token('7', sid)))).toBe(true);
    expect(sameChatAuthContext(owner, chatAuthContext(token('8', sid)))).toBe(false);
    expect(sameChatAuthContext(owner, chatAuthContext(token('7', sid.replace(/0$/, '1'))))).toBe(
      false,
    );
  });

  it('누락되거나 잘못된 문맥을 새 인증 세션으로 만들지 않는다', () => {
    for (const value of [
      null,
      '',
      'invalid',
      token('7', null),
      token('7', 'device'),
      token(7, sid),
    ]) {
      expect(chatAuthContext(value)).toBeNull();
    }
    expect(sameChatAuthContext(null, null)).toBe(false);
  });
});
