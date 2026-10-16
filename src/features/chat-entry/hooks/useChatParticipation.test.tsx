import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChatParticipation } from './useChatParticipation';
import { ACCESS_TOKEN_CHANGED_EVENT } from '../../auth-login/api/authSession';
const setup = vi.hoisted(() => ({
  accountId: 7,
  sid: '550e8400-e29b-41d4-a716-446655440000',
  stop: vi.fn(),
}));
vi.mock('../../auth-login/api/authSession', () => ({
  ACCESS_TOKEN_CHANGED_EVENT: 'test-token-changed',
  AUTH_EXPIRED_EVENT: 'test-auth-expired',
  getAccessToken: () =>
    `header.${btoa(JSON.stringify({ sub: String(setup.accountId), sid: setup.sid }))}.signature`,
}));
vi.mock('../services/chatParticipation', () => ({
  ChatParticipation: class {
    private publish: (state: unknown) => void;
    constructor(publish: (state: unknown) => void) {
      this.publish = publish;
    }
    async start() {
      this.publish({
        status: 'ready',
        activeRoom: null,
        isReady: true,
        messages: [{ messageId: 1, content: '이전 계정 대화' }],
      });
    }
    stop() {
      return setup.stop();
    }
  },
}));
beforeEach(() => {
  setup.accountId = 7;
  setup.sid = '550e8400-e29b-41d4-a716-446655440000';
  setup.stop.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());
it('같은 계정으로 새 인증 세션이 설치되면 기존 참여를 종료한다', async () => {
  const { result } = renderHook(() => useChatParticipation());
  await act(async () => undefined);
  setup.sid = '550e8400-e29b-41d4-a716-446655440001';
  act(() => window.dispatchEvent(new Event(ACCESS_TOKEN_CHANGED_EVENT)));
  expect(setup.stop).toHaveBeenCalledTimes(1);
  expect(result.current.isReady).toBe(false);
});

it('같은 계정 토큰 갱신은 유지하고 계정 전환 시 대화와 기존 복구 소유자를 제거한다', async () => {
  const { result } = renderHook(() => useChatParticipation());
  await act(async () => undefined);
  expect(result.current.isReady).toBe(true);
  act(() => window.dispatchEvent(new Event(ACCESS_TOKEN_CHANGED_EVENT)));
  expect(setup.stop).not.toHaveBeenCalled();
  setup.accountId = 8;
  act(() => window.dispatchEvent(new Event(ACCESS_TOKEN_CHANGED_EVENT)));
  expect(setup.stop).toHaveBeenCalledTimes(1);
  expect(result.current.status).toBe('left');
  expect(result.current.messages).toBeUndefined();
  expect(result.current.isReady).toBe(false);
});
