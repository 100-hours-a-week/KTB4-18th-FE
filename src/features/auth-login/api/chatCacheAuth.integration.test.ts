import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  clearAccessToken,
  resetAuthSessionForTests,
  runAuthTransition,
  setAccessToken,
} from './authSession';
import {
  CHAT_CACHE_KEY,
  clearChatConversationCache,
  openChatConversation,
  storeChatConversation,
} from '../../chat-entry/services/chatConversationCache';
const token = (id: number, exp = Date.now()) =>
  `header.${btoa(JSON.stringify({ sub: String(id), exp }))}.signature`;
const saved = {
  messageId: 1,
  roomId: 700,
  userId: 7,
  clientMessageId: 'saved',
  nickname: '작성자',
  content: 'stored ***',
  createdAt: new Date().toISOString(),
};
beforeEach(() => {
  resetAuthSessionForTests();
  sessionStorage.clear();
  clearChatConversationCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  clearAccessToken();
  resetAuthSessionForTests();
});
function seed() {
  setAccessToken(token(7));
  const context = openChatConversation(7, 25, 700).context;
  storeChatConversation(context, 25, 700, [saved]);
  return context;
}
it('같은 계정 토큰 갱신은 캐시를 유지하고 다른 계정 로그인은 제거한다', () => {
  const context = seed();
  setAccessToken(token(7, Date.now() + 1));
  expect(openChatConversation(7, 25, 700).messages).toEqual([saved]);
  setAccessToken(token(8));
  storeChatConversation(context, 25, 700, [saved]);
  expect(openChatConversation(8, 25, 700).messages).toEqual([]);
});
it('인증 제거와 로그아웃 전환 시작에 캐시를 즉시 제거한다', async () => {
  seed();
  clearAccessToken();
  expect(sessionStorage.getItem(CHAT_CACHE_KEY)).toBeNull();
  const old = seed();
  let finish!: () => void;
  const pending = runAuthTransition(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  expect(sessionStorage.getItem(CHAT_CACHE_KEY)).toBeNull();
  storeChatConversation(old, 25, 700, [saved]);
  expect(sessionStorage.getItem(CHAT_CACHE_KEY)).toBeNull();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  finish();
  await pending;
});
it('캐시 저장 용량 오류가 토큰 변경과 인증 제거를 막지 않는다', () => {
  seed();
  const set = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === CHAT_CACHE_KEY) throw Error('quota');
    return set.call(this, key, value);
  });
  expect(() => setAccessToken(token(8))).not.toThrow();
  expect(() => clearAccessToken()).not.toThrow();
});
