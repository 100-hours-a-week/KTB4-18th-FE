// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { ChatParticipationState } from './chatParticipation';

const bridge = vi.hoisted(() => ({
  url: process.env.CHAT_TAB_URL ?? '',
  token: process.env.CHAT_TAB_TOKEN ?? '',
  location: process.env.CHAT_TAB_LOCATION ?? '',
  region: Number(process.env.CHAT_TAB_REGION),
  holdJoin: false,
  held: undefined as (() => void) | undefined,
  release: undefined as (() => void) | undefined,
}));
vi.mock('../../auth-login/api/authSession', () => {
  class AuthRequestError extends Error {
    status = null;
    requestWasSent = false;
  }
  const send = async (input: RequestInfo | URL, init: RequestInit, token: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Origin', 'http://localhost:5174');
    const response = await fetch(input, { ...init, headers });
    if (bridge.holdJoin && init.method === 'POST' && String(input).endsWith('/members')) {
      bridge.holdJoin = false;
      await new Promise<void>((resolve) => {
        bridge.release = resolve;
        bridge.held?.();
      });
    }
    return response;
  };
  return {
    AuthRequestError,
    ACCESS_TOKEN_CHANGED_EVENT: 'test-auth-change',
    getAccessToken: () => bridge.token,
    shouldRefreshAccessToken: () => false,
    refreshAccessToken: async () => bridge.token,
    authenticatedFetch: (input: RequestInfo | URL, init: RequestInit) =>
      send(input, init, bridge.token),
    authenticatedFetchWithCurrentToken: (
      input: RequestInfo | URL,
      init: RequestInit,
      token: string,
    ) => send(input, init, token),
  };
});
vi.mock('./resolveCurrentChatLocation', () => ({
  resolveCurrentChatLocation: async () => ({
    region: { sigungu: { regionId: bridge.region } },
    locationResolutionToken: bridge.location,
  }),
}));

it.skipIf(!bridge.url)(
  '실제 FE의 탭 퇴장과 늦은 입장 정리가 같은 sid의 다른 탭에 영향을 주지 않는다',
  async () => {
    vi.stubEnv('VITE_API_BASE_URL', bridge.url);
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:5174' },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    });
    const { ChatParticipation } = await import('./chatParticipation');
    const firstStates: ChatParticipationState[] = [];
    const secondStates: ChatParticipationState[] = [];
    const first = new ChatParticipation((state) => firstStates.push(state));
    const second = new ChatParticipation((state) => secondStates.push(state));
    const late = new ChatParticipation(() => {});
    try {
      await first.start();
      await second.start();
      await vi.waitFor(() => expect(firstStates.at(-1)?.status).toBe('ready'), { timeout: 10000 });
      await vi.waitFor(() => expect(secondStates.at(-1)?.status).toBe('ready'), { timeout: 10000 });
      const a = firstStates.at(-1)!.activeRoom!.membership;
      const b = secondStates.at(-1)!.activeRoom!.membership;
      expect(a.membershipId).toBe(b.membershipId);
      expect(a.viewSessionId).not.toBe(b.viewSessionId);
      await first.stop();
      await first.stop();
      const stoppedCount = firstStates.length;
      expect(second.send('다른 탭 퇴장 후 전송')).toBe(true);
      await vi.waitFor(() =>
        expect(secondStates.at(-1)?.messages?.map((item) => item.content)).toContain(
          '다른 탭 퇴장 후 전송',
        ),
      );
      const ended = await fetch(
        `${bridge.url}/api/v1/chat-rooms/${a.roomId}/messages?membership_id=${a.membershipId}`,
        {
          headers: {
            Authorization: `Bearer ${bridge.token}`,
            'X-Chat-View-Session': a.viewSessionId,
          },
        },
      );
      expect(ended.status).toBe(403);
      bridge.holdJoin = true;
      const held = new Promise<void>((resolve) => {
        bridge.held = resolve;
      });
      const joining = late.start();
      await held;
      await late.stop();
      bridge.release?.();
      await joining;
      expect(secondStates.at(-1)?.status).toBe('ready');
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(second.send('지연된 입장 정리 후 전송')).toBe(true);
      await vi.waitFor(() => expect(secondStates.at(-1)?.messages?.length).toBe(2));
      expect(firstStates.length).toBe(stoppedCount);
    } finally {
      bridge.release?.();
      await late.stop();
      await first.stop();
      await second.stop();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  },
  30000,
);
