import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ChatRoomScreen } from '../components/ChatEntryPage';
import { useChatParticipation } from '../hooks/useChatParticipation';
import { authenticatedFetchWithCurrentToken } from '../../auth-login/api/authSession';
import {
  added,
  candidate,
  musicResponse,
  musicSession,
  musicToken,
  queueItem,
  queuePage,
} from './chatMusicTestHelpers';
import { parseMusicEvent } from './chatMusicTypes';
import { musicEvent } from './chatMusicTestHelpers';

const auth = vi.hoisted(() => ({ token: '' }));
vi.mock('../../auth-login/api/authSession', async (original) => ({
  ...(await original<typeof import('../../auth-login/api/authSession')>()),
  getAccessToken: () => auth.token,
  authenticatedFetchWithCurrentToken: vi.fn(),
}));
const session = musicSession();
function chatState(): ReturnType<typeof useChatParticipation> {
  return {
    status: 'ready',
    message: '이야기방에 입장했어요.',
    isReady: true,
    currentUserId: 7,
    connectedCount: 2,
    presenceStatus: 'live',
    activeRoom: {
      room: { roomId: 700, regionId: 25, regionName: '성남시', capacity: 1000, status: 'ACTIVE' },
      membership: {
        membershipId: 900,
        roomId: 700,
        regionId: 25,
        viewSessionId: session.viewSessionId,
        joinedAt: '2026-11-09T05:00:00Z',
      },
    },
    musicSession: session,
    retry: vi.fn(),
    send: vi.fn().mockReturnValue(true),
    retryMessage: vi.fn(),
    retryRecovery: vi.fn(),
  };
}
let version = 1;
let items = [queueItem(1)];
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VITE_CHAT_MUSIC_QUEUE_ENABLED', 'true');
  auth.token = musicToken();
  version = 1;
  items = [queueItem(1)];
  vi.mocked(authenticatedFetchWithCurrentToken).mockImplementation(async (path, init) => {
    if (init?.method === 'POST') return musicResponse(added(1, 'PLAYING', ++version), 201);
    if (init?.method === 'DELETE') {
      items = [];
      version++;
      return musicResponse(null, 204);
    }
    if (String(path).includes('requestable-music'))
      return musicResponse({ items: [candidate(1), candidate(2)], next_cursor: null });
    return musicResponse(queuePage(version, items));
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
const openDialog = () => within(screen.getByRole('dialog'));

describe('/신청·검색·대기열 사용자 흐름', () => {
  it('opens /신청 keyword without sending chat, shows provenance and submits once', async () => {
    const user = userEvent.setup();
    const chat = chatState();
    render(<ChatRoomScreen chat={chat} />);
    const composer = screen.getByRole('textbox', { name: '메시지' });
    await user.type(composer, '/신청 윤하');
    await user.keyboard('{Enter}');
    expect(chat.send).not.toHaveBeenCalled();
    expect(composer).toHaveValue('');
    expect(openDialog().getByRole('searchbox')).toHaveValue('윤하');
    await openDialog().findByRole('button', { name: '노래 1 신청' });
    expect(openDialog().getAllByText('지역 기록')).toHaveLength(2);
    expect(openDialog().getAllByText('내 추천')).toHaveLength(2);
    const add = openDialog().getByRole('button', { name: '노래 1 신청' });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(openDialog().getByText('곡 신청을 확인했어요.')).toBeVisible());
    expect(
      vi
        .mocked(authenticatedFetchWithCurrentToken)
        .mock.calls.filter(([, i]) => i?.method === 'POST'),
    ).toHaveLength(1);
  });
  it('keeps normal slash text and IME Enter as ordinary composer content', async () => {
    const chat = chatState();
    render(<ChatRoomScreen chat={chat} />);
    const composer = screen.getByRole('textbox', { name: '메시지' });
    fireEvent.change(composer, { target: { value: '/신청 윤하' } });
    fireEvent.keyDown(composer, { key: 'Enter', keyCode: 229, isComposing: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(chat.send).not.toHaveBeenCalled();
    fireEvent.change(composer, { target: { value: '/신청곡은 이 노래' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(chat.send).toHaveBeenCalledWith('/신청곡은 이 노래');
    fireEvent.change(composer, { target: { value: '/신청 ' + '가'.repeat(101) } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(screen.getByText('검색어는 100자까지 입력해 주세요.')).toBeVisible();
  });
  it('shows current song separately and allows cancelling a neighbor waiting item', async () => {
    const user = userEvent.setup();
    render(<ChatRoomScreen chat={chatState()} />);
    await user.click(screen.getByRole('button', { name: /대기열/ }));
    await openDialog().findByRole('button', { name: '노래 1 신청 취소' });
    expect(openDialog().getByRole('region', { name: '현재 곡' })).toHaveTextContent('노래 99');
    expect(openDialog().getByText('이웃 신청')).toBeVisible();
    expect(
      openDialog().queryByRole('button', { name: '노래 99 신청 취소' }),
    ).not.toBeInTheDocument();
    await user.click(openDialog().getByRole('button', { name: '노래 1 신청 취소' }));
    await openDialog().findByText('대기 중인 곡이 없어요.');
    const cancel = vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.find(([, i]) => i?.method === 'DELETE');
    expect(String(cancel?.[0])).toContain('expected_version=1');
  });
  it('keeps unknown write and lets user confirm with same UUID from inside the dialog', async () => {
    const user = userEvent.setup();
    render(<ChatRoomScreen chat={chatState()} />);
    await user.click(screen.getByRole('button', { name: /음악 신청/ }));
    await openDialog().findByRole('button', { name: '노래 1 신청' });
    vi.mocked(authenticatedFetchWithCurrentToken).mockRejectedValueOnce(
      new TypeError('synthetic lost response'),
    );
    await user.click(openDialog().getByRole('button', { name: '노래 1 신청' }));
    await openDialog().findByRole('button', { name: '신청 결과 다시 확인' });
    expect(openDialog().getByRole('button', { name: '노래 2 신청' })).toBeDisabled();
    await user.click(openDialog().getByRole('button', { name: '신청 결과 다시 확인' }));
    await waitFor(() =>
      expect(
        openDialog().queryByRole('button', { name: '신청 결과 다시 확인' }),
      ).not.toBeInTheDocument(),
    );
    const writes = vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.filter(([, i]) => i?.method === 'POST');
    expect(writes).toHaveLength(2);
    expect(writes[0][1]?.headers).toEqual(writes[1][1]?.headers);
  });
  it('refreshes queue on another Task event and disables actions while reconnecting', async () => {
    const user = userEvent.setup();
    const chat = chatState();
    const { rerender } = render(<ChatRoomScreen chat={chat} />);
    await user.click(screen.getByRole('button', { name: /대기열/ }));
    await openDialog().findByRole('button', { name: '노래 1 신청 취소' });
    items = [queueItem(3)];
    version = 2;
    rerender(<ChatRoomScreen chat={{ ...chat, musicEvent: parseMusicEvent(musicEvent(2))! }} />);
    await openDialog().findByRole('button', { name: '노래 3 신청 취소' });
    expect(openDialog().queryByText('노래 1')).not.toBeInTheDocument();
    rerender(
      <ChatRoomScreen
        chat={{
          ...chat,
          isReady: false,
          status: 'reconnecting',
          musicSession: { ...session, generation: 2 },
        }}
      />,
    );
    expect(openDialog().getByRole('button', { name: '노래 3 신청 취소' })).toBeDisabled();
    expect(
      openDialog().getByText('연결을 확인하고 있어요. 연결 후 다시 이용해 주세요.'),
    ).toBeVisible();
  });
  it('debounces search, shows empty/error states and closes with focus restoration', async () => {
    const user = userEvent.setup();
    render(<ChatRoomScreen chat={chatState()} />);
    const trigger = screen.getByRole('button', { name: /음악 신청/ });
    await user.click(trigger);
    const search = openDialog().getByRole('searchbox');
    expect(search).toHaveFocus();
    vi.mocked(authenticatedFetchWithCurrentToken).mockImplementation(async (path) =>
      String(path).includes('requestable-music')
        ? musicResponse({ items: [], next_cursor: null })
        : musicResponse(queuePage()),
    );
    await user.type(search, '없는노래');
    await openDialog().findByText('검색 결과가 없어요. 다른 제목이나 가수로 찾아보세요.');
    const searches = vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.filter(([p]) => String(p).includes('requestable-music'));
    expect(searches).toHaveLength(1);
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse(null, 503));
    await user.click(openDialog().getByRole('button', { name: '검색' }));
    await openDialog().findByText(
      '음악 서비스에 잠시 연결할 수 없어요. 잠시 후 다시 확인해 주세요.',
    );
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
  it('keeps feature off compatible with ordinary chat and makes no music requests', async () => {
    vi.stubEnv('VITE_CHAT_MUSIC_QUEUE_ENABLED', 'false');
    const user = userEvent.setup();
    const chat = chatState();
    render(<ChatRoomScreen chat={chat} />);
    expect(screen.queryByRole('button', { name: /음악 신청/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '메시지' }), '/신청');
    await user.keyboard('{Enter}');
    expect(chat.send).toHaveBeenCalledWith('/신청');
    expect(authenticatedFetchWithCurrentToken).not.toHaveBeenCalled();
  });
});
