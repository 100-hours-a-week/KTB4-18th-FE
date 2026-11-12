import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ChatRoomScreen } from '../components/ChatEntryPage';
import { useChatParticipation } from '../hooks/useChatParticipation';
import { authenticatedFetchWithCurrentToken } from '../../auth-login/api/authSession';
import {
  added,
  videoPage,
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
  vi.stubEnv('VITE_CHAT_MUSIC_PLAYER_ENABLED', 'false');
  auth.token = musicToken();
  version = 1;
  items = [queueItem(1)];
  vi.mocked(authenticatedFetchWithCurrentToken).mockImplementation(async (path, init) => {
    if (String(path).includes('video-searches')) return musicResponse(videoPage());
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
async function openMusicSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: '메시지' }), '/신청');
  await user.keyboard('{Enter}');
}

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
    await openDialog().findByRole('button', { name: '노래 1 영상 선택' });
    expect(openDialog().getAllByText('지역 기록')).toHaveLength(2);
    expect(openDialog().getAllByText('내 추천')).toHaveLength(2);
    await user.click(openDialog().getByRole('button', { name: '노래 1 영상 선택' }));
    const add = await openDialog().findByRole('button', { name: '영상 1 영상 신청' });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(openDialog().queryByText('요청을 확인하고 있어요…')).toBeNull());
    expect(openDialog().queryByText('곡 신청을 확인했어요.')).toBeNull();
    expect(
      vi
        .mocked(authenticatedFetchWithCurrentToken)
        .mock.calls.filter(
          ([path, i]) => i?.method === 'POST' && String(path).includes('queue-items'),
        ),
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
    await openMusicSearch(user);
    await user.click(openDialog().getByRole('button', { name: '대기열' }));
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
    await openMusicSearch(user);
    await openDialog().findByRole('button', { name: '노래 1 영상 선택' });
    await user.click(openDialog().getByRole('button', { name: '노래 1 영상 선택' }));
    await openDialog().findByRole('button', { name: '영상 1 영상 신청' });
    vi.mocked(authenticatedFetchWithCurrentToken).mockRejectedValueOnce(
      new TypeError('synthetic lost response'),
    );
    await user.click(openDialog().getByRole('button', { name: '영상 1 영상 신청' }));
    await openDialog().findByRole('button', { name: '신청 결과 다시 확인' });
    expect(openDialog().getByRole('button', { name: '영상 2 영상 신청' })).toBeDisabled();
    await user.click(openDialog().getByRole('button', { name: '신청 결과 다시 확인' }));
    await waitFor(() =>
      expect(
        openDialog().queryByRole('button', { name: '신청 결과 다시 확인' }),
      ).not.toBeInTheDocument(),
    );
    const writes = vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.filter(
        ([path, i]) => i?.method === 'POST' && String(path).includes('queue-items'),
      );
    expect(writes).toHaveLength(2);
    expect(writes[0][1]?.headers).toEqual(writes[1][1]?.headers);
  });
  it('refreshes queue on another Task event and disables actions while reconnecting', async () => {
    const user = userEvent.setup();
    const chat = chatState();
    const { rerender } = render(<ChatRoomScreen chat={chat} />);
    await openMusicSearch(user);
    await user.click(openDialog().getByRole('button', { name: '대기열' }));
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
    const trigger = screen.getByRole('textbox', { name: '메시지' });
    await openMusicSearch(user);
    const search = openDialog().getByRole('searchbox');
    expect(search).not.toHaveFocus();
    expect(openDialog().getByRole('button', { name: '음악 창 닫기' })).toHaveFocus();
    vi.mocked(authenticatedFetchWithCurrentToken).mockImplementation(async (path) =>
      String(path).includes('requestable-music')
        ? musicResponse({ items: [], next_cursor: null })
        : musicResponse(queuePage()),
    );
    await user.type(search, '없는노래');
    await openDialog().findByText('검색 결과가 없어요. 다른 제목이나 가수로 찾아보세요.');
    const searches = vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.filter(
        ([p]) =>
          String(p).includes('requestable-music') &&
          String(p).includes(encodeURIComponent('없는노래')),
      );
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
    expect(screen.queryByRole('button', { name: '음악 플레이어 열기' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '메시지' }), '/신청');
    await user.keyboard('{Enter}');
    expect(chat.send).toHaveBeenCalledWith('/신청');
    expect(authenticatedFetchWithCurrentToken).not.toHaveBeenCalled();
  });
});

it('keeps request actions disabled on permission failure and revalidates only on explicit music retry', async () => {
  const user = userEvent.setup();
  vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(
    musicResponse({ code: 'CHAT_VIEW_NOT_CONNECTED' }, 403),
  );
  render(<ChatRoomScreen chat={chatState()} />);
  await waitFor(() =>
    expect(screen.getByRole('region', { name: '이야기방 음악' })).toHaveAccessibleDescription(
      expect.stringContaining('현재 이야기방 참여와 음악 이용 권한을 확인해 주세요.'),
    ),
  );
  await openMusicSearch(user);
  const dialog = openDialog();
  await waitFor(() =>
    expect(dialog.getByRole('button', { name: '노래 1 영상 선택' })).toBeDisabled(),
  );
  await user.click(dialog.getByRole('button', { name: '음악 상태 다시 확인' }));
  await waitFor(() =>
    expect(screen.queryByText('현재 이야기방 참여와 음악 이용 권한을 확인해 주세요.')).toBeNull(),
  );
  await waitFor(() =>
    expect(openDialog().getByRole('button', { name: '노래 1 영상 선택' })).toBeEnabled(),
  );
  expect(
    vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toEqual([]);
});

it('does not let a late native close event dismiss a reopened music request dialog', async () => {
  const user = userEvent.setup();
  render(<ChatRoomScreen chat={chatState()} />);
  const input = screen.getByRole('textbox', { name: '메시지' });
  await user.type(input, '/신청');
  await user.keyboard('{Enter}');
  await user.click(openDialog().getByRole('button', { name: '음악 창 닫기' }));
  await user.type(input, '/신청 다시');
  await user.keyboard('{Enter}');
  const reopened = screen.getByRole('dialog');
  expect(reopened).toHaveAttribute('open');
  fireEvent(reopened, new Event('close'));
  expect(screen.getByRole('dialog')).toHaveAttribute('open');
});

it('lists unregistered regional music without typing and restores the list after choosing videos', async () => {
  const user = userEvent.setup();
  vi.mocked(authenticatedFetchWithCurrentToken).mockImplementation(async (path, init) => {
    if (String(path).includes('requestable-music'))
      return musicResponse({
        items: [
          { ...candidate(), youtube_video_id: null, duration_millis: null, is_queueable: false },
        ],
        next_cursor: null,
      });
    if (String(path).includes('video-searches')) return musicResponse(videoPage());
    if (init?.method === 'POST') return musicResponse(added(), 201);
    return musicResponse(queuePage());
  });
  render(<ChatRoomScreen chat={chatState()} />);
  await openMusicSearch(user);
  const choose = await openDialog().findByRole('button', { name: '노래 1 영상 선택' });
  expect(openDialog().getByRole('searchbox')).not.toHaveFocus();
  const list = openDialog().getByLabelText('지역 음악 목록');
  list.scrollTop = 200;
  await user.click(choose);
  await openDialog().findByRole('button', { name: '영상 1 영상 신청' });
  expect(openDialog().getByText(/공식 여부 미확인/)).toBeVisible();
  expect(openDialog().getByText(/공식 확인/)).toBeVisible();
  await user.click(openDialog().getByRole('button', { name: '← 지역 음악' }));
  await waitFor(() =>
    expect(openDialog().getByRole('button', { name: '노래 1 영상 선택' })).toHaveFocus(),
  );
  expect(openDialog().getByLabelText('지역 음악 목록').scrollTop).toBe(200);
  expect(
    vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.filter(([p]) => String(p).includes('requestable-music')),
  ).toHaveLength(1);
});

it('distinguishes an empty candidate result from a failed video search and retries explicitly', async () => {
  const user = userEvent.setup();
  let attempts = 0;
  vi.mocked(authenticatedFetchWithCurrentToken).mockImplementation(async (path) => {
    if (String(path).includes('requestable-music'))
      return musicResponse({ items: [candidate()], next_cursor: null });
    if (String(path).includes('video-searches')) {
      attempts++;
      if (attempts === 1) return musicResponse(null, 503);
      const page = videoPage();
      return musicResponse({ ...page, result_kind: 'EMPTY', items: [] });
    }
    return musicResponse(queuePage());
  });
  render(<ChatRoomScreen chat={chatState()} />);
  await openMusicSearch(user);
  await user.click(await openDialog().findByRole('button', { name: '노래 1 영상 선택' }));
  await openDialog().findByRole('alert');
  expect(openDialog().queryByText('신청할 수 있는 영상을 찾지 못했어요.')).toBeNull();
  await user.click(openDialog().getByRole('button', { name: '영상 다시 찾기' }));
  await openDialog().findByText('신청할 수 있는 영상을 찾지 못했어요.');
  expect(attempts).toBe(2);
});

it('keeps one mounted player across mini entry, request, queue and final close without a UI command', async () => {
  vi.stubEnv('VITE_CHAT_MUSIC_PLAYER_ENABLED', 'true');
  const user = userEvent.setup();
  const { container } = render(<ChatRoomScreen chat={chatState()} />);
  const player = container.querySelector('.chat-room-player');
  const mini = within(screen.getByRole('region', { name: '현재 방 음악' })).getByRole('button', {
    name: /플레이어 열기$/,
  });
  expect(container.querySelector('.chat-music-fab')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(mini);
  expect(openDialog().getByRole('region', { name: '공동 음악 재생' })).toBe(player);
  await user.click(openDialog().getByRole('button', { name: '＋ 음악 신청' }));
  expect(openDialog().getByRole('searchbox')).toBeVisible();
  await user.click(openDialog().getByRole('button', { name: '대기열' }));
  await user.click(openDialog().getByRole('button', { name: '플레이어' }));
  expect(openDialog().getByRole('region', { name: '공동 음악 재생' })).toBe(player);
  await user.click(openDialog().getByRole('button', { name: '음악 창 닫기' }));
  expect(mini).toHaveFocus();
  expect(container.querySelector('.chat-room-player')).toBe(player);
  await user.click(mini);
  expect(openDialog().getByRole('region', { name: '공동 음악 재생' })).toBe(player);
  expect(container.querySelectorAll('dialog')).toHaveLength(1);
  expect(
    vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(0);
});

it.each([
  { openerState: 'detached', playerEnabled: false, isMiniDisabled: false },
  { openerState: 'detached', playerEnabled: true, isMiniDisabled: false },
  { openerState: 'disabled', playerEnabled: true, isMiniDisabled: false },
  { openerState: 'detached', playerEnabled: true, isMiniDisabled: true },
])(
  'restores usable focus with $openerState opener, player=$playerEnabled and mini disabled=$isMiniDisabled',
  async ({ openerState, playerEnabled, isMiniDisabled }) => {
    vi.stubEnv('VITE_CHAT_MUSIC_PLAYER_ENABLED', String(playerEnabled));
    const user = userEvent.setup();
    const { container } = render(<ChatRoomScreen chat={chatState()} />);
    const composer = screen.getByRole('textbox', { name: '메시지' });
    const mini = container.querySelector<HTMLButtonElement>('.chat-now-playing-metadata');
    expect(container.querySelector('.chat-music-fab')).toBeNull();
    const opener = document.createElement('button');
    opener.textContent = 'temporary opener';
    document.body.append(opener);
    try {
      opener.focus();
      fireEvent.change(composer, { target: { value: '/신청' } });
      fireEvent.keyDown(composer, { key: 'Enter' });
      expect(openDialog().getByRole('button', { name: '음악 창 닫기' })).toHaveFocus();
      if (openerState === 'detached') opener.remove();
      else opener.disabled = true;
      if (isMiniDisabled) mini?.setAttribute('disabled', '');
      await user.click(openDialog().getByRole('button', { name: '음악 창 닫기' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(playerEnabled && !isMiniDisabled ? mini : composer).toHaveFocus();
      expect(opener).not.toHaveFocus();
    } finally {
      opener.remove();
    }
  },
);

it('places the compact card directly after the header and shares the existing player and command controller', async () => {
  vi.stubEnv('VITE_CHAT_MUSIC_PLAYER_ENABLED', 'true');
  const user = userEvent.setup();
  vi.mocked(authenticatedFetchWithCurrentToken).mockImplementation(async () =>
    musicResponse(queuePage()),
  );
  const { container } = render(<ChatRoomScreen chat={chatState()} />);
  const card = within(screen.getByRole('region', { name: '현재 방 음악' }));
  expect(container.querySelector('.chat-entry-header')?.nextElementSibling).toBe(
    container.querySelector('.chat-music'),
  );
  await card.findByText('노래 99');
  const player = container.querySelector('.chat-room-player');
  expect(container.querySelectorAll('.chat-room-player')).toHaveLength(1);
  await user.click(card.getByRole('button', { name: '노래 99 / 가수 99 음악 플레이어 열기' }));
  expect(openDialog().getByRole('region', { name: '공동 음악 재생' })).toBe(player);
  await user.click(openDialog().getByRole('button', { name: '음악 창 닫기' }));
  expect(card.getByRole('button', { name: /음악 플레이어 열기/ })).toHaveFocus();
  expect(container.querySelector('.chat-room-player')).toBe(player);
  expect(
    vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(0);
  await waitFor(() => expect(card.getByRole('button', { name: '전체 일시정지' })).toBeEnabled());
  await user.click(card.getByRole('button', { name: '전체 일시정지' }));
  await waitFor(() =>
    expect(
      vi
        .mocked(authenticatedFetchWithCurrentToken)
        .mock.calls.filter(
          ([path, init]) => String(path).includes('playback/commands') && init?.method === 'POST',
        ),
    ).toHaveLength(1),
  );
  const [, init] = vi
    .mocked(authenticatedFetchWithCurrentToken)
    .mock.calls.find(
      ([path, init]) => String(path).includes('playback/commands') && init?.method === 'POST',
    )!;
  expect(JSON.parse(String(init?.body))).toEqual({
    action: 'PAUSE',
    queue_item_id: 99,
    expected_version: 1,
  });
});

it('shows all fifty candidates and submits the last selected video without another search', async () => {
  const page = videoPage(1, 50);
  vi.mocked(authenticatedFetchWithCurrentToken).mockImplementation(async (path, init) => {
    if (String(path).includes('video-searches')) return musicResponse(page);
    if (init?.method === 'POST') return musicResponse(added(1, 'WAITING', ++version), 201);
    if (String(path).includes('requestable-music'))
      return musicResponse({ items: [candidate()], next_cursor: null });
    return musicResponse(queuePage(version, items));
  });
  const user = userEvent.setup();
  render(<ChatRoomScreen chat={chatState()} />);
  await openMusicSearch(user);
  await user.click(await openDialog().findByRole('button', { name: '노래 1 영상 선택' }));
  await openDialog().findByRole('button', { name: '영상 50 영상 신청' });
  expect(openDialog().getAllByRole('button', { name: /영상 신청$/ })).toHaveLength(50);
  await user.click(openDialog().getByRole('button', { name: '영상 50 영상 신청' }));
  await waitFor(() => {
    const request = vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.find(
        ([path, init]) => String(path).includes('/queue-items') && init?.method === 'POST',
      );
    expect(request).toBeDefined();
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      music_id: 1,
      candidate_id: page.items[49].candidate_id,
    });
  });
  expect(
    vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.filter(([path]) => String(path).includes('video-searches')),
  ).toHaveLength(1);
});
