import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from './chatMessages';

let cache: typeof import('./chatConversationCache');
const now = Date.parse('2026-10-13T00:00:00Z');
const item = (
  id = 1,
  roomId = 700,
  createdAt = new Date(now - 1000).toISOString(),
): ChatMessage => ({
  messageId: id,
  roomId,
  userId: 7,
  clientMessageId: `stored-${id}`,
  nickname: '작성자',
  content: 'server ***',
  createdAt,
});
const navigation = (type: string) =>
  vi
    .spyOn(performance, 'getEntriesByType')
    .mockReturnValue([{ type } as PerformanceNavigationTiming]);
async function reload(type = 'reload') {
  vi.resetModules();
  navigation(type);
  cache = await import('./chatConversationCache');
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  sessionStorage.clear();
  await reload();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('같은 탭의 이전 대화 캐시', () => {
  it('같은 계정·지역·방의 대화만 새 문서 reload에서 복원한다', async () => {
    const first = cache.openChatConversation(7, 25, 700);
    cache.storeChatConversation(first.context, 25, 700, [item()]);
    cache.storeChatConversation(first.context, 26, 701, [item(2, 701)]);
    await reload();
    expect(cache.openChatConversation(7, 25, 700).messages).toEqual([item()]);
    expect(cache.openChatConversation(7, 26, 701).messages).toEqual([item(2, 701)]);
    expect(cache.openChatConversation(7, 27, 700).messages).toEqual([]);
    expect(cache.openChatConversation(7, 25, 999).messages).toEqual([]);
    expect(cache.openChatConversation(8, 26, 701).messages).toEqual([]);
    expect(cache.openChatConversation(7, 26, 701).messages).toEqual([]);
  });

  it('새 탭으로 복사된 sessionStorage는 fresh navigation에서 폐기한다', async () => {
    const first = cache.openChatConversation(7, 25, 700);
    cache.storeChatConversation(first.context, 25, 700, [item()]);
    expect(sessionStorage.getItem(cache.CHAT_CACHE_KEY)).not.toBeNull();
    await reload('navigate');
    expect(cache.openChatConversation(7, 25, 700).messages).toEqual([]);
  });

  it('전송 시각 기준 정확히24시간에 만료하고 다시 열어도 연장하지 않는다', async () => {
    const first = cache.openChatConversation(7, 25, 700);
    const old = item(1, 700, new Date(now - cache.CHAT_CACHE_TTL_MS + 1).toISOString());
    cache.storeChatConversation(first.context, 25, 700, [old, item(2)]);
    expect(cache.openChatConversation(7, 25, 700).messages).toHaveLength(2);
    vi.setSystemTime(now + 1);
    expect(cache.openChatConversation(7, 25, 700).messages).toEqual([item(2)]);
    await reload();
    expect(cache.openChatConversation(7, 25, 700).messages).toEqual([item(2)]);
  });

  it('저장·복원·병합 모두 서버 ID의 최근200개로 제한하고 중복을 제거한다', async () => {
    const first = cache.openChatConversation(7, 25, 700);
    const all = Array.from({ length: 250 }, (_, index) => item(index + 1));
    cache.storeChatConversation(first.context, 25, 700, [...all.reverse(), item(250)]);
    await reload();
    const messages = cache.openChatConversation(7, 25, 700).messages;
    expect(messages).toHaveLength(200);
    expect(messages[0].messageId).toBe(51);
    expect(messages.at(-1)?.messageId).toBe(250);
    expect(cache.retainChatMessages([...messages, item(251), item(251)])).toHaveLength(200);
  });

  it('로그아웃·계정 변경 뒤 이전 참여의 늦은 저장은 새 캐시를 덮어쓰지 않는다', () => {
    const first = cache.openChatConversation(7, 25, 700);
    cache.storeChatConversation(first.context, 25, 700, [item()]);
    cache.clearChatConversationCache();
    cache.storeChatConversation(first.context, 25, 700, [item(2)]);
    expect(sessionStorage.getItem(cache.CHAT_CACHE_KEY)).toBeNull();
    const second = cache.openChatConversation(8, 25, 700);
    cache.storeChatConversation(second.context, 25, 700, [item(3)]);
    cache.storeChatConversation(first.context, 25, 700, [item(2)]);
    expect(cache.openChatConversation(8, 25, 700).messages).toEqual([item(3)]);
  });

  it('손상·버전 오류·방 불일치·미래 시각을 안전하게 제외한다', async () => {
    sessionStorage.setItem(cache.CHAT_CACHE_KEY, '{broken');
    await reload();
    expect(cache.openChatConversation(7, 25, 700).messages).toEqual([]);
    sessionStorage.setItem(
      cache.CHAT_CACHE_KEY,
      JSON.stringify({
        version: 1,
        accountId: 7,
        regions: { 25: { roomId: 700, messages: [item(1, 701)] } },
      }),
    );
    await reload();
    expect(cache.openChatConversation(7, 25, 700).messages).toEqual([]);
    expect(cache.retainChatMessages([item(1, 700, new Date(now + 1).toISOString())])).toEqual([]);
    sessionStorage.setItem(cache.CHAT_CACHE_KEY, JSON.stringify({ version: 999 }));
    await reload();
    expect(cache.openChatConversation(7, 25, 700).messages).toEqual([]);
  });

  it('용량 초과·저장소 접근 불가에도 현재 문서의 메시지를 유지한다', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('quota');
    });
    const first = cache.openChatConversation(7, 25, 700);
    cache.storeChatConversation(first.context, 25, 700, [item()]);
    expect(cache.openChatConversation(7, 25, 700).messages).toEqual([item()]);
    set.mockRestore();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw Error('blocked');
    });
    expect(() => cache.clearChatConversationCache()).not.toThrow();
    expect(cache.openChatConversation(7, 25, 700).messages).toEqual([]);
  });

  it('필드 목록만 저장하고 토큰·view·초안 등 추가 필드는 버린다', () => {
    const first = cache.openChatConversation(7, 25, 700);
    cache.storeChatConversation(first.context, 25, 700, [
      { ...item(), authorization: 'test-secret', draft: 'unmasked', viewSessionId: 'old-view' },
    ] as unknown as ChatMessage[]);
    const raw = sessionStorage.getItem(cache.CHAT_CACHE_KEY)!;
    expect(raw).toContain('server ***');
    expect(raw).not.toMatch(/test-secret|unmasked|old-view/);
  });
});
