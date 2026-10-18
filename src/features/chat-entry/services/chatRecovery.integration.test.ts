// @vitest-environment node
import { beforeAll, expect, it, vi } from 'vitest';
import { Client } from '@stomp/stompjs';
import { ChatParticipation, type ChatParticipationState } from './chatParticipation';

const bridge = vi.hoisted(() => ({
  url: process.env.CHAT_RECOVERY_INTEGRATION_URL ?? '',
  token: process.env.CHAT_RECOVERY_INTEGRATION_TOKEN ?? '',
  room: Number(process.env.CHAT_RECOVERY_INTEGRATION_ROOM),
  member: Number(process.env.CHAT_RECOVERY_INTEGRATION_MEMBER),
  view: process.env.CHAT_RECOVERY_INTEGRATION_VIEW ?? '',
  hold: false,
  onHeld: undefined as (() => void) | undefined,
  release: undefined as (() => void) | undefined,
}));
vi.mock('../../auth-login/api/authSession', async (original) => ({
  ...(await original<typeof import('../../auth-login/api/authSession')>()),
  getAccessToken: () => bridge.token,
  shouldRefreshAccessToken: () => false,
  authenticatedFetchWithCurrentToken: async (
    url: RequestInfo | URL,
    init: RequestInit,
    token: string,
  ) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  },
  authenticatedFetch: async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${bridge.token}`);
    const response = await fetch(url, { ...init, headers });
    if (bridge.hold) {
      bridge.hold = false;
      await new Promise<void>((resolve) => {
        bridge.release = resolve;
        bridge.onHeld?.();
      });
    }
    return response;
  },
}));
vi.mock('./resolveCurrentChatLocation', () => ({
  resolveCurrentChatLocation: async () => ({
    region: { sigungu: { regionId: 1 } },
    locationResolutionToken: 'unused-test-entry',
  }),
}));
vi.mock('../../../api/chatRooms', async (original) => ({
  ...(await original<typeof import('../../../api/chatRooms')>()),
  getRegionChatRoom: vi.fn(async () => ({
    roomId: bridge.room,
    regionId: 1,
    regionName: '검증 지역',
    capacity: 25,
    status: 'ACTIVE',
  })),
  joinChatRoom: vi.fn(async () => ({
    roomId: bridge.room,
    membershipId: bridge.member,
    regionId: 1,
    joinedAt: new Date().toISOString(),
    viewSessionId: bridge.view,
  })),
  leaveChatRoom: async () => {
    await fetch(
      `${bridge.url}/api/v1/chat-rooms/${bridge.room}/members/me?membership_id=${bridge.member}&view_session_id=${bridge.view}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bridge.token}` },
      },
    );
  },
}));

beforeAll(() => {
  vi.stubEnv('VITE_API_BASE_URL', bridge.url);
  vi.stubGlobal('window', {
    location: { origin: 'http://localhost:5174' },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
});

it.skipIf(!bridge.url)(
  '실제 BE와 FE의 재연결 복구·live 병합·요청 취소 연동',
  async () => {
    const instances: Client[] = [];
    const activate = Client.prototype.activate;
    const spy = vi.spyOn(Client.prototype, 'activate').mockImplementation(function (this: Client) {
      if (!instances.includes(this)) instances.push(this);
      activate.call(this);
    });
    const states: ChatParticipationState[] = [];
    const target = new ChatParticipation((state) => states.push(state));
    let actor: Client | undefined;
    const acks = new Map<string, () => void>();
    const send = async (content: string) => {
      const id = crypto.randomUUID();
      const accepted = new Promise<void>((resolve) => acks.set(id, resolve));
      actor!.publish({
        destination: `/app/chat-rooms/${bridge.room}/messages`,
        body: JSON.stringify({ client_message_id: id, content }),
        headers: { 'content-type': 'application/json' },
      });
      await accepted;
      await new Promise((resolve) => setTimeout(resolve, 1100));
    };
    try {
      await target.start();
      await vi.waitFor(() => expect(states.at(-1)?.status).toBe('ready'), { timeout: 10000 });
      const connected = new Promise<void>((resolve) => {
        actor = new Client({
          brokerURL: bridge.url.replace(/^http/, 'ws') + '/ws',
          connectHeaders: {
            Authorization: `Bearer ${bridge.token}`,
            room_id: String(bridge.room),
            membership_id: String(bridge.member),
          },
          reconnectDelay: 0,
          onConnect: () => {
            let remaining = 2;
            for (const destination of [
              `/topic/chat-rooms/${bridge.room}`,
              '/user/queue/chat-events',
            ]) {
              const receipt = crypto.randomUUID();
              actor!.watchForReceipt(receipt, () => {
                if (--remaining === 0) resolve();
              });
              actor!.subscribe(
                destination,
                (frame) => {
                  const event = JSON.parse(frame.body);
                  if (event.type === 'CHAT_ACK') acks.get(event.data.message.client_message_id)?.();
                },
                { receipt },
              );
            }
          },
        });
        actor.activate();
      });
      await connected;
      await send('연결 중 메시지');
      await vi.waitFor(() => expect(states.at(-1)?.messages?.length).toBe(1));
      bridge.hold = true;
      const held = new Promise<void>((resolve) => {
        bridge.onHeld = resolve;
      });
      instances[0].webSocket?.close();
      // SEND starts before the target's reconnect delay, so the message belongs to its grace interval.
      await send('잠시 단절 중 메시지');
      await held;
      expect(states.at(-1)?.status).toBe('recovering');
      expect(target.send('복구 중 전송 금지')).toBe(false);
      await send('복구 중 실시간 메시지');
      bridge.release?.();
      await vi.waitFor(() => expect(states.at(-1)?.status).toBe('ready'));
      const messages = states.at(-1)?.messages ?? [];
      expect(messages.map((item) => item.content)).toEqual([
        '연결 중 메시지',
        '잠시 단절 중 메시지',
        '복구 중 실시간 메시지',
      ]);
      expect(new Set(messages.map((item) => item.messageId)).size).toBe(3);
      bridge.hold = true;
      const secondHeld = new Promise<void>((resolve) => {
        bridge.onHeld = resolve;
      });
      instances[0].webSocket?.close();
      await secondHeld;
      const previousStates = states.length;
      await target.stop();
      bridge.release?.();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(states.length).toBe(previousStates);
    } finally {
      bridge.release?.();
      await target.stop();
      await actor?.deactivate({ force: true });
      spy.mockRestore();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  },
  30000,
);
