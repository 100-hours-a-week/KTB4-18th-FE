import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { useChatParticipation } from '../hooks/useChatParticipation';
import { ChatEntryPage } from './ChatEntryPage';
import { navigate } from '../../../shared/navigation';

vi.mock('../hooks/useChatParticipation', () => ({ useChatParticipation: vi.fn() }));
const retry = vi.fn();

describe('ChatEntryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/chat');
    vi.mocked(useChatParticipation).mockReturnValue({
      status: 'locating',
      message: '현재 위치를 확인하고 있어요.',
      activeRoom: null,
      isReady: false,
      retry,
      send: vi.fn().mockReturnValue(true),
      retryMessage: vi.fn().mockReturnValue(true),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('연결 전에는 입력을 막고 텍스트는 HTML을 해석하지 않고 표시한다', () => {
    const state = useChatParticipation();
    vi.mocked(useChatParticipation).mockReturnValue({
      ...state,
      messages: [
        {
          messageId: 1,
          clientMessageId: 'id',
          roomId: 700,
          userId: 7,
          nickname: '닉네임',
          content: '<img src=x onerror=alert(1)>',
          createdAt: '2026-10-08T00:00:00Z',
        },
      ],
    });
    render(<ChatEntryPage />);
    expect(screen.getByRole('textbox', { name: '메시지' })).toBeDisabled();
    expect(screen.getByRole('log')).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(screen.getByRole('log').querySelector('img')).toBeNull();
  });

  it('Enter는 전송하고 Shift+Enter와 한글 조합 중 Enter는 전송하지 않는다', () => {
    const state = useChatParticipation();
    const send = vi.fn().mockReturnValue(true);
    vi.mocked(useChatParticipation).mockReturnValue({
      ...state,
      status: 'ready',
      isReady: true,
      send,
    });
    render(<ChatEntryPage />);
    const input = screen.getByRole('textbox', { name: '메시지' });
    fireEvent.change(input, { target: { value: '안녕' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(send).toHaveBeenCalledWith('안녕');
    expect(input).toHaveValue('');
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

  it('입장과 구독 완료 후 지역명, 정원, 퇴장 버튼을 제공한다', () => {
    vi.mocked(useChatParticipation).mockReturnValue({
      status: 'ready',
      message: '채팅방에 입장했어요.',
      isReady: true,
      retry,
      send: vi.fn().mockReturnValue(true),
      retryMessage: vi.fn().mockReturnValue(true),
      activeRoom: {
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
          joinedAt: '2026-10-07T00:00:00Z',
        },
      },
    });
    render(<ChatEntryPage />);
    expect(screen.getByRole('heading', { name: '성남시 분당구 채팅방' })).toBeInTheDocument();
    expect(screen.getByText('정원 25명')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '지도' }));
    expect(window.location.pathname).toBe('/');
  });

  it('정원 초과 상태에서 키보드로 다시 입장할 수 있다', async () => {
    vi.mocked(useChatParticipation).mockReturnValue({
      status: 'full',
      message: '정원이 가득 찼습니다.',
      activeRoom: null,
      isReady: false,
      retry,
      send: vi.fn().mockReturnValue(true),
      retryMessage: vi.fn().mockReturnValue(true),
    });
    render(<ChatEntryPage />);
    expect(screen.getByRole('status')).toHaveTextContent('정원이 가득 찼습니다.');
    screen.getByRole('button', { name: '다시 입장' }).focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(retry).toHaveBeenCalledOnce();
  });

  it('제재 상태에서는 자동 또는 버튼 재입장을 제공하지 않는다', () => {
    vi.mocked(useChatParticipation).mockReturnValue({
      status: 'banned',
      message: '채팅 이용이 제한되었습니다.',
      activeRoom: null,
      isReady: false,
      retry,
      send: vi.fn().mockReturnValue(true),
      retryMessage: vi.fn().mockReturnValue(true),
    });
    render(<ChatEntryPage />);
    expect(screen.queryByRole('button', { name: '다시 입장' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '채팅' }));
    expect(retry).not.toHaveBeenCalled();
  });
});
