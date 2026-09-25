import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatRoomRequestError, getRegionChatRoom, joinChatRoom } from '../../../api/chatRooms';
import type { LocationResolution } from '../../../api/locationResolutions';
import type { ActiveChatRoom } from '../components/ChatEntryPage';
import { resolveCurrentChatLocation } from '../services/resolveCurrentChatLocation';
import { useChatRoomLocationRevalidation } from './useChatRoomLocationRevalidation';

vi.mock('../services/resolveCurrentChatLocation', () => ({
  resolveCurrentChatLocation: vi.fn(),
}));
vi.mock('../../../api/chatRooms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/chatRooms')>()),
  getRegionChatRoom: vi.fn(),
  joinChatRoom: vi.fn(),
}));

const activeChatRoom: ActiveChatRoom = {
  room: {
    roomId: 700,
    regionId: 25,
    regionName: '성남시 분당구',
    capacity: 25,
    status: 'ACTIVE',
  },
  membership: {
    membershipId: 900,
    roomId: 700,
    regionId: 25,
    joinedAt: '2026-09-25T00:00:00Z',
  },
};

const movedRoom = {
  roomId: 701,
  regionId: 30,
  regionName: '서울특별시 강남구',
  capacity: 25,
  status: 'ACTIVE',
};

const movedMembership = {
  membershipId: 901,
  roomId: 701,
  regionId: 30,
  joinedAt: '2026-09-25T00:10:15Z',
};

function resolution(regionId: number, token: string): LocationResolution {
  return {
    mapDot: null,
    region: {
      sido: {
        regionId: regionId === 25 ? 9 : 1,
        code: regionId === 25 ? '41' : '11',
        name: '시도',
      },
      sigungu: { regionId, code: regionId === 25 ? '41135' : '11680', name: '시군구' },
    },
    locationResolutionToken: token,
    expiresIn: 300,
  };
}

describe('useChatRoomLocationRevalidation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(getRegionChatRoom).mockResolvedValue(movedRoom);
    vi.mocked(joinChatRoom).mockResolvedValue(movedMembership);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('10분 후 같은 지역이면 기존 방을 유지한다', async () => {
    vi.mocked(resolveCurrentChatLocation).mockResolvedValue(resolution(25, 'same-token'));
    const onMoved = vi.fn();
    const { result } = renderHook(() =>
      useChatRoomLocationRevalidation({
        accessToken: 'access-token',
        activeChatRoom,
        onMoved,
        onMembershipEnded: vi.fn(),
      }),
    );

    expect(resolveCurrentChatLocation).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(10 * 60 * 1_000));

    expect(resolveCurrentChatLocation).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('stable');
    expect(onMoved).not.toHaveBeenCalled();
    expect(joinChatRoom).not.toHaveBeenCalled();
  });

  it('두 번 연속 같은 새 지역이면 새 위치 토큰으로 이동한다', async () => {
    vi.mocked(resolveCurrentChatLocation)
      .mockResolvedValueOnce(resolution(30, 'candidate-token'))
      .mockResolvedValueOnce(resolution(30, 'confirmed-token'));
    const onMoved = vi.fn();
    const { result } = renderHook(() =>
      useChatRoomLocationRevalidation({
        accessToken: 'access-token',
        activeChatRoom,
        onMoved,
        onMembershipEnded: vi.fn(),
      }),
    );

    await act(async () => vi.advanceTimersByTimeAsync(10 * 60 * 1_000));
    expect(result.current.status).toBe('confirming');
    await act(async () => vi.advanceTimersByTimeAsync(15_000));

    expect(resolveCurrentChatLocation).toHaveBeenCalledTimes(2);
    expect(joinChatRoom).toHaveBeenCalledWith(
      701,
      'confirmed-token',
      'access-token',
      expect.any(AbortSignal),
    );
    expect(onMoved).toHaveBeenCalledWith({ room: movedRoom, membership: movedMembership });
    expect(result.current.status).toBe('moved');
  });

  it('두 판정의 새 지역이 다르면 다음 주기까지 기존 방을 유지한다', async () => {
    vi.mocked(resolveCurrentChatLocation)
      .mockResolvedValueOnce(resolution(30, 'candidate-token'))
      .mockResolvedValueOnce(resolution(31, 'different-token'));
    const onMoved = vi.fn();
    const { result } = renderHook(() =>
      useChatRoomLocationRevalidation({
        accessToken: 'access-token',
        activeChatRoom,
        onMoved,
        onMembershipEnded: vi.fn(),
      }),
    );

    await act(async () => vi.advanceTimersByTimeAsync(10 * 60 * 1_000));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));

    expect(result.current.status).toBe('mismatch');
    expect(result.current.message).toContain('기존 채팅방을 유지');
    expect(joinChatRoom).not.toHaveBeenCalled();
    expect(onMoved).not.toHaveBeenCalled();
  });

  it('새 방 정원 초과 시 기존 방이 종료될 수 있음을 안내한다', async () => {
    vi.mocked(resolveCurrentChatLocation)
      .mockResolvedValueOnce(resolution(30, 'candidate-token'))
      .mockResolvedValueOnce(resolution(30, 'confirmed-token'));
    vi.mocked(joinChatRoom).mockRejectedValue(
      new ChatRoomRequestError('현재 지역 채팅방의 정원이 가득 찼습니다.', 409),
    );
    const onMembershipEnded = vi.fn();
    const { result } = renderHook(() =>
      useChatRoomLocationRevalidation({
        accessToken: 'access-token',
        activeChatRoom,
        onMoved: vi.fn(),
        onMembershipEnded,
      }),
    );

    await act(async () => vi.advanceTimersByTimeAsync(10 * 60 * 1_000));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));

    expect(result.current.status).toBe('roomFull');
    expect(result.current.message).toContain('기존 채팅방에서도 퇴장');
    expect(onMembershipEnded).toHaveBeenCalledOnce();
  });

  it('화면 이탈 시 15초 재확인과 이동 요청을 취소한다', async () => {
    vi.mocked(resolveCurrentChatLocation).mockResolvedValueOnce(resolution(30, 'candidate-token'));
    const { unmount } = renderHook(() =>
      useChatRoomLocationRevalidation({
        accessToken: 'access-token',
        activeChatRoom,
        onMoved: vi.fn(),
        onMembershipEnded: vi.fn(),
      }),
    );

    await act(async () => vi.advanceTimersByTimeAsync(10 * 60 * 1_000));
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(15_000));

    expect(resolveCurrentChatLocation).toHaveBeenCalledOnce();
    expect(getRegionChatRoom).not.toHaveBeenCalled();
    expect(joinChatRoom).not.toHaveBeenCalled();
  });
});
