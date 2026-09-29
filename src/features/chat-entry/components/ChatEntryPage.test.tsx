import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRegionChatRoom, joinChatRoom } from '../../../api/chatRooms';
import { useChatLocation } from '../../../hooks/useChatLocation';
import { ChatEntryPage } from './ChatEntryPage';

vi.mock('../../../hooks/useChatLocation', () => ({ useChatLocation: vi.fn() }));
vi.mock('../../../api/chatRooms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/chatRooms')>()),
  getRegionChatRoom: vi.fn(),
  joinChatRoom: vi.fn(),
}));

const requestLocation = vi.fn();
const retryLocation = vi.fn();

describe('ChatEntryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('지역명이 확인되면 지역별 채팅 준비 안내를 표시하고 자동 입장하지 않는다', () => {
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

    render(<ChatEntryPage />);

    expect(requestLocation).toHaveBeenCalledOnce();
    expect(screen.getByText('성남시 분당구 채팅 기능을 준비하고 있어요.')).toBeInTheDocument();
    expect(getRegionChatRoom).not.toHaveBeenCalled();
    expect(joinChatRoom).not.toHaveBeenCalled();
  });

  it('위치 또는 지역명이 없으면 기본 채팅 준비 안내를 표시한다', () => {
    vi.mocked(useChatLocation).mockReturnValue({
      status: 'error',
      attempt: 1,
      error: '현재 위치를 확인하지 못했습니다.',
      canRetry: true,
      resolution: null,
      isLoading: false,
      requestLocation,
      retryLocation,
    });

    render(<ChatEntryPage />);

    expect(screen.getByText('채팅 기능을 준비하고 있어요.')).toBeInTheDocument();
  });
});
