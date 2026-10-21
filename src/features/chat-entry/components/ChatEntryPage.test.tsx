import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { useChatParticipation } from '../hooks/useChatParticipation';
import { ChatEntryPage } from './ChatEntryPage';
import { navigate } from '../../../shared/navigation';

vi.mock('../hooks/useChatParticipation', () => ({ useChatParticipation: vi.fn() }));
const retry = vi.fn();

function message(messageId: number, userId = 8, createdAt = '2026-10-01T07:37:00Z') {
  return {
    messageId,
    clientMessageId: `message-${messageId}`,
    roomId: 700,
    userId,
    nickname: '같은 닉네임',
    content: `메시지 ${messageId}`,
    createdAt,
  };
}

function readyState() {
  return {
    retry,
    send: vi.fn().mockReturnValue(true),
    retryMessage: vi.fn().mockReturnValue(true),
    retryRecovery: vi.fn(),
    status: 'ready' as const,
    message: '채팅방에 입장했어요.',
    isReady: true,
    currentUserId: 7,
    presenceStatus: 'live' as const,
    connectedCount: 4,
    activeRoom: {
      room: { roomId: 700, regionId: 25, regionName: '성남시', capacity: 25, status: 'ACTIVE' },
      membership: {
        membershipId: 900,
        roomId: 700,
        regionId: 25,
        joinedAt: '2026-10-01T07:30:00Z',
        viewSessionId: '11111111-1111-4111-8111-111111111111',
      },
    },
  };
}

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
      retryRecovery: vi.fn(),
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

  it('복원한 이전 대화와 새 참여 대화를 구분하고 복원만으로 전송을 허용하지 않는다', () => {
    const state = useChatParticipation();
    vi.mocked(useChatParticipation).mockReturnValue({
      ...state,
      restoredThroughMessageId: 1,
      messages: [1, 3].map((messageId) => ({
        messageId,
        clientMessageId: String(messageId),
        roomId: 700,
        userId: 7,
        nickname: '작성자',
        content: `대화${messageId}`,
        createdAt: '2026-10-08T00:00:00Z',
      })),
    });
    render(<ChatEntryPage />);
    expect(screen.getByText('이전에 봤던 대화')).toHaveAttribute('role', 'status');
    expect(screen.getByText('다시 입장한 이후 대화')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('textbox', { name: '메시지' })).toBeDisabled();
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
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(send).toHaveBeenCalledWith('안녕');
    expect(input).toHaveValue('');
  });

  it('인증 사용자 메시지를 오른쪽으로 구분하고 접속 인원 미확인을 0으로 표시하지 않는다', () => {
    const state = useChatParticipation();
    vi.mocked(useChatParticipation).mockReturnValue({
      ...state,
      currentUserId: 7,
      messages: [
        {
          messageId: 1,
          clientMessageId: 'first',
          roomId: 700,
          userId: 7,
          nickname: '본인',
          content: '내 메시지',
          createdAt: '2026-10-08T00:00:00Z',
        },
        {
          messageId: 2,
          clientMessageId: 'second',
          roomId: 700,
          userId: 8,
          nickname: '동료',
          content: '다른 메시지',
          createdAt: '2026-10-08T00:00:00Z',
        },
      ],
      presenceStatus: 'loading',
      connectedCount: null,
    });
    render(<ChatEntryPage />);
    expect(screen.getByText('내 메시지').closest('article')).toHaveClass('region-chat-own');
    expect(screen.getByText('다른 메시지').closest('article')).not.toHaveClass('region-chat-own');
    expect(screen.getByLabelText('현재 접속 인원')).toHaveTextContent('인원 확인 중');
  });

  it('하단을 보고 있을 때 목록만 이동하고 이전 메시지를 읽을 때는 목록 위치를 유지한다', () => {
    const state = useChatParticipation();
    vi.mocked(useChatParticipation).mockReturnValue({ ...state, messages: [] });
    const view = render(<ChatEntryPage />);
    const list = screen.getByRole('log');
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 400 });
    const message = {
      messageId: 1,
      clientMessageId: 'first',
      roomId: 700,
      userId: 7,
      nickname: '작성자',
      content: '신규',
      createdAt: '2026-10-08T00:00:00Z',
    };
    vi.mocked(useChatParticipation).mockReturnValue({ ...state, messages: [message] });
    view.rerender(<ChatEntryPage />);
    expect(list.scrollTop).toBe(1000);
    list.scrollTop = 100;
    fireEvent.scroll(list);
    vi.mocked(useChatParticipation).mockReturnValue({
      ...state,
      messages: [message, { ...message, messageId: 2 }],
    });
    view.rerender(<ChatEntryPage />);
    expect(list.scrollTop).toBe(100);
    expect(window.scrollY).toBe(0);
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
    expect(button.querySelector('img')).toHaveAttribute('src', '/icons/chat/back.svg');
    fireEvent.click(button);
    expect(back).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
  });

  it.each([25, 1000])('서버 정원 %i명과 현재 인원을 표시하고 퇴장 버튼을 제공한다', (capacity) => {
    vi.mocked(useChatParticipation).mockReturnValue({
      status: 'ready',
      message: '채팅방에 입장했어요.',
      isReady: true,
      presenceStatus: 'live',
      connectedCount: capacity,
      retry,
      send: vi.fn().mockReturnValue(true),
      retryMessage: vi.fn().mockReturnValue(true),
      retryRecovery: vi.fn(),
      activeRoom: {
        room: {
          roomId: 700,
          regionId: 25,
          regionName: '성남시 분당구',
          capacity,
          status: 'ACTIVE',
        },
        membership: {
          membershipId: 900,
          roomId: 700,
          regionId: 25,
          joinedAt: '2026-10-07T00:00:00Z',
          viewSessionId: '11111111-1111-4111-8111-111111111111',
        },
      },
    });
    render(<ChatEntryPage />);
    expect(screen.getByRole('heading', { name: '성남시 분당구 채팅방' })).toBeInTheDocument();
    expect(screen.getByText(`정원 ${capacity}명`)).toBeInTheDocument();
    expect(screen.getByLabelText('현재 접속 인원')).toHaveTextContent(
      `${capacity} / ${capacity}명`,
    );
    fireEvent.click(screen.getByRole('button', { name: '퇴장' }));
    expect(window.location.pathname).toBe('/');
  });

  it.each([
    [4, 25],
    [0, 1000],
    [9999, 9999],
  ])('live 접속 인원 %s와 실제 정원 %s를 헤더와 접근성 안내에 반영한다', (count, capacity) => {
    const state = readyState();
    vi.mocked(useChatParticipation).mockReturnValue({
      ...state,
      connectedCount: count,
      activeRoom: { ...state.activeRoom, room: { ...state.activeRoom.room, capacity } },
    });
    const { container } = render(<ChatEntryPage />);
    const counter = container.querySelector('.chat-entry-capacity');
    expect(counter).toHaveTextContent(`${count}/${capacity}`);
    expect(counter).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByLabelText('현재 접속 인원')).toHaveTextContent(`${count} / ${capacity}명`);
    expect(screen.getByLabelText('현재 접속 인원')).toHaveClass('chat-entry-visually-hidden');
    expect(screen.getByText(`정원 ${capacity}명`)).toHaveClass('chat-entry-visually-hidden');
  });

  it.each([null, undefined])('live 상태여도 인원 %s는 미확인으로 표시한다', (connectedCount) => {
    vi.mocked(useChatParticipation).mockReturnValue({ ...readyState(), connectedCount });
    render(<ChatEntryPage />);
    expect(screen.getByRole('heading').closest('header')).toHaveTextContent('-/25');
    expect(screen.getByLabelText('현재 접속 인원')).toHaveTextContent('인원 확인 중');
    expect(screen.getByLabelText('현재 접속 인원')).toHaveClass('chat-entry-visually-hidden');
  });

  it.each([
    ['loading', '인원 확인 중'],
    ['error', '인원 확인 실패'],
    ['disconnected', '연결 끊김'],
    [undefined, '인원 확인 중'],
  ] as const)('%s 상태의 오래된 인원은 숨기고 기존 안내를 유지한다', (presenceStatus, notice) => {
    vi.mocked(useChatParticipation).mockReturnValue({
      ...readyState(),
      presenceStatus,
      connectedCount: 23,
    });
    render(<ChatEntryPage />);
    expect(screen.getByRole('heading').closest('header')).toHaveTextContent('-/25');
    const countNotice = screen.getByLabelText('현재 접속 인원');
    expect(countNotice).toHaveTextContent(notice);
    expect(countNotice.classList.contains('chat-entry-visually-hidden')).toBe(
      presenceStatus !== 'error' && presenceStatus !== 'disconnected',
    );
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'aria-describedby',
      'region-chat-count region-chat-notice',
    );
  });

  it('방이 없으면 미확인 정원을 표시하고 임의 정원 안내를 만들지 않는다', () => {
    vi.mocked(useChatParticipation).mockReturnValue({ ...readyState(), activeRoom: null });
    render(<ChatEntryPage />);
    expect(
      screen.getByRole('heading', { name: '우리 지역 채팅방' }).closest('header'),
    ).toHaveTextContent('4/-');
    expect(screen.getByLabelText('현재 접속 인원')).toHaveTextContent('4 / -명');
    expect(screen.queryByText(/^정원 /)).not.toBeInTheDocument();
  });

  it('방과 접속 인원을 확인하기 전에는 헤더 양쪽 숫자를 미확인으로 표시한다', () => {
    render(<ChatEntryPage />);
    expect(screen.getByRole('heading').closest('header')).toHaveTextContent('-/-');
    expect(screen.queryByText(/^정원 /)).not.toBeInTheDocument();
  });

  it('같은 화면에서 바뀐 접속 인원과 정원을 즉시 반영하고 재연결 중 오래된 인원은 숨긴다', () => {
    const state = readyState();
    vi.mocked(useChatParticipation).mockReturnValue(state);
    const view = render(<ChatEntryPage />);
    expect(screen.getByRole('heading').closest('header')).toHaveTextContent('4/25');
    const updated = {
      ...state,
      connectedCount: 12,
      activeRoom: { ...state.activeRoom, room: { ...state.activeRoom.room, capacity: 1000 } },
    };
    vi.mocked(useChatParticipation).mockReturnValue(updated);
    view.rerender(<ChatEntryPage />);
    expect(screen.getByRole('heading').closest('header')).toHaveTextContent('12/1000');
    expect(screen.getByText('정원 1000명')).toHaveClass('chat-entry-visually-hidden');
    expect(screen.queryByText('정원 25명')).not.toBeInTheDocument();
    vi.mocked(useChatParticipation).mockReturnValue({ ...updated, presenceStatus: 'disconnected' });
    view.rerender(<ChatEntryPage />);
    expect(screen.getByRole('heading').closest('header')).toHaveTextContent('-/1000');
    expect(screen.getByLabelText('현재 접속 인원')).toHaveTextContent('연결 끊김');
    vi.mocked(useChatParticipation).mockReturnValue({ ...updated, connectedCount: 0 });
    view.rerender(<ChatEntryPage />);
    expect(screen.getByRole('heading').closest('header')).toHaveTextContent('0/1000');
    expect(screen.getByLabelText('현재 접속 인원')).toHaveTextContent('0 / 1000명');
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
      retryRecovery: vi.fn(),
    });
    render(<ChatEntryPage />);
    expect(screen.getByRole('status')).toHaveTextContent('정원이 가득 찼습니다.');
    expect(screen.getByRole('textbox', { name: '메시지' })).toBeDisabled();
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
      retryRecovery: vi.fn(),
    });
    render(<ChatEntryPage />);
    expect(screen.queryByRole('button', { name: '다시 입장' })).not.toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
  });
  it('복구 중 입력을 막고 부재 구분선·복구 재시도를 안내한다', () => {
    const state = useChatParticipation();
    const retryRecovery = vi.fn();
    vi.mocked(useChatParticipation).mockReturnValue({
      ...state,
      status: 'recovery-failed',
      isReady: false,
      message: '메시지를 복구하지 못했어요.',
      retryRecovery,
      gaps: [{ reason: 'ABSENCE', beforeMessageId: 0, resumedAt: '2026-10-13T00:00:00Z' }],
    });
    render(<ChatEntryPage />);
    expect(screen.getByRole('textbox', { name: '메시지' })).toBeDisabled();
    expect(screen.getByText('연결이 끊겨 일부 대화가 표시되지 않아요')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '복구 다시 시도' }));
    expect(retryRecovery).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });

  it('같은 작성자의 같은 분만 묶고 작성자·분·날짜 경계에서 시간을 다시 표시한다', () => {
    vi.mocked(useChatParticipation).mockReturnValue({
      ...readyState(),
      messages: [
        message(1),
        message(2, 8, '2026-10-01T07:37:59Z'),
        message(3, 8, '2026-10-01T07:38:00Z'),
        message(4, 9, '2026-10-01T07:38:00Z'),
        message(5, 8, '2026-10-01T07:38:00Z'),
        message(6, 8, '2026-10-02T07:38:00Z'),
      ],
    });
    render(<ChatEntryPage />);
    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(6);
    expect(articles[1]).toHaveClass('region-chat-continuation');
    for (const index of [0, 2, 3, 4, 5])
      expect(articles[index]).not.toHaveClass('region-chat-continuation');
    expect(articles[0].querySelector('time')).toHaveClass('chat-entry-visually-hidden');
    expect(articles[1].querySelector('time')).toHaveClass('region-chat-time');
    expect(articles[1].querySelector('time')).toHaveAttribute('dateTime', '2026-10-01T07:37:59Z');
    expect(screen.getByRole('log').querySelectorAll('.region-chat-date')).toHaveLength(2);
    expect(screen.getByRole('log').querySelectorAll('.region-chat-time')).toHaveLength(5);
    expect(within(articles[0]).getByText('같은 닉네임')).toHaveClass('chat-entry-visually-hidden');
  });

  it('같은 작성자와 분이어도 복원·부재·보관 경계는 유지하고 그룹을 나눈다', () => {
    vi.mocked(useChatParticipation).mockReturnValue({
      ...readyState(),
      messages: [message(1), message(2), message(3)],
      restoredThroughMessageId: 1,
      gaps: [
        { reason: 'ABSENCE', beforeMessageId: 2, resumedAt: '2026-10-01T07:37:10Z' },
        { reason: 'RETENTION', beforeMessageId: 3, resumedAt: '2026-10-01T07:37:20Z' },
      ],
    });
    render(<ChatEntryPage />);
    expect(screen.getByText('이전에 봤던 대화')).toHaveAttribute('role', 'status');
    expect(screen.getByText('다시 입장한 이후 대화')).toHaveAttribute('role', 'status');
    expect(screen.getByText('연결이 끊겨 일부 대화가 표시되지 않아요')).toHaveAttribute(
      'role',
      'status',
    );
    expect(screen.getByText('보관 기간이 지난 메시지는 표시되지 않아요')).toHaveAttribute(
      'role',
      'status',
    );
    expect(screen.getByRole('log').querySelectorAll('.region-chat-time')).toHaveLength(3);
  });

  it('ACK와 같은 pending을 중복 표시하지 않고 불확실·거절 안내와 재전송을 보존한다', () => {
    const state = readyState();
    const retryMessage = vi.fn().mockReturnValue(true);
    vi.mocked(useChatParticipation).mockReturnValue({
      ...state,
      retryMessage,
      messages: [message(1, 7)],
      pendingMessages: [
        { clientMessageId: 'message-1', content: '중복 pending', status: 'sending', notice: '' },
        { clientMessageId: 'sending', content: '대기', status: 'sending', notice: '' },
        {
          clientMessageId: 'uncertain',
          content: '불확실',
          status: 'uncertain',
          notice: '결과 확인 필요',
        },
        {
          clientMessageId: 'rejected',
          content: '거절',
          status: 'rejected',
          notice: '전송 거절 안내',
        },
      ],
    });
    const view = render(<ChatEntryPage />);
    expect(screen.queryByText('중복 pending')).not.toBeInTheDocument();
    expect(screen.getByText('전송 완료')).toHaveClass('chat-entry-visually-hidden');
    expect(screen.getByText('전송 중')).toHaveClass('chat-entry-visually-hidden');
    expect(screen.getByText('결과 확인 필요')).not.toHaveClass('chat-entry-visually-hidden');
    expect(screen.getByText('전송 거절 안내')).not.toHaveClass('chat-entry-visually-hidden');
    fireEvent.click(screen.getByRole('button', { name: '재전송' }));
    expect(retryMessage).toHaveBeenCalledWith('uncertain');
    vi.mocked(useChatParticipation).mockReturnValue({ ...useChatParticipation(), isReady: false });
    view.rerender(<ChatEntryPage />);
    expect(screen.getByRole('button', { name: '재전송' })).toBeDisabled();
  });

  it('공백과 301 Unicode 문자를 차단하고 300 emoji는 원문으로 전송한다', () => {
    const send = vi.fn().mockReturnValue(true);
    vi.mocked(useChatParticipation).mockReturnValue({ ...readyState(), send });
    render(<ChatEntryPage />);
    const input = screen.getByRole('textbox', { name: '메시지' });
    fireEvent.change(input, { target: { value: '  \n  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('메시지를 입력해 주세요.');
    fireEvent.change(input, { target: { value: '🙂'.repeat(301) } });
    expect(screen.getByRole('button', { name: '전송' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('메시지는 300자까지 보낼 수 있어요.');
    expect(send).not.toHaveBeenCalled();
    const content = `  ${'🙂'.repeat(300)}  `;
    fireEvent.change(input, { target: { value: content } });
    expect(screen.getByText('300/300자')).toHaveClass('chat-entry-visually-hidden');
    expect(screen.getByRole('button', { name: '전송' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '전송' }));
    expect(send).toHaveBeenCalledWith(content);
    expect(input).toHaveValue('');
  });

  it('전송 실패는 초안을 보존하고 membership 변경은 초안과 입력 오류를 지운다', () => {
    const state = readyState();
    vi.mocked(useChatParticipation).mockReturnValue({
      ...state,
      send: vi.fn().mockReturnValue(false),
    });
    const view = render(<ChatEntryPage />);
    const input = screen.getByRole('textbox', { name: '메시지' });
    fireEvent.change(input, { target: { value: '아직 남길 초안' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('아직 남길 초안');
    fireEvent.change(input, { target: { value: '가'.repeat(301) } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).not.toBeEmptyDOMElement();
    vi.mocked(useChatParticipation).mockReturnValue({
      ...state,
      activeRoom: {
        ...state.activeRoom,
        membership: { ...state.activeRoom.membership, membershipId: 901 },
      },
    });
    view.rerender(<ChatEntryPage />);
    expect(input).toHaveValue('');
    expect(input).toHaveStyle({ height: '44px' });
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('입력 높이는 computed 최대값을 따르고 viewport 변경·삭제·공백·전송 후 줄어든다', () => {
    vi.mocked(useChatParticipation).mockReturnValue(readyState());
    render(<ChatEntryPage />);
    const input = screen.getByRole('textbox', { name: '메시지' });
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 300 });
    input.style.border = '1px solid';
    input.style.maxHeight = '68px';
    fireEvent.change(input, { target: { value: '여러 줄\n내용\n내용' } });
    expect(input).toHaveStyle({ height: '68px' });
    input.style.maxHeight = '44px';
    fireEvent(window, new Event('resize'));
    expect(input).toHaveStyle({ height: '44px' });
    input.style.maxHeight = '140px';
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 66 });
    fireEvent.change(input, { target: { value: '두 줄\n내용' } });
    expect(input).toHaveStyle({ height: '68px' });
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveStyle({ height: '44px' });
    fireEvent.change(input, { target: { value: '  \n  ' } });
    expect(input).toHaveStyle({ height: '44px' });
    fireEvent.change(input, { target: { value: '두 줄\n내용' } });
    fireEvent.click(screen.getByRole('button', { name: '전송' }));
    expect(input).toHaveValue('');
    expect(input).toHaveStyle({ height: '44px' });
  });

  it('visualViewport 높이·offset을 반영하고 unmount 시 listener를 정리한다', () => {
    const viewport = Object.assign(new EventTarget(), { height: 420, offsetTop: 12 });
    const remove = vi.spyOn(viewport, 'removeEventListener');
    vi.stubGlobal('visualViewport', viewport);
    vi.mocked(useChatParticipation).mockReturnValue(readyState());
    const view = render(<ChatEntryPage />);
    const main = screen.getByRole('main');
    expect(main).toHaveStyle({ height: '420px', top: '12px' });
    viewport.height = 260;
    viewport.offsetTop = 30;
    viewport.dispatchEvent(new Event('resize'));
    expect(main).toHaveStyle({ height: '260px', top: '30px' });
    expect(main.style.getPropertyValue('--chat-entry-viewport-height')).toBe('260px');
    view.unmount();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    vi.unstubAllGlobals();
  });

  it.each([
    'locating',
    'joining',
    'connecting',
    'reconnecting',
    'recovering',
    'error',
    'full',
    'left',
    'banned',
    'recovery-failed',
  ] as const)('%s 상태는 안내를 화면에 남기고 입력을 차단한다', (status) => {
    vi.mocked(useChatParticipation).mockReturnValue({
      ...readyState(),
      status,
      isReady: false,
      message: `${status} 상태 안내`,
    });
    render(<ChatEntryPage />);
    expect(screen.getByRole('status')).not.toHaveClass('chat-entry-visually-hidden');
    expect(screen.getByRole('textbox', { name: '메시지' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '다시 입장' }) !== null).toBe(
      ['error', 'full', 'left'].includes(status),
    );
  });

  it.each(['disconnected', 'error'] as const)(
    '접속 인원 %s는 정상 입장 중에도 화면에 표시한다',
    (presenceStatus) => {
      vi.mocked(useChatParticipation).mockReturnValue({
        ...readyState(),
        presenceStatus,
        connectedCount: null,
      });
      render(<ChatEntryPage />);
      expect(screen.getByLabelText('현재 접속 인원')).not.toHaveClass('chat-entry-visually-hidden');
      expect(screen.getByRole('status')).toHaveClass('chat-entry-visually-hidden');
      expect(screen.getByRole('button', { name: '퇴장' })).toHaveClass('chat-entry-exit');
      expect(screen.getByRole('textbox')).toHaveAttribute(
        'aria-describedby',
        'region-chat-count region-chat-notice',
      );
    },
  );
});
