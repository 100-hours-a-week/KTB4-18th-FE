import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { getRegionChatRoom, joinChatRoom } from '../../../api/chatRooms';
import { useChatLocation } from '../../../hooks/useChatLocation';
import { ChatEntryPage } from './ChatEntryPage';
import { navigate } from '../../../shared/navigation';

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
    window.history.replaceState(null, '', '/chat');
    vi.mocked(useChatLocation).mockReturnValue({
      status: 'idle',
      attempt: 0,
      error: '',
      canRetry: false,
      resolution: null,
      isLoading: false,
      requestLocation,
      retryLocation,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('서비스 내부에서 진입하면 상단 뒤로가기 버튼으로 이전 경로에 복귀한다', async () => {
    window.history.replaceState(null, '', '/music-records?sort=recent');
    navigate('/chat');
    render(<ChatEntryPage />);
    const returned = new Promise<void>((resolve) =>
      window.addEventListener('popstate', () => resolve(), { once: true }),
    );
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('button', { name: '뒤로가기' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await returned;
    expect(window.location.pathname + window.location.search).toBe('/music-records?sort=recent');
  });

  it('직접 접속 시 이력이 있어도 외부 화면으로 돌아가지 않고 메인 지도로 이동한다', () => {
    const back = vi.spyOn(window.history, 'back');
    render(<ChatEntryPage />);
    const button = screen.getByRole('button', { name: '뒤로가기' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.querySelector('img')).toHaveAttribute('src', '/icons/chatbot/Arrow-reft.svg');
    fireEvent.click(button);
    expect(back).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
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
