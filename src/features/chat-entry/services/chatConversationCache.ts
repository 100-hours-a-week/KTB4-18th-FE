import type { ChatMessage } from './chatMessages';

export const CHAT_CACHE_KEY = 'meomuneum:chat-conversations:v1';
export const CHAT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const CHAT_CACHE_LIMIT = 200;
interface RegionConversation {
  roomId: number;
  messages: ChatMessage[];
}
interface Cache {
  version: 1;
  accountId: number | null;
  regions: Record<string, RegionConversation>;
}
export interface ChatCacheContext {
  accountId: number;
  generation: number;
}
let cache: Cache = { version: 1, accountId: null, regions: {} };
let initialized = false;
let generation = 0;

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export function chatAccountId(token: string | null): number | null {
  try {
    const claims: unknown = JSON.parse(
      atob((token ?? '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    if (!object(claims) || typeof claims.sub !== 'string' || !/^[1-9][0-9]*$/.test(claims.sub))
      return null;
    const id = Number(claims.sub);
    return positive(id) ? id : null;
  } catch {
    return null;
  }
}

// Whitelist server message fields. Drafts, pending originals, tokens and view/cursor IDs never enter storage.
function message(value: unknown, roomId: number): ChatMessage | null {
  if (
    !object(value) ||
    !positive(value.messageId) ||
    value.roomId !== roomId ||
    !positive(value.userId) ||
    typeof value.clientMessageId !== 'string' ||
    typeof value.nickname !== 'string' ||
    typeof value.content !== 'string' ||
    Array.from(value.content).length > 300 ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt))
  )
    return null;
  return {
    messageId: value.messageId,
    roomId,
    userId: value.userId,
    clientMessageId: value.clientMessageId,
    nickname: value.nickname,
    content: value.content,
    createdAt: value.createdAt,
  };
}

export function retainChatMessages(items: readonly ChatMessage[], now = Date.now()): ChatMessage[] {
  const unique = new Map<number, ChatMessage>();
  for (const item of items) {
    const sent = Date.parse(item.createdAt);
    if (Number.isFinite(sent) && sent > now - CHAT_CACHE_TTL_MS && sent <= now)
      unique.set(item.messageId, item);
  }
  return [...unique.values()].sort((a, b) => a.messageId - b.messageId).slice(-CHAT_CACHE_LIMIT);
}

function persist() {
  for (const [region, conversation] of Object.entries(cache.regions)) {
    conversation.messages = retainChatMessages(conversation.messages);
    if (!conversation.messages.length) delete cache.regions[region];
  }
  try {
    window.sessionStorage.setItem(CHAT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Best effort: the current document can keep chatting with its bounded in-memory cache.
    try {
      window.sessionStorage.removeItem(CHAT_CACHE_KEY);
    } catch {
      /* Storage can be unavailable. */
    }
  }
}

function initialize() {
  if (initialized) return;
  initialized = true;
  try {
    const navigation = performance.getEntriesByType?.('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    // sessionStorage may be cloned by an opener or browser duplication. Only a reload/history
    // of this document can restore a persisted cache; a fresh document navigation starts empty.
    if (!navigation || !['reload', 'back_forward'].includes(navigation.type)) {
      window.sessionStorage.removeItem(CHAT_CACHE_KEY);
      return;
    }
    const raw = window.sessionStorage.getItem(CHAT_CACHE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (
      !object(parsed) ||
      parsed.version !== 1 ||
      !positive(parsed.accountId) ||
      !object(parsed.regions)
    )
      throw Error();
    const regions: Cache['regions'] = {};
    for (const [region, value] of Object.entries(parsed.regions)) {
      if (
        !/^[1-9][0-9]*$/.test(region) ||
        !positive(Number(region)) ||
        !object(value) ||
        !positive(value.roomId) ||
        !Array.isArray(value.messages)
      )
        throw Error();
      const roomId = value.roomId;
      const messages = value.messages.map((item: unknown) => message(item, roomId));
      if (messages.some((item) => item === null)) throw Error();
      regions[region] = { roomId, messages: retainChatMessages(messages as ChatMessage[]) };
    }
    cache = { version: 1, accountId: parsed.accountId, regions };
    persist();
  } catch {
    cache = { version: 1, accountId: null, regions: {} };
    try {
      window.sessionStorage.removeItem(CHAT_CACHE_KEY);
    } catch {
      /* Storage can be unavailable. */
    }
  }
}

export function clearChatConversationCache() {
  initialized = true;
  generation += 1;
  cache = { version: 1, accountId: null, regions: {} };
  try {
    window.sessionStorage.removeItem(CHAT_CACHE_KEY);
  } catch {
    /* No restoration in this document. */
  }
}

export function syncChatCacheAccount(accountId: number | null) {
  initialize();
  if (cache.accountId === accountId) return;
  clearChatConversationCache();
  cache.accountId = accountId;
}

export function openChatConversation(accountId: number, regionId: number, roomId: number) {
  syncChatCacheAccount(accountId);
  const stored = cache.regions[String(regionId)];
  const messages = stored?.roomId === roomId ? retainChatMessages(stored.messages) : [];
  if (stored) {
    if (stored.roomId === roomId) stored.messages = messages;
    else delete cache.regions[String(regionId)];
    persist();
  }
  return { context: { accountId, generation }, messages };
}

export function storeChatConversation(
  context: ChatCacheContext,
  regionId: number,
  roomId: number,
  items: readonly ChatMessage[],
) {
  if (context.generation !== generation || context.accountId !== cache.accountId) return;
  const safe = items
    .map((item) => message(item, roomId))
    .filter((item): item is ChatMessage => item !== null);
  cache.regions[String(regionId)] = { roomId, messages: retainChatMessages(safe) };
  persist();
}

// Clear inherited storage on app startup, even if this new tab never opens chat before reloading.
if (typeof window !== 'undefined') initialize();
