import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Client } from '@stomp/stompjs';
import { connectChatRoom } from './chatConnection';

vi.mock('@stomp/stompjs', () => ({ Client: vi.fn() }));
vi.mock('../../auth-login/api/authSession', () => ({
  getAccessToken: () => 'account-token',
  shouldRefreshAccessToken: () => false,
  refreshAccessToken: vi.fn(),
}));
const membership = {
  membershipId: 900,
  roomId: 700,
  regionId: 25,
  joinedAt: '2026-10-07T00:00:00Z',
};
let config: ConstructorParameters<typeof Client>[0];
let receipts: (() => void)[] = [];
const client = {
  connectHeaders: {},
  activate: vi.fn(),
  deactivate: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn(),
  publish: vi.fn(),
  watchForReceipt: vi.fn((_id, callback) => {
    receipts.push(callback);
  }),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  receipts = [];
  vi.mocked(Client).mockImplementation(function (options) {
    config = options;
    return client as unknown as Client;
  });
});
afterEach(() => vi.useRealTimers());

describe('채팅 WebSocket 연결', () => {
  it('토큰은 URL 대신 CONNECT 헤더로 전달하고 구독 receipt 이후에만 준비한다', async () => {
    const status = vi.fn();
    const stop = connectChatRoom(membership, status);
    await config?.beforeConnect?.(client as unknown as Client);
    expect(client.connectHeaders).toEqual({
      Authorization: 'Bearer account-token',
      room_id: '700',
      membership_id: '900',
    });
    expect(config?.brokerURL).not.toContain('account-token');
    config?.onConnect?.({} as never);
    expect(client.subscribe).toHaveBeenCalledWith(
      '/topic/chat-rooms/700',
      expect.any(Function),
      expect.objectContaining({ receipt: expect.any(String) }),
    );
    expect(status).not.toHaveBeenCalledWith('ready', expect.any(String));
    receipts[0]();
    expect(status).not.toHaveBeenCalledWith('ready', expect.any(String));
    receipts[1]();
    expect(status).toHaveBeenLastCalledWith('ready', '채팅방에 입장했어요.');
    stop();
  });

  it('두 구독 완료 전에는 전송하지 않고 준비 후 이벤트와 JSON 전송을 연결한다', () => {
    const event = vi.fn();
    const connection = connectChatRoom(membership, vi.fn(), event);
    expect(connection.send('id', 'hello')).toBe(false);
    config?.onConnect?.({} as never);
    receipts[0]();
    expect(connection.send('id', 'hello')).toBe(false);
    receipts[1]();
    expect(connection.send('id', 'hello')).toBe(true);
    expect(client.publish).toHaveBeenCalledWith({
      destination: '/app/chat-rooms/700/messages',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_message_id: 'id', content: 'hello' }),
    });
    client.subscribe.mock.calls[1][1]({ body: '{invalid' });
    expect(event).not.toHaveBeenCalled();
    config?.onWebSocketClose?.({ code: 1006 } as CloseEvent);
    expect(connection.send('id', 'hello')).toBe(false);
    connection();
  });

  it('제재 close가 이벤트보다 먼저 와도 종료 시각을 안내하고 재연결을 중지한다', () => {
    const status = vi.fn();
    const connection = connectChatRoom(membership, status);
    config?.onConnect?.({} as never);
    receipts.forEach((receipt) => receipt());
    config?.onWebSocketClose?.({
      code: 4101,
      reason: 'CHAT_BANNED|2026-10-15T00:00:00Z',
    } as CloseEvent);
    expect(status).toHaveBeenLastCalledWith('banned', expect.stringContaining('제한 종료:'));
    expect(connection.send('id', 'hello')).toBe(false);
    expect(client.deactivate).toHaveBeenCalledOnce();
  });

  it('다른 기기의 실제 퇴장은 재연결 없이 종료한다', async () => {
    const status = vi.fn();
    connectChatRoom(membership, status);
    config?.onWebSocketClose?.({ code: 4100 } as CloseEvent);
    expect(client.deactivate).toHaveBeenCalledWith({ force: true });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(status).toHaveBeenLastCalledWith(
      'left',
      '다른 탭 또는 기기에서 퇴장하여 채팅이 종료됐어요.',
    );
  });

  it('일시 단절은 재연결하지만 30초를 넘으면 멈춘다', async () => {
    const status = vi.fn();
    connectChatRoom(membership, status);
    config?.onWebSocketClose?.({ code: 1006 } as CloseEvent);
    expect(status).toHaveBeenLastCalledWith('reconnecting', expect.any(String));
    expect(client.deactivate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.deactivate).toHaveBeenCalledOnce();
    expect(status).toHaveBeenLastCalledWith('error', expect.any(String));
  });

  it('제재 ERROR를 받으면 자동 재연결을 중지한다', () => {
    const status = vi.fn();
    connectChatRoom(membership, status);
    config?.onStompError?.({ headers: { message: 'CHAT_BANNED' } } as never);
    expect(client.deactivate).toHaveBeenCalledOnce();
    expect(status).toHaveBeenLastCalledWith('banned', expect.any(String));
  });
});
