import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ChatRoomRequestError,
  getRegionChatRoom,
  joinChatRoom,
  leaveChatRoom,
  leaveChatRoomForRegionChange,
} from '../../../api/chatRooms';
import { connectChatRoom } from './chatConnection';
import { resolveCurrentChatLocation } from './resolveCurrentChatLocation';
import { ChatParticipation, type ChatParticipationState } from './chatParticipation';
import {
  clearChatConversationCache,
  openChatConversation,
  CHAT_CACHE_KEY,
} from './chatConversationCache';

vi.mock('../../../api/chatRooms', async (original) => ({
  ...(await original<typeof import('../../../api/chatRooms')>()),
  getRegionChatRoom: vi.fn(),
  joinChatRoom: vi.fn(),
  leaveChatRoom: vi.fn(),
  leaveChatRoomForRegionChange: vi.fn(),
}));
const auth = vi.hoisted(() => ({ accountId: 7, sid: '550e8400-e29b-41d4-a716-446655440000' }));
vi.mock('../../auth-login/api/authSession', () => ({
  getAccessToken: () =>
    `header.${btoa(JSON.stringify({ sub: String(auth.accountId), sid: auth.sid }))}.signature`,
}));
vi.mock('./chatConnection', () => ({ connectChatRoom: vi.fn() }));
vi.mock('./resolveCurrentChatLocation', () => ({ resolveCurrentChatLocation: vi.fn() }));

const room = {
  roomId: 700,
  regionId: 25,
  regionName: '성남시 분당구',
  capacity: 25,
  status: 'ACTIVE',
};
const membership = {
  membershipId: 900,
  roomId: 700,
  regionId: 25,
  joinedAt: '2026-10-07T00:00:00Z',
  viewSessionId: '11111111-1111-4111-8111-111111111111',
};
const location = {
  mapDot: null,
  region: {
    sido: { regionId: 9, code: '41', name: '경기도' },
    sigungu: { regionId: 25, code: '41135', name: '성남시 분당구' },
  },
  locationResolutionToken: 'location-token',
  expiresIn: 300,
};
const close = vi.fn();
let participation: ChatParticipation;
let states: ChatParticipationState[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
  clearChatConversationCache();
  auth.accountId = 7;
  auth.sid = '550e8400-e29b-41d4-a716-446655440000';
  vi.resetAllMocks();
  states = [];
  participation = new ChatParticipation((state) => states.push(state));
  vi.mocked(resolveCurrentChatLocation).mockResolvedValue(location);
  vi.mocked(getRegionChatRoom).mockResolvedValue(room);
  vi.mocked(joinChatRoom).mockResolvedValue(membership);
  vi.mocked(leaveChatRoom).mockResolvedValue();
  vi.mocked(leaveChatRoomForRegionChange).mockResolvedValue();
  vi.mocked(connectChatRoom).mockImplementation((_membership, status) => {
    status('connecting', '연결 중');
    return Object.assign(close, { send: vi.fn().mockReturnValue(true), retryRecovery: vi.fn() });
  });
});
afterEach(async () => {
  await participation.stop();
  vi.useRealTimers();
});

describe('지역 채팅 메시지 처리', () => {
  it('같은 계정의 세션이 입장 응답 대기 중 변경되면 이전 참여로 연결하지 않는다', async () => {
    let finish!: (value: typeof membership) => void;
    vi.mocked(joinChatRoom).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const starting = participation.start();
    await vi.waitFor(() => expect(joinChatRoom).toHaveBeenCalledOnce());
    auth.sid = '550e8400-e29b-41d4-a716-446655440001';
    finish(membership);
    await starting;
    expect(connectChatRoom).not.toHaveBeenCalled();
    expect(leaveChatRoom).toHaveBeenCalledWith(membership, expect.any(String));
    expect(states.at(-1)?.isReady).toBe(false);
  });

  const saved = {
    messageId: 10,
    clientMessageId: '',
    roomId: 700,
    userId: 7,
    nickname: '작성자',
    content: 'hello',
    createdAt: '2026-10-08T00:00:00Z',
  };
  async function ready() {
    await participation.start();
    const [, status, event] = vi.mocked(connectChatRoom).mock.calls.at(-1)!;
    status('ready', '준비 완료');
    return { status, event: event! };
  }

  it('탭 이동 후 같은 방 새 참여에서 본 메시지만 복원하고 새 복구 문맥에 섞지 않는다', async () => {
    const first = await ready();
    first.event({ type: 'CHAT_MESSAGE', message: saved });
    participation.send('미전송 원문');
    await participation.stop();
    participation = new ChatParticipation((state) => states.push(state));
    vi.mocked(joinChatRoom).mockResolvedValue({ ...membership, membershipId: 901 });
    await participation.start();
    expect(states.at(-1)?.messages).toEqual([saved]);
    expect(states.at(-1)?.restoredThroughMessageId).toBe(10);
    expect(states.at(-1)?.pendingMessages).toEqual([]);
    expect(vi.mocked(connectChatRoom).mock.calls.at(-1)![0].membershipId).toBe(901);
    const event = vi.mocked(connectChatRoom).mock.calls.at(-1)![2]!;
    first.event({
      type: 'CHAT_MESSAGE',
      message: { ...saved, messageId: 11, content: '퇴장 중 메시지' },
    });
    event({ type: 'CHAT_MESSAGE', message: saved });
    event({
      type: 'CHAT_MESSAGE',
      message: { ...saved, messageId: 12, content: '새 참여 메시지' },
    });
    expect(states.at(-1)?.messages?.map((item) => item.messageId)).toEqual([10, 12]);
    expect(sessionStorage.getItem(CHAT_CACHE_KEY)).not.toContain('미전송 원문');
    expect(sessionStorage.getItem(CHAT_CACHE_KEY)).not.toContain('퇴장 중 메시지');
  });

  it('이전 대화는 실제 전송 시각의24시간 경계에 화면과 캐시에서 제거된다', async () => {
    const { event } = await ready();
    event({
      type: 'CHAT_MESSAGE',
      message: {
        ...saved,
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000 + 1).toISOString(),
      },
    });
    expect(states.at(-1)?.messages).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(states.at(-1)?.messages).toEqual([]);
    expect(openChatConversation(7, 25, 700).messages).toEqual([]);
  });

  it('현재 live·복구 목록도 최근200개만 유지한다', async () => {
    const { event } = await ready();
    for (let id = 1; id <= 205; id++)
      event({ type: 'CHAT_MESSAGE', message: { ...saved, messageId: id } });
    expect(states.at(-1)?.messages).toHaveLength(200);
    expect(states.at(-1)?.messages?.[0].messageId).toBe(6);
    expect(openChatConversation(7, 25, 700).messages).toHaveLength(200);
  });

  it('계정 전환 중 늦게 완료된 이전 입장은 원래 계정 토큰으로 정리하고 복원하지 않는다', async () => {
    let complete!: (value: typeof membership) => void;
    vi.mocked(joinChatRoom).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const starting = participation.start();
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    auth.accountId = 8;
    complete(membership);
    await starting;
    expect(connectChatRoom).not.toHaveBeenCalled();
    expect(leaveChatRoom).toHaveBeenCalledWith(
      membership,
      `header.${btoa(JSON.stringify({ sub: '7', sid: '550e8400-e29b-41d4-a716-446655440000' }))}.signature`,
    );
    expect(states.at(-1)?.messages).toEqual([]);
  });

  it('준비, trim, Unicode 길이를 검사하고 전송마다 UUID를 생성한다', async () => {
    await participation.start();
    expect(participation.send('hello')).toBe(false);
    const status = vi.mocked(connectChatRoom).mock.calls.at(-1)![1];
    status('ready', '준비 완료');
    expect(participation.send('  ')).toBe(false);
    expect(participation.send('😀'.repeat(301))).toBe(false);
    expect(participation.send(' hello ')).toBe(true);
    const pending = states.at(-1)?.pendingMessages?.[0];
    expect(pending?.content).toBe('hello');
    expect(pending?.clientMessageId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each(['ack-first', 'broadcast-first'])(
    'ACK와 broadcast 순서가 %s여도 메시지는 한 번 표시된다',
    async (order) => {
      const { event } = await ready();
      participation.send('hello');
      const clientMessageId = states.at(-1)!.pendingMessages![0].clientMessageId;
      const message = { ...saved, clientMessageId };
      const ack = { type: 'CHAT_ACK' as const, membershipId: 900, message };
      const broadcast = { type: 'CHAT_MESSAGE' as const, message };
      event(order === 'ack-first' ? ack : broadcast);
      event(order === 'ack-first' ? broadcast : ack);
      event(broadcast);
      expect(states.at(-1)?.messages).toEqual([message]);
      expect(states.at(-1)?.pendingMessages).toEqual([]);
    },
  );

  it.each(['ack-first', 'broadcast-first'])(
    '마스킹 ACK가 %s여도 원문 대기를 제거하고 서버 본문만 표시한다',
    async (order) => {
      const { event } = await ready();
      participation.send('씨발');
      const clientMessageId = states.at(-1)!.pendingMessages![0].clientMessageId;
      const message = { ...saved, clientMessageId, content: '**' };
      const ack = { type: 'CHAT_ACK' as const, membershipId: 900, message };
      const broadcast = { type: 'CHAT_MESSAGE' as const, message };
      event(order === 'ack-first' ? ack : broadcast);
      event(order === 'ack-first' ? broadcast : ack);
      event(broadcast);
      expect(states.at(-1)?.messages).toEqual([message]);
      expect(states.at(-1)?.pendingMessages).toEqual([]);
    },
  );

  it('다른 방·참여·계정 또는 다른 UUID의 ACK로 내 전송을 완료하지 않는다', async () => {
    const { event } = await ready();
    participation.send('씨발');
    const clientMessageId = states.at(-1)!.pendingMessages![0].clientMessageId;
    const message = { ...saved, clientMessageId, content: '**' };
    event({ type: 'CHAT_ACK', membershipId: 901, message });
    event({ type: 'CHAT_ACK', membershipId: 900, message: { ...message, roomId: 701 } });
    event({ type: 'CHAT_ACK', membershipId: 900, message: { ...message, userId: 8 } });
    expect(states.at(-1)?.messages).toEqual([]);
    event({
      type: 'CHAT_ACK',
      membershipId: 900,
      message: { ...message, clientMessageId: 'other' },
    });
    expect(states.at(-1)?.pendingMessages?.[0].content).toBe('씨발');
    event({ type: 'CHAT_ACK', membershipId: 900, message });
    expect(states.at(-1)?.pendingMessages).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(states.at(-1)?.pendingMessages).toEqual([]);
  });

  it('ACK 미확인 재시도는 같은 UUID와 본문을 사용하고 차단된 메시지는 재시도하지 않는다', async () => {
    const { event } = await ready();
    participation.send('hello');
    const id = states.at(-1)!.pendingMessages![0].clientMessageId;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(participation.retryMessage(id)).toBe(true);
    const connection = vi.mocked(connectChatRoom).mock.results[0].value;
    expect(connection.send.mock.calls).toEqual([
      [id, 'hello'],
      [id, 'hello'],
    ]);
    event({
      type: 'CHAT_REJECTED',
      roomId: 700,
      membershipId: 900,
      clientMessageId: id,
      reason: 'PERSONAL_INFORMATION',
      retryAfterMs: 0,
    });
    expect(states.at(-1)?.sendNotice).toContain('개인정보');
    expect(participation.retryMessage(id)).toBe(false);
  });

  it('누락된 ACK의 저장 메시지 복구로 원문 대기를 정리하고 ID 중복을 제거한다', async () => {
    const { event, status } = await ready();
    participation.send('씨발');
    const clientMessageId = states.at(-1)!.pendingMessages![0].clientMessageId;
    status('reconnecting', '단절');
    status('recovering', '복구');
    expect(participation.send('아직 전송 불가')).toBe(false);
    const message = { ...saved, clientMessageId, content: '**' };
    event({ type: 'CHAT_MESSAGE', message });
    event({ type: 'CHAT_MESSAGE', message });
    event({
      type: 'CHAT_GAPS',
      gaps: [{ reason: 'ABSENCE', beforeMessageId: 9, resumedAt: saved.createdAt }],
    });
    event({
      type: 'CHAT_GAPS',
      gaps: [{ reason: 'ABSENCE', beforeMessageId: 9, resumedAt: saved.createdAt }],
    });
    status('ready', '완료');
    expect(states.at(-1)?.messages).toEqual([message]);
    expect(states.at(-1)?.pendingMessages).toEqual([]);
    expect(states.at(-1)?.gaps).toHaveLength(1);
  });

  it('퇴장 후 지연된 메시지를 무시하고 메시지와 전송 상태를 비운다', async () => {
    const { event, status } = await ready();
    event({ type: 'CHAT_MESSAGE', message: saved });
    participation.send('pending');
    status('left', '퇴장');
    event({ type: 'CHAT_MESSAGE', message: { ...saved, messageId: 11 } });
    expect(states.at(-1)?.messages).toEqual([]);
    expect(states.at(-1)?.pendingMessages).toEqual([]);
  });
});

describe('접속 인원 동기화', () => {
  it('전체 인원과 버전을 반영하고 이전 버전·다른 방을 무시한다', async () => {
    await participation.start();
    const [, status, event] = vi.mocked(connectChatRoom).mock.calls.at(-1)!;
    status('ready', '입장');
    expect(states.at(-1)?.currentUserId).toBe(7);
    expect(states.at(-1)?.connectedCount).toBeNull();
    event!({ type: 'CHAT_PRESENCE', roomId: 700, connectedCount: 2, version: 5 });
    event!({ type: 'CHAT_PRESENCE', roomId: 700, connectedCount: 1, version: 4 });
    event!({ type: 'CHAT_PRESENCE', roomId: 701, connectedCount: 10, version: 100 });
    expect(states.at(-1)?.connectedCount).toBe(2);
    status('reconnecting', '단절');
    expect(states.at(-1)?.connectedCount).toBeNull();
    expect(states.at(-1)?.presenceStatus).toBe('disconnected');
    status('connecting', '연결');
    status('ready', '입장');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(states.at(-1)?.presenceStatus).toBe('error');
    event!({ type: 'CHAT_PRESENCE', roomId: 700, connectedCount: 1, version: 1 });
    expect(states.at(-1)?.connectedCount).toBe(1);
    expect(states.at(-1)?.presenceStatus).toBe('live');
    status('left', '퇴장');
    expect(states.at(-1)?.connectedCount).toBeNull();
  });
});

describe('지역 채팅 참여 흐름', () => {
  it('위치, 방 조회, 입장을 순서대로 진행하고 구독 확인 전 준비 상태가 되지 않는다', async () => {
    await participation.start();
    expect(joinChatRoom).toHaveBeenCalledWith(
      700,
      'location-token',
      expect.any(AbortSignal),
      expect.any(String),
    );
    expect(states.at(-1)?.isReady).toBe(false);
    const onStatus = vi.mocked(connectChatRoom).mock.calls[0][1];
    onStatus('ready', '입장 완료');
    expect(states.at(-1)?.isReady).toBe(true);
    const stopped = participation.stop();
    expect(close).toHaveBeenCalledOnce();
    await stopped;
    expect(leaveChatRoom).toHaveBeenCalledWith(
      membership,
      `header.${btoa(JSON.stringify({ sub: '7', sid: '550e8400-e29b-41d4-a716-446655440000' }))}.signature`,
    );
  });

  it('화면을 나간 후 늦게 도착한 입장 성공은 퇴장 처리하고 연결하지 않는다', async () => {
    let complete!: (value: typeof membership) => void;
    vi.mocked(joinChatRoom).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const start = participation.start();
    await vi.waitFor(() => expect(joinChatRoom).toHaveBeenCalledOnce());
    await participation.stop();
    complete(membership);
    await start;
    expect(connectChatRoom).not.toHaveBeenCalled();
    expect(leaveChatRoom).toHaveBeenCalledWith(
      membership,
      `header.${btoa(JSON.stringify({ sub: '7', sid: '550e8400-e29b-41d4-a716-446655440000' }))}.signature`,
    );
  });

  it('새 화면 입장은 이전 화면의 늦은 입장과 퇴장 완료를 기다린다', async () => {
    let complete!: (value: typeof membership) => void;
    vi.mocked(joinChatRoom).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const first = participation.start();
    await vi.waitFor(() => expect(joinChatRoom).toHaveBeenCalledOnce());
    await participation.stop();
    const next = new ChatParticipation(() => {});
    const second = next.start();
    await Promise.resolve();
    expect(joinChatRoom).toHaveBeenCalledOnce();
    complete(membership);
    await first;
    await second;
    expect(vi.mocked(leaveChatRoom).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(joinChatRoom).mock.invocationCallOrder[1],
    );
    await next.stop();
  });

  it('같은 참여 ID의 두 탭 중 하나만 중복 없이 퇴장하고 남은 탭은 전송한다', async () => {
    const otherView = { ...membership, viewSessionId: '22222222-2222-4222-8222-222222222222' };
    const secondStates: ChatParticipationState[] = [];
    const second = new ChatParticipation((state) => secondStates.push(state));
    vi.mocked(joinChatRoom).mockResolvedValueOnce(membership).mockResolvedValueOnce(otherView);
    const firstClose = Object.assign(vi.fn(), {
      send: vi.fn().mockReturnValue(true),
      retryRecovery: vi.fn(),
    });
    const secondClose = Object.assign(vi.fn(), {
      send: vi.fn().mockReturnValue(true),
      retryRecovery: vi.fn(),
    });
    vi.mocked(connectChatRoom).mockReturnValueOnce(firstClose).mockReturnValueOnce(secondClose);
    try {
      await participation.start();
      await second.start();
      vi.mocked(connectChatRoom).mock.calls[1][1]('ready', '입장');
      await participation.stop();
      await participation.stop();
      expect(leaveChatRoom).toHaveBeenCalledExactlyOnceWith(membership, expect.any(String));
      expect(firstClose).toHaveBeenCalledOnce();
      expect(secondClose).not.toHaveBeenCalled();
      expect(second.send('남은 탭 메시지')).toBe(true);
      expect(secondClose.send).toHaveBeenCalledOnce();
      expect(secondStates.at(-1)?.activeRoom?.membership.viewSessionId).toBe(
        otherView.viewSessionId,
      );
      expect(leaveChatRoomForRegionChange).not.toHaveBeenCalled();
    } finally {
      await second.stop();
    }
    expect(leaveChatRoom).toHaveBeenLastCalledWith(otherView, expect.any(String));
  });

  it('다른 기기 퇴장 알림 뒤에는 자동 재입장하지 않는다', async () => {
    await participation.start();
    vi.mocked(connectChatRoom).mock.calls[0][1]('left', '다른 기기에서 퇴장');
    await vi.advanceTimersByTimeAsync(20 * 60 * 1_000);
    expect(joinChatRoom).toHaveBeenCalledOnce();
    expect(states.at(-1)?.status).toBe('left');
    expect(states.at(-1)?.isReady).toBe(false);
  });

  it('15초 재확인으로 이동이 확정되면 새 방 조회 실패 때에도 기존 방을 퇴장한다', async () => {
    await participation.start();
    vi.mocked(resolveCurrentChatLocation).mockResolvedValue({
      ...location,
      region: { ...location.region, sigungu: { regionId: 30, code: '11680', name: '강남구' } },
    });
    vi.mocked(getRegionChatRoom).mockRejectedValue(
      new ChatRoomRequestError('방을 찾지 못했습니다.', 404),
    );
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000 + 15_000);
    expect(close).toHaveBeenCalledOnce();
    expect(leaveChatRoomForRegionChange).toHaveBeenCalledWith(
      membership,
      'location-token',
      `header.${btoa(JSON.stringify({ sub: '7', sid: '550e8400-e29b-41d4-a716-446655440000' }))}.signature`,
    );
    expect(states.at(-1)?.status).toBe('error');
    expect(states.at(-1)?.activeRoom).toBeNull();
  });

  it('위치 확인 실패와 행정구역 경계의 서로 다른 재확인 결과는 기존 방을 유지한다', async () => {
    await participation.start();
    vi.mocked(resolveCurrentChatLocation).mockRejectedValueOnce(new Error('위치 권한 거부'));
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
    expect(leaveChatRoom).not.toHaveBeenCalled();
    vi.mocked(resolveCurrentChatLocation).mockResolvedValueOnce({
      ...location,
      region: { ...location.region, sigungu: { regionId: 30, code: '11680', name: '강남구' } },
    });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000 + 15_000);
    expect(leaveChatRoom).not.toHaveBeenCalled();
  });
  it('이동 후보 판정 중 sid가 바뀌면 현재나 새 세션을 퇴장시키지 않는다', async () => {
    await participation.start();
    vi.mocked(resolveCurrentChatLocation).mockImplementationOnce(async () => {
      auth.sid = '550e8400-e29b-41d4-a716-446655440001';
      return {
        ...location,
        region: { ...location.region, sigungu: { regionId: 30, code: '11680', name: '강남구' } },
      };
    });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000 + 15_000);
    expect(joinChatRoom).toHaveBeenCalledOnce();
    expect(leaveChatRoom).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('15초 확인 대기 중 sid가 바뀌면 두 번째 GPS 판정을 요청하지 않는다', async () => {
    await participation.start();
    vi.mocked(resolveCurrentChatLocation).mockResolvedValue({
      ...location,
      region: { ...location.region, sigungu: { regionId: 30, code: '11680', name: '강남구' } },
    });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
    auth.sid = '550e8400-e29b-41d4-a716-446655440001';
    await vi.advanceTimersByTimeAsync(15_000);
    expect(resolveCurrentChatLocation).toHaveBeenCalledTimes(2);
    expect(leaveChatRoom).not.toHaveBeenCalled();
    expect(joinChatRoom).toHaveBeenCalledOnce();
  });

  it('최종 위치 판정 뒤 sid가 바뀌면 이전 참여를 종료하지 않는다', async () => {
    await participation.start();
    const moved = {
      ...location,
      region: { ...location.region, sigungu: { regionId: 30, code: '11680', name: '강남구' } },
    };
    vi.mocked(resolveCurrentChatLocation)
      .mockResolvedValueOnce(moved)
      .mockImplementationOnce(async () => {
        auth.sid = '550e8400-e29b-41d4-a716-446655440001';
        return moved;
      });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000 + 15_000);
    expect(leaveChatRoom).not.toHaveBeenCalled();
    expect(joinChatRoom).toHaveBeenCalledOnce();
  });
  it('이동이 확인되면 이전 참여만 종료하고 최종 판정 토큰으로 새 방에 연결한다', async () => {
    await participation.start();
    const moved = {
      ...location,
      region: { ...location.region, sigungu: { regionId: 30, code: '11680', name: '강남구' } },
    };
    vi.mocked(resolveCurrentChatLocation)
      .mockResolvedValueOnce({ ...moved, locationResolutionToken: 'candidate-token' })
      .mockResolvedValueOnce({ ...moved, locationResolutionToken: 'confirmed-token' });
    vi.mocked(getRegionChatRoom).mockResolvedValue({ ...room, roomId: 701, regionId: 30 });
    vi.mocked(joinChatRoom).mockResolvedValue({
      ...membership,
      membershipId: 901,
      roomId: 701,
      regionId: 30,
    });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000 + 15_000);
    expect(close).toHaveBeenCalledOnce();
    expect(leaveChatRoomForRegionChange).toHaveBeenCalledWith(
      membership,
      'confirmed-token',
      expect.any(String),
    );
    expect(leaveChatRoom).not.toHaveBeenCalled();
    expect(joinChatRoom).toHaveBeenLastCalledWith(
      701,
      'confirmed-token',
      expect.any(AbortSignal),
      expect.any(String),
    );
    expect(connectChatRoom).toHaveBeenCalledTimes(2);
    expect(states.at(-1)?.activeRoom?.membership.membershipId).toBe(901);
  });
});
