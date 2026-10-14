// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client } from '@stomp/stompjs';
import {
  ChatParticipation,
  type ChatParticipationState,
} from '../../src/features/chat-entry/services/chatParticipation';
import { CHAT_CACHE_KEY } from '../../src/features/chat-entry/services/chatConversationCache';

const bridge = vi.hoisted(() => ({
  path: process.env.CHAT_MULTI_CLIENT_CONFIG ?? '',
  config: { url: '', token: '', otherToken: '', room: 0, region: 0 },
  hold: false,
  release: undefined as (() => void) | undefined,
  held: undefined as (() => void) | undefined,
}));
vi.mock('../../src/features/auth-login/api/authSession', async (original) => ({
  ...(await original<typeof import('../../src/features/auth-login/api/authSession')>()),
  getAccessToken: () => bridge.config.token,
  shouldRefreshAccessToken: () => false,
  authenticatedFetch: async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${bridge.config.token}`);
    headers.set('Origin', 'http://localhost:5174');
    const response = await fetch(url, { ...init, headers });
    if (bridge.hold && url.includes('/messages?')) {
      bridge.hold = false;
      await new Promise<void>((resolve) => {
        bridge.release = resolve;
        bridge.held?.();
      });
    }
    return response;
  },
}));
vi.mock('../../src/features/chat-entry/services/resolveCurrentChatLocation', async () => ({
  resolveCurrentChatLocation: async (signal: AbortSignal) => {
    const { resolveLocation } = await import('../../src/api/locationResolutions');
    return resolveLocation(
      { latitude: 37.3595704, longitude: 127.105399, accuracyMeters: 10 },
      signal,
    );
  },
}));
const values = new Map<string, string>();
const actualFetch = globalThis.fetch;
beforeAll(() => {
  if (!bridge.path) return;
  bridge.config = JSON.parse(readFileSync(bridge.path, 'utf8'));
  vi.stubEnv('VITE_API_BASE_URL', bridge.config.url);
  vi.stubGlobal('window', {
    location: { origin: 'http://localhost:5174' },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  vi.stubGlobal('fetch', (url: string | URL | Request, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Origin', 'http://localhost:5174');
    return actualFetch(url, { ...init, headers });
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function raw(method: string, path: string, token: string, body?: unknown) {
  const response = await fetch(bridge.config.url + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  expect(response.ok).toBe(true);
  return response.status === 204 ? null : (await response.json()).data;
}
async function actor(token: string) {
  const resolved = await raw('POST', '/api/v1/locations/resolve', token, {
    latitude: 37.3595704,
    longitude: 127.105399,
    accuracy_meters: 10,
  });
  const membership = await raw('POST', `/api/v1/chat-rooms/${bridge.config.room}/members`, token, {
    location_resolution_token: resolved.location_resolution_token,
  });
  const client = new Client({
    brokerURL: bridge.config.url.replace(/^http/, 'ws') + '/ws',
    reconnectDelay: 0,
    connectHeaders: {
      Authorization: `Bearer ${token}`,
      room_id: String(bridge.config.room),
      membership_id: String(membership.membership_id),
    },
  });
  let closed!: (code: number) => void;
  const closure = new Promise<number>((resolve) => {
    closed = resolve;
  });
  client.onWebSocketClose = (event) => closed(event.code);
  const acks = new Map<string, () => void>();
  await new Promise<void>((resolve) => {
    client.onConnect = () => {
      const receipt = crypto.randomUUID();
      client.watchForReceipt(receipt, resolve);
      client.subscribe(`/topic/chat-rooms/${bridge.config.room}`, () => undefined);
      client.subscribe(
        '/user/queue/chat-events',
        (frame) => {
          const event = JSON.parse(frame.body);
          if (event.type === 'CHAT_ACK') acks.get(event.data.message.client_message_id)?.();
        },
        { receipt },
      );
    };
    client.activate();
  });
  return {
    client,
    closure,
    send: async (content: string) => {
      const id = crypto.randomUUID();
      const accepted = new Promise<void>((resolve) => acks.set(id, resolve));
      client.publish({
        destination: `/app/chat-rooms/${bridge.config.room}/messages`,
        body: JSON.stringify({ client_message_id: id, content }),
      });
      await accepted;
      await new Promise((resolve) => setTimeout(resolve, 1050));
    },
  };
}

it.skipIf(!bridge.path)(
  '실제 REST 입장·누락 복구·전체 퇴장·같은 탭 캐시 재입장과 부재 제외',
  async () => {
    const clients: Client[] = [];
    const activate = Client.prototype.activate;
    const spy = vi.spyOn(Client.prototype, 'activate').mockImplementation(function (this: Client) {
      if (!clients.includes(this)) clients.push(this);
      activate.call(this);
    });
    const states: ChatParticipationState[] = [];
    let target = new ChatParticipation((state) => states.push(state));
    let writer: Awaited<ReturnType<typeof actor>> | undefined;
    let foreign: Awaited<ReturnType<typeof actor>> | undefined;
    try {
      await target.start();
      await vi.waitFor(() => expect(states.at(-1)?.status).toBe('ready'), { timeout: 10000 });
      writer = await actor(bridge.config.token);
      await writer.send('연동 씨발 원문');
      await vi.waitFor(() => expect(states.at(-1)?.messages).toHaveLength(1));
      expect(states.at(-1)?.messages?.[0].content).not.toContain('씨발');
      bridge.hold = true;
      const held = new Promise<void>((resolve) => {
        bridge.held = resolve;
      });
      clients[0].webSocket?.close();
      await writer.send('연동 짧은 단절 메시지');
      await held;
      expect(target.send('복구 중 미전송 원문')).toBe(false);
      await writer.send('연동 복구 중 실시간');
      bridge.release?.();
      await vi.waitFor(() => expect(states.at(-1)?.status).toBe('ready'));
      expect(states.at(-1)?.messages).toHaveLength(3);
      expect(new Set(states.at(-1)?.messages?.map((message) => message.messageId)).size).toBe(3);
      expect(values.get(CHAT_CACHE_KEY)).not.toContain('씨발');
      expect(values.get(CHAT_CACHE_KEY)).not.toContain('미전송 원문');
      await target.stop();
      expect(await writer.closure).toBe(4100);
      foreign = await actor(bridge.config.otherToken);
      await foreign.send('연동 퇴장 부재 메시지');
      target = new ChatParticipation((state) => states.push(state));
      await target.start();
      await vi.waitFor(() => expect(states.at(-1)?.status).toBe('ready'), { timeout: 10000 });
      expect(states.at(-1)?.messages).toHaveLength(3);
      expect(states.at(-1)?.restoredThroughMessageId).toBeGreaterThan(0);
      expect(
        states.at(-1)?.messages?.some((message) => message.content.includes('퇴장 부재')),
      ).toBe(false);
    } finally {
      bridge.release?.();
      await target.stop();
      await writer?.client.deactivate({ force: true });
      await foreign?.client.deactivate({ force: true });
      spy.mockRestore();
    }
  },
  45000,
);
