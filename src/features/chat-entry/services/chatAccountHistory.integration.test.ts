// @vitest-environment node
import { beforeAll, expect, it, vi } from 'vitest';
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
  '새 인증 세션과 빈 로컬 캐시에서도 서버의 이전 참여 대화 최신200개를 복원한다',
  async () => {
    const states: ChatParticipationState[] = [];
    const target = new ChatParticipation((state) => states.push(state));
    try {
      await target.start();
      await vi.waitFor(() => expect(states.at(-1)?.status).toBe('ready'), { timeout: 15000 });
      const messages = states.at(-1)?.messages ?? [];
      const expected = (process.env.CHAT_HISTORY_EXPECTED_IDS ?? '').split(',').map(Number);
      expect(messages.map((item) => item.messageId)).toEqual(expected);
      expect(messages).toHaveLength(200);
      expect(
        messages.some((item) => item.messageId === Number(process.env.CHAT_HISTORY_ABSENT_ID)),
      ).toBe(false);
      expect(new Set(messages.map((item) => item.messageId)).size).toBe(200);
      expect(states.at(-1)?.restoredThroughMessageId).toBe(expected.at(-1));
    } finally {
      await target.stop();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  },
  25000,
);
