import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@stomp/stompjs';
import { connectChatRoom } from './chatConnection';
import { refreshAccessToken } from '../../auth-login/api/authSession';
import { fetchChatRecovery, ChatRecoveryError, type ChatRecoveryPage } from './chatRecovery';

vi.mock('@stomp/stompjs', () => ({ Client: vi.fn() }));
vi.mock('./chatRecovery', async (original) => ({
  ...(await original<typeof import('./chatRecovery')>()),
  fetchChatRecovery: vi.fn(),
}));
const auth = vi.hoisted(() => ({ token: '', shouldRefresh: false }));
vi.mock('../../auth-login/api/authSession', () => ({
  ACCESS_TOKEN_CHANGED_EVENT: 'test-auth-change',
  getAccessToken: () => auth.token || null,
  shouldRefreshAccessToken: () => auth.shouldRefresh,
  refreshAccessToken: vi.fn(),
}));
const authSid = '550e8400-e29b-41d4-a716-446655440001';
function tokenFor(sid = authSid, userId = '7', nonce = 'first') {
  return 'header.' + btoa(JSON.stringify({ sub: userId, sid })) + '.' + nonce;
}
const membership = {
  membershipId: 900,
  roomId: 700,
  regionId: 25,
  joinedAt: '2026-10-07T00:00:00Z',
  viewSessionId: '550e8400-e29b-41d4-a716-446655440000',
};
const viewId = '550e8400-e29b-41d4-a716-446655440000';
const empty: ChatRecoveryPage = {
  items: [],
  hasNext: false,
  nextCursor: null,
  snapshotMessageId: 0,
  gaps: [],
};
let config: ConstructorParameters<typeof Client>[0];
let receipts: (() => void)[] = [];
const client = {
  connectHeaders: {},
  activate: vi.fn(),
  deactivate: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn(),
  publish: vi.fn(),
  watchForReceipt: vi.fn((_id, callback) => receipts.push(callback)),
};
function readyFrame(snapshot = 0) {
  return {
    body: JSON.stringify({
      type: 'CHAT_READY',
      data: {
        room_id: 700,
        membership_id: 900,
        view_session_id: viewId,
        recovery_cursor: 'signed-cursor',
        snapshot_message_id: snapshot,
      },
    }),
  };
}
function receive() {
  return client.subscribe.mock.calls.at(-2)![1] as (frame: { body: string }) => void;
}
async function ready(snapshot = 0) {
  receipts.slice(-2).forEach((callback) => callback());
  receive()(readyFrame(snapshot));
  await Promise.resolve();
  await Promise.resolve();
}
function message(id: number) {
  return {
    messageId: id,
    clientMessageId: `id-${id}`,
    roomId: 700,
    userId: 7,
    nickname: 'user',
    content: `message-${id}`,
    createdAt: '2026-10-13T00:00:00Z',
  };
}
function live(id: number) {
  const item = message(id);
  return {
    body: JSON.stringify({
      type: 'CHAT_MESSAGE',
      data: {
        message_id: id,
        client_message_id: item.clientMessageId,
        room_id: 700,
        user_id: 7,
        nickname: item.nickname,
        content: item.content,
        created_at: item.createdAt,
      },
    }),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  receipts = [];
  auth.token = tokenFor();
  auth.shouldRefresh = false;
  vi.mocked(fetchChatRecovery).mockReset().mockResolvedValue(empty);
  vi.mocked(Client).mockImplementation(function (options) {
    config = options;
    return client as unknown as Client;
  });
});
afterEach(() => vi.useRealTimers());

describe('구독 완료와 누락 메시지 복구', () => {
  it('같은 인증 세션의 토큰 갱신 후 기존 view로 다시 연결한다', async () => {
    const status = vi.fn();
    const connection = connectChatRoom(membership, status);
    await config?.beforeConnect?.(client as unknown as Client);
    config?.onConnect?.({} as never);
    await ready();
    auth.token = tokenFor(authSid, '7', 'refreshed');
    window.dispatchEvent(new Event('test-auth-change'));
    expect(client.deactivate).not.toHaveBeenCalled();
    await config?.beforeConnect?.(client as unknown as Client);
    expect(client.connectHeaders).toMatchObject({
      Authorization: `Bearer ${auth.token}`,
      auth_session_id: authSid,
      view_session_id: viewId,
    });
    connection();
  });

  it('같은 계정의 세션이 바뀌면 이전 연결과 늦은 메시지를 폐기한다', async () => {
    const status = vi.fn();
    const event = vi.fn();
    const connection = connectChatRoom(membership, status, event);
    config?.onConnect?.({} as never);
    const oldReceive = receive();
    await ready();
    event.mockClear();
    auth.token = tokenFor(viewId);
    window.dispatchEvent(new Event('test-auth-change'));
    oldReceive(live(50));
    expect(event).not.toHaveBeenCalled();
    expect(connection.send('id', 'hello')).toBe(false);
    expect(status).toHaveBeenLastCalledWith('error', expect.stringContaining('로그인 상태가 변경'));
    expect(client.deactivate).toHaveBeenCalledOnce();
    connection();
  });

  it('토큰 갱신 대기 중 세션이 바뀌어도 이전 연결을 활성화하지 않는다', async () => {
    auth.shouldRefresh = true;
    let finish!: (value: string) => void;
    vi.mocked(refreshAccessToken).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const status = vi.fn();
    const connection = connectChatRoom(membership, status);
    const pending = config?.beforeConnect?.(client as unknown as Client);
    auth.token = tokenFor(viewId);
    window.dispatchEvent(new Event('test-auth-change'));
    finish(tokenFor());
    await pending;
    config?.onConnect?.({} as never);
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(connection.send('id', 'hello')).toBe(false);
    connection();
  });

  it('복구 요청 중 인증이 제거되면 늦은 결과를 반영하지 않는다', async () => {
    let finish!: (page: ChatRecoveryPage) => void;
    vi.mocked(fetchChatRecovery).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const event = vi.fn();
    const connection = connectChatRoom(membership, vi.fn(), event);
    config?.onConnect?.({} as never);
    await ready();
    auth.token = '';
    window.dispatchEvent(new Event('test-auth-change'));
    finish({ ...empty, items: [message(1)] });
    await Promise.resolve();
    expect(event).not.toHaveBeenCalled();
    expect(connection.send('id', 'hello')).toBe(false);
    connection();
  });

  it('인증 세션 없는 토큰으로는 연결을 준비하지 않는다', async () => {
    auth.token = 'legacy-token';
    const status = vi.fn();
    const connection = connectChatRoom(membership, status);
    await config?.beforeConnect?.(client as unknown as Client);
    expect(status).toHaveBeenLastCalledWith('error', expect.stringContaining('로그인'));
    expect(client.deactivate).toHaveBeenCalledOnce();
    connection();
  });

  it('CONNECT에 인증을 전달하고 receipt만으로 준비하지 않으며 CHAT_READY 후 복구한다', async () => {
    const status = vi.fn();
    const connection = connectChatRoom(membership, status);
    await config?.beforeConnect?.(client as unknown as Client);
    expect(client.connectHeaders).toEqual({
      Authorization: `Bearer ${auth.token}`,
      auth_session_id: authSid,
      room_id: '700',
      membership_id: '900',
      view_session_id: viewId,
      last_message_id: '0',
    });
    expect(config?.brokerURL).not.toContain('account-token');
    config?.onConnect?.({} as never);
    receipts.forEach((callback) => callback());
    expect(connection.send('id', 'hello')).toBe(false);
    expect(status).not.toHaveBeenCalledWith('ready', expect.any(String));
    receive()(readyFrame());
    expect(status).toHaveBeenLastCalledWith('recovering', expect.any(String));
    await Promise.resolve();
    expect(status).toHaveBeenLastCalledWith('ready', expect.any(String));
    expect(connection.send('id', 'hello')).toBe(true);
    expect(client.publish).toHaveBeenCalledWith(
      expect.objectContaining({ destination: '/app/chat-rooms/700/messages' }),
    );
    connection();
  });

  it('여러 페이지 복구 중 live를 버퍼링하고 고정 snapshot 결과를 완료 후 전달한다', async () => {
    let finish!: (page: ChatRecoveryPage) => void;
    vi.mocked(fetchChatRecovery).mockResolvedValueOnce({
      ...empty,
      items: [message(1)],
      nextCursor: 'next',
      hasNext: true,
      snapshotMessageId: 2,
    });
    vi.mocked(fetchChatRecovery).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const event = vi.fn();
    const connection = connectChatRoom(membership, vi.fn(), event);
    config?.onConnect?.({} as never);
    await ready(2);
    receive()(live(2));
    receive()(live(3));
    expect(event).not.toHaveBeenCalled();
    expect(connection.send('id', 'hello')).toBe(false);
    finish({
      ...empty,
      items: [message(2)],
      snapshotMessageId: 2,
      gaps: [{ reason: 'ABSENCE', beforeMessageId: 1, resumedAt: '2026-10-13T00:00:00Z' }],
    });
    await Promise.resolve();
    expect(
      event.mock.calls
        .filter(([item]) => item.type === 'CHAT_MESSAGE')
        .map(([item]) => item.message.messageId),
    ).toEqual([1, 2, 2, 3]);
    // Participation's message-id map deduplicates the overlap; ACKs must still reach pending state.
    expect(event).toHaveBeenCalledWith(expect.objectContaining({ type: 'CHAT_GAPS' }));
    expect(connection.send('id', 'hello')).toBe(true);
    connection();
  });

  it('30초 이후에도 같은 view로 재접속하며 이전 콜백과 receipt는 무시한다', async () => {
    const event = vi.fn();
    const status = vi.fn();
    const connection = connectChatRoom(membership, status, event);
    config?.onConnect?.({} as never);
    await ready();
    receive()(live(5));
    const old = receive();
    const oldReceipts = [...receipts];
    event.mockClear();
    config?.onWebSocketClose?.({ code: 1006 } as CloseEvent);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(client.deactivate).not.toHaveBeenCalled();
    await config?.beforeConnect?.(client as unknown as Client);
    expect(client.connectHeaders).toEqual(
      expect.objectContaining({ view_session_id: viewId, last_message_id: '5' }),
    );
    config?.onConnect?.({} as never);
    old(live(9));
    oldReceipts.forEach((callback) => callback());
    expect(event).not.toHaveBeenCalled();
    await ready();
    expect(status).toHaveBeenLastCalledWith('ready', expect.any(String));
    connection();
  });

  it('퇴장하면 요청을 취소하고 늦은 복구 결과를 적용하지 않는다', async () => {
    let finish!: (page: ChatRecoveryPage) => void;
    vi.mocked(fetchChatRecovery).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const event = vi.fn();
    const connection = connectChatRoom(membership, vi.fn(), event);
    config?.onConnect?.({} as never);
    await ready(1);
    const signal = vi.mocked(fetchChatRecovery).mock.calls[0][3];
    connection();
    expect(signal.aborted).toBe(true);
    finish({ ...empty, items: [message(1)], snapshotMessageId: 1 });
    await Promise.resolve();
    expect(event).not.toHaveBeenCalled();
  });

  it('부분 복구 실패는 메시지·live를 적용하지 않고 사용자 재시도만 허용한다', async () => {
    vi.mocked(fetchChatRecovery).mockResolvedValueOnce({
      ...empty,
      items: [message(1)],
      nextCursor: 'next',
      hasNext: true,
      snapshotMessageId: 2,
    });
    vi.mocked(fetchChatRecovery).mockRejectedValueOnce(
      new ChatRecoveryError(400, 'CHAT_QUERY_400_INVALID'),
    );
    const status = vi.fn();
    const event = vi.fn();
    const connection = connectChatRoom(membership, status, event);
    config?.onConnect?.({} as never);
    await ready(2);
    await Promise.resolve();
    expect(status).toHaveBeenLastCalledWith('recovery-failed', expect.any(String));
    expect(event).not.toHaveBeenCalled();
    expect(connection.send('id', 'hello')).toBe(false);
    expect(client.deactivate).toHaveBeenCalledOnce();
    connection.retryRecovery();
    expect(client.activate).toHaveBeenCalledTimes(2);
    connection();
  });

  it('다른 방·membership의 CHAT_READY와 일치하지 않는 snapshot을 거부한다', async () => {
    const status = vi.fn();
    const connection = connectChatRoom(membership, status);
    config?.onConnect?.({} as never);
    receipts.forEach((callback) => callback());
    const frame = JSON.parse(readyFrame().body);
    frame.data.membership_id = 901;
    receive()({ body: JSON.stringify(frame) });
    expect(fetchChatRecovery).not.toHaveBeenCalled();
    vi.mocked(fetchChatRecovery).mockResolvedValue({ ...empty, snapshotMessageId: 2 });
    receive()(readyFrame(1));
    await Promise.resolve();
    expect(status).toHaveBeenLastCalledWith('recovery-failed', expect.any(String));
    connection();
  });

  it('제재·전체 퇴장은 자동 재연결을 중단한다', async () => {
    const status = vi.fn();
    const connection = connectChatRoom(membership, status);
    config?.onWebSocketClose?.({
      code: 4101,
      reason: 'CHAT_BANNED|2026-10-15T00:00:00Z',
    } as CloseEvent);
    expect(status).toHaveBeenLastCalledWith('banned', expect.stringContaining('제한 종료:'));
    expect(connection.send('id', 'hello')).toBe(false);
    expect(client.deactivate).toHaveBeenCalledOnce();
  });

  it('최초 연결 실패는 30초 뒤 멈추지만 자동 REST 새 입장을 수행하지 않는다', async () => {
    const status = vi.fn();
    connectChatRoom(membership, status);
    config?.onWebSocketClose?.({ code: 1006 } as CloseEvent);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(status).toHaveBeenLastCalledWith('error', expect.any(String));
    expect(client.deactivate).toHaveBeenCalledOnce();
  });
});
