import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatRoomRequestError, getRegionChatRoom, joinChatRoom } from '../../../api/chatRooms';
import { useChatLocation } from '../../../hooks/useChatLocation';
import { ChatEntryPage, type ActiveChatRoom } from './ChatEntryPage';

vi.mock('../../../hooks/useChatLocation', () => ({ useChatLocation: vi.fn() }));
vi.mock('../../../api/chatRooms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/chatRooms')>()),
  getRegionChatRoom: vi.fn(),
  joinChatRoom: vi.fn(),
}));

const requestLocation = vi.fn();
const retryLocation = vi.fn();
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
  joinedAt: '2026-09-23T08:00:00Z',
};

function Harness() {
  const [activeChatRoom, setActiveChatRoom] = useState<ActiveChatRoom | null>(null);
  return (
    <ChatEntryPage
      accessToken="access-token"
      activeChatRoom={activeChatRoom}
      onEntered={setActiveChatRoom}
      onMembershipEnded={() => setActiveChatRoom(null)}
      onLogin={vi.fn()}
    />
  );
}

describe('ChatEntryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useChatLocation).mockReturnValue({
      status: 'resolved',
      attempt: 1,
      error: '',
      canRetry: false,
      resolution: {
        mapDot: null,
        region: {
          sido: { regionId: 9, code: '41', name: '경기도' },
          sigungu: { regionId: 25, code: '41135', name: '성남시 분당구' },
        },
        locationResolutionToken: 'location-token',
        expiresIn: 300,
      },
      isLoading: false,
      requestLocation,
      retryLocation,
    });
    vi.mocked(getRegionChatRoom).mockResolvedValue(room);
    vi.mocked(joinChatRoom).mockResolvedValue(membership);
  });

  it('위치 확인 후 방 조회와 입장을 순서대로 수행하고 활성 방을 표시한다', async () => {
    render(<Harness />);

    expect(requestLocation).toHaveBeenCalledOnce();
    await waitFor(() => expect(getRegionChatRoom).toHaveBeenCalledOnce());
    await waitFor(() => expect(joinChatRoom).toHaveBeenCalledOnce());
    expect(vi.mocked(getRegionChatRoom).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(joinChatRoom).mock.invocationCallOrder[0],
    );
    expect(
      await screen.findByRole('heading', { name: '성남시 분당구 채팅방' }),
    ).toBeInTheDocument();
    expect(screen.getByText('현재 지역 채팅방에 입장했어요.')).toBeInTheDocument();
    expect(joinChatRoom).toHaveBeenCalledWith(
      700,
      'location-token',
      'access-token',
      expect.any(AbortSignal),
    );
    expect(joinChatRoom).toHaveBeenCalledOnce();
  });

  it('토큰 만료 오류 후 전체 위치 흐름을 다시 시작한다', async () => {
    vi.mocked(joinChatRoom).mockRejectedValue(
      new ChatRoomRequestError('위치 정보가 만료되었습니다. 현재 위치를 다시 확인해 주세요.', 400),
    );
    const user = userEvent.setup();
    render(<Harness />);

    expect(await screen.findByRole('alert')).toHaveTextContent('위치 정보가 만료');
    await user.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(retryLocation).toHaveBeenCalledOnce();
  });

  it('정원 초과를 구분하여 안내한다', async () => {
    vi.mocked(joinChatRoom).mockRejectedValue(
      new ChatRoomRequestError(
        '현재 지역 채팅방의 정원이 가득 찼습니다. 잠시 후 다시 시도해 주세요.',
        409,
      ),
    );
    render(<Harness />);

    expect(await screen.findByRole('alert')).toHaveTextContent('정원이 가득');
  });
});
