import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ChatMusicPlayerView } from './ChatMusicPlayerView';
import { loadYouTubeApi, type YouTubeOptions, type YouTubePlayer } from './youtubeIframe';
import { parsePlayback } from './chatMusicTypes';
import { queuePage, queueItem } from './chatMusicTestHelpers';
vi.mock('./youtubeIframe', () => ({ loadYouTubeApi: vi.fn() }));
let api: YouTubePlayer;
let options: YouTubeOptions;
let instances: number;
const playback = () => ({
  snapshot: parsePlayback({
    ...queuePage(),
    current: queueItem(99, 'PLAYING'),
    source_video_id: 'abcdefghijk',
    duration_millis: 120000,
    position_seconds: 10,
  })!,
  receivedAt: performance.now(),
});
beforeEach(() => {
  instances = 0;
  api = {
    loadVideoById: vi.fn(),
    cueVideoById: vi.fn(),
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    stopVideo: vi.fn(),
    seekTo: vi.fn(),
    getCurrentTime: () => 10,
    getPlayerState: () => 1,
    setVolume: vi.fn(),
    mute: vi.fn(),
    unMute: vi.fn(),
    destroy: vi.fn(),
  };
  class Player {
    constructor(element: HTMLElement, value: YouTubeOptions) {
      instances++;
      options = value;
      const iframe = document.createElement('iframe');
      iframe.title = 'fixture video';
      element.replaceWith(iframe);
      queueMicrotask(() => options.events.onReady({ target: api }));
      return api;
    }
  }
  vi.mocked(loadYouTubeApi).mockResolvedValue({
    Player: Player as unknown as import('./youtubeIframe').YouTubeApi['Player'],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('preserves the SDK iframe, local settings and commands through presentation hiding and reopening', async () => {
  const user = userEvent.setup();
  const value = playback();
  const command = vi.fn();
  const props = {
    playback: value,
    isReady: true,
    isCommandDisabled: false,
    onCommand: command,
    onRefresh: vi.fn(),
  };
  const view = (hidden: boolean) => (
    <div hidden={hidden}>
      <ChatMusicPlayerView {...props} />
    </div>
  );
  const { container, rerender } = render(view(false));
  await waitFor(() => expect(api.loadVideoById).toHaveBeenCalledTimes(1));
  const iframe = container.querySelector('iframe');
  expect(iframe?.closest('[inert]')).toHaveAttribute('aria-hidden', 'true');
  const modeGroup = screen.getByRole('group', { name: '플레이어 표시 방식' });
  const indicator = modeGroup.querySelector('.chat-room-view-indicator');
  expect(modeGroup.querySelectorAll('.chat-room-view-indicator')).toHaveLength(1);
  expect(indicator).toHaveAttribute('aria-hidden', 'true');
  expect(modeGroup).toHaveAttribute('data-presentation', 'album');
  const modeRow = container.querySelector('.chat-room-view-row');
  expect(container.querySelector('.chat-room-metadata-row')?.nextElementSibling).toBe(modeRow);
  expect(modeGroup.parentElement).toBe(modeRow);
  expect(modeRow?.nextElementSibling).toBe(container.querySelector('.chat-room-player-status'));
  expect(screen.getByTitle(value.snapshot.current!.title)).toHaveClass('scrolling-track-title');
  expect(screen.getByTitle(value.snapshot.current!.title)).not.toHaveClass(
    'scrolling-track-title--fade',
  );
  const slider = screen.getByRole('slider', { name: '내 음량' });
  expect(slider).toHaveAttribute('min', '0');
  expect(slider).toHaveAttribute('max', '100');
  expect(slider).toHaveAttribute('step', '1');
  const ticks = container.querySelector('.chat-room-volume-ticks');
  expect(ticks).toHaveAttribute('aria-hidden', 'true');
  expect(ticks?.querySelectorAll('span')).toHaveLength(5);
  fireEvent.change(screen.getByRole('slider', { name: '내 음량' }), { target: { value: '23' } });
  fireEvent.click(screen.getByRole('button', { name: '내 음소거' }));
  const initialCalls = vi.mocked(api.playVideo).mock.calls.length;
  const volumeCalls = vi.mocked(api.setVolume).mock.calls.length;
  expect(screen.getByRole('button', { name: '앨범 보기' })).toHaveAttribute('aria-pressed', 'true');
  const video = screen.getByRole('button', { name: '영상 보기' });
  video.focus();
  await user.keyboard('{Enter}');
  expect(video).toHaveAttribute('aria-pressed', 'true');
  expect(modeGroup).toHaveAttribute('data-presentation', 'video');
  expect(iframe?.closest('.chat-room-provider')).toHaveAttribute('inert');
  expect(iframe?.closest('.chat-room-provider')).toHaveAttribute('aria-hidden', 'true');
  expect(container.querySelector('.chat-room-video-shield')).not.toHaveAttribute('hidden');
  expect(container.querySelector('.chat-room-artwork')).toHaveAttribute('hidden');
  expect(container.querySelector('.chat-room-video-stage')).not.toBeNull();
  rerender(view(true));
  rerender(view(false));
  expect(container.querySelector('iframe')).toBe(iframe);
  expect(screen.getByRole('button', { name: '영상 보기' })).toHaveAttribute('aria-pressed', 'true');
  const album = screen.getByRole('button', { name: '앨범 보기' });
  album.focus();
  await user.keyboard(' ');
  expect(album).toHaveAttribute('aria-pressed', 'true');
  expect(modeGroup).toHaveAttribute('data-presentation', 'album');
  expect(modeGroup.querySelector('.chat-room-view-indicator')).toBe(indicator);
  expect(iframe?.closest('.chat-room-provider')).toHaveAttribute('inert');
  expect(iframe?.closest('.chat-room-provider')).toHaveAttribute('aria-hidden', 'true');
  expect(container.querySelector('.chat-room-artwork')).not.toHaveAttribute('hidden');
  expect(instances).toBe(1);
  expect(screen.getByRole('slider', { name: '내 음량' })).toHaveValue('23');
  expect(screen.getByRole('button', { name: '내 음소거' })).toHaveAttribute('aria-pressed', 'true');
  expect(api.loadVideoById).toHaveBeenCalledTimes(1);
  expect(api.cueVideoById).not.toHaveBeenCalled();
  expect(api.playVideo).toHaveBeenCalledTimes(initialCalls);
  expect(api.pauseVideo).not.toHaveBeenCalled();
  expect(api.destroy).not.toHaveBeenCalled();
  expect(api.seekTo).not.toHaveBeenCalled();
  expect(api.setVolume).toHaveBeenCalledTimes(volumeCalls);
  expect(command).not.toHaveBeenCalled();
});

it('renders finite readonly timeline and opaque safe fallback, keeping actionable errors', async () => {
  const timed = playback();
  timed.snapshot.current!.albumCoverUrl = 'javascript:alert(1)';
  const attention = vi.fn();
  const { container, rerender } = render(
    <ChatMusicPlayerView
      onAttentionChange={attention}
      playback={timed}
      isReady
      isCommandDisabled={false}
      onCommand={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
  await waitFor(() => expect(instances).toBe(1));
  expect(container.querySelector('.chat-room-album img')).toBeNull();
  expect(container.querySelector('.chat-room-empty-sleeve')).toBeNull();
  expect(screen.getByRole('progressbar', { name: '재생 위치' })).toHaveAttribute('max', '120');
  expect(screen.getAllByRole('slider')).toHaveLength(1);
  options.events.onError({ data: 150 });
  await screen.findByRole('alert');
  await waitFor(() =>
    expect(attention).toHaveBeenLastCalledWith(expect.stringContaining('재생할 수 없어요')),
  );
  expect(screen.getByRole('button', { name: 'YouTube 다시 연결' })).toBeEnabled();
  rerender(
    <ChatMusicPlayerView
      playback={{ ...timed, snapshot: { ...timed.snapshot, durationMillis: null } }}
      isReady
      isCommandDisabled={false}
      onCommand={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
  expect(container.querySelector('.chat-room-timeline')).toHaveTextContent('0:000:00');
});

it('shows the decorative branded sleeve only when there is no current track', () => {
  const props = { isReady: false, isCommandDisabled: true, onCommand: vi.fn(), onRefresh: vi.fn() };
  const { container, rerender } = render(<ChatMusicPlayerView {...props} playback={null} />);
  expect(container.querySelector('.chat-room-player-empty')).not.toBeNull();
  expect(container.querySelector('.chat-room-empty-sleeve .brand-mark')).not.toBeNull();
  expect(container.querySelector('.chat-room-empty-sleeve-label')).toHaveTextContent('MEOMUNEUM');
  expect(container.querySelector('.chat-room-album img')).toBeNull();
  expect(container.querySelector('.chat-room-album')).not.toHaveTextContent('♪');
  const current = playback();
  current.snapshot.current!.albumCoverUrl = 'https://example.com/cover.jpg';
  rerender(<ChatMusicPlayerView {...props} playback={current} />);
  expect(container.querySelector('.chat-room-player-empty')).toBeNull();
  expect(container.querySelector('.chat-room-empty-sleeve')).toBeNull();
  const image = container.querySelector('.chat-room-album img')!;
  expect(image).not.toBeNull();
  fireEvent.error(image);
  expect(container.querySelector('.chat-room-album')).toHaveTextContent('♪');
  expect(container.querySelector('.chat-room-empty-sleeve')).toBeNull();
  expect(api.loadVideoById).not.toHaveBeenCalled();
});

it('defaults to the album and disables video without a current track or playable video metadata', () => {
  const props = { isReady: true, isCommandDisabled: false, onCommand: vi.fn(), onRefresh: vi.fn() };
  const { rerender, container } = render(<ChatMusicPlayerView {...props} playback={null} />);
  expect(screen.getByRole('button', { name: '앨범 보기' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '영상 보기' })).toBeDisabled();
  expect(screen.getByText('곡을 신청하면 영상도 볼 수 있어요.')).toBeVisible();
  expect(container.querySelector('.scrolling-track-title')).toBeNull();
  expect(screen.getByText('곡을 신청하면 영상도 볼 수 있어요.').nextElementSibling).toBe(
    screen.getByRole('group', { name: '플레이어 표시 방식' }),
  );
  const value = playback();
  rerender(
    <ChatMusicPlayerView
      {...props}
      playback={{ ...value, snapshot: { ...value.snapshot, sourceVideoId: null } }}
    />,
  );
  expect(screen.getByRole('button', { name: '영상 보기' })).toBeDisabled();
  expect(screen.getByText('영상 정보가 준비되면 영상 보기를 사용할 수 있어요.')).toBeVisible();
  rerender(
    <ChatMusicPlayerView
      {...props}
      playback={{ ...value, snapshot: { ...value.snapshot, durationMillis: null } }}
    />,
  );
  expect(screen.getByRole('button', { name: '영상 보기' })).toBeDisabled();
  expect(container.querySelector('.chat-room-artwork')).not.toHaveAttribute('hidden');
  expect(container.querySelector('.chat-room-provider')).toHaveAttribute('inert');
  expect(instances).toBe(0);
  expect(props.onCommand).not.toHaveBeenCalled();
});

it('shares one high resolution artwork URL with the rotating circular LP label and falls back together', () => {
  const value = playback();
  value.snapshot.current!.albumCoverUrl =
    'https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg';
  const { container } = render(
    <ChatMusicPlayerView
      playback={value}
      isReady={false}
      isCommandDisabled
      onCommand={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
  const images = container.querySelectorAll('.chat-room-album img, .chat-room-record-label img');
  expect(images).toHaveLength(2);
  for (const image of images)
    expect(image).toHaveAttribute(
      'src',
      'https://is1-ssl.mzstatic.com/image/thumb/Music/680x680bb.jpg',
    );
  const label = container.querySelector('.chat-room-record-label img')!;
  expect(label.closest('.chat-room-vinyl')).not.toBeNull();
  fireEvent.error(label);
  expect(
    container.querySelectorAll('.chat-room-album img, .chat-room-record-label img'),
  ).toHaveLength(0);
  expect(container.querySelector('.chat-room-album')).toHaveTextContent('♪');
  expect(container.querySelector('.chat-room-empty-sleeve')).toBeNull();
});

it('marks only actual local playback as running and holds the disc for pause, buffering, and error', async () => {
  const { container } = render(
    <ChatMusicPlayerView
      playback={playback()}
      isReady
      isCommandDisabled={false}
      onCommand={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
  await waitFor(() => expect(api.loadVideoById).toHaveBeenCalledTimes(1));
  const disc = container.querySelector('.chat-room-vinyl')!;
  expect(disc).not.toHaveClass('is-playing');
  act(() => options.events.onStateChange({ data: 1 }));
  expect(disc).toHaveClass('is-playing');
  act(() => options.events.onStateChange({ data: 2 }));
  expect(disc).not.toHaveClass('is-playing');
  act(() => options.events.onStateChange({ data: 3 }));
  expect(disc).not.toHaveClass('is-playing');
  act(() => options.events.onStateChange({ data: 1 }));
  expect(disc).toHaveClass('is-playing');
  act(() => options.events.onError({ data: 150 }));
  expect(disc).not.toHaveClass('is-playing');
});
