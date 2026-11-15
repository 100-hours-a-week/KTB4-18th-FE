import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatMusicCompactCard } from './ChatMusicCompactCard';
import { parsePlayback } from './chatMusicTypes';
import { queueItem, queuePage } from './chatMusicTestHelpers';
import type { TimedPlayback } from './chatMusicPlayer';

const playback = (state: 'IDLE' | 'PLAYING' | 'PAUSED' = 'PLAYING'): TimedPlayback => ({
  snapshot: parsePlayback({
    ...queuePage(),
    state,
    current: state === 'IDLE' ? null : queueItem(99, 'PLAYING'),
  })!,
  receivedAt: performance.now(),
});
const props = () => ({
  playback: playback(),
  hasQueuedTracks: true,
  isCommandDisabled: false,
  onOpen: vi.fn(),
  onCommand: vi.fn(),
});
afterEach(cleanup);

it('renders current metadata and routes separate native controls to the existing callbacks', () => {
  const value = props();
  const { container } = render(<ChatMusicCompactCard {...value} />);
  const card = within(screen.getByRole('region', { name: '현재 방 음악' }));
  expect(card.getByText('노래 99')).toBeVisible();
  expect(card.getByText('가수 99')).toBeVisible();
  fireEvent.click(card.getByRole('button', { name: '노래 99 / 가수 99 음악 플레이어 열기' }));
  expect(value.onOpen).toHaveBeenCalledTimes(1);
  expect(value.onCommand).not.toHaveBeenCalled();
  fireEvent.click(card.getByRole('button', { name: '전체 일시정지' }));
  fireEvent.click(card.getByRole('button', { name: '다음 곡으로' }));
  expect(value.onCommand.mock.calls).toEqual([['PAUSE'], ['SKIP']]);
  expect(container.querySelector('button button')).toBeNull();
  expect(container.querySelector('iframe')).toBeNull();
});
it.each([
  ['PLAYING', '전체 일시정지', 'PAUSE'],
  ['PAUSED', '전체 재개', 'RESUME'],
  ['IDLE', '전체 재생', 'PLAY'],
] as const)('uses room snapshot %s for action semantics', (state, label, action) => {
  const value = { ...props(), playback: playback(state) };
  render(<ChatMusicCompactCard {...value} />);
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(value.onCommand).toHaveBeenCalledWith(action);
});
it('shows one empty prompt and permits starting queued tracks without inventing a current song', () => {
  const value = { ...props(), playback: playback('IDLE') };
  const { container, rerender } = render(<ChatMusicCompactCard {...value} />);
  expect(screen.getAllByText("'/신청'을 입력해서 이 지역에서의 음악을 신청해보세요")).toHaveLength(
    1,
  );
  expect(container.querySelector('.chat-now-playing-cover')).toBeNull();
  expect(container.querySelector('strong, small')).toBeNull();
  expect(screen.getByRole('button', { name: '전체 재생' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '다음 곡으로' })).toBeDisabled();
  rerender(<ChatMusicCompactCard {...value} hasQueuedTracks={false} />);
  fireEvent.click(screen.getByRole('button', { name: '전체 재생' }));
  expect(screen.getByRole('button', { name: '전체 재생' })).toBeDisabled();
  expect(value.onCommand).not.toHaveBeenCalled();
});
it('keeps metadata navigation available while readiness or mutation locks disable both commands', () => {
  const value = { ...props(), isCommandDisabled: true };
  render(<ChatMusicCompactCard {...value} />);
  fireEvent.click(screen.getByRole('button', { name: '전체 일시정지' }));
  fireEvent.click(screen.getByRole('button', { name: '다음 곡으로' }));
  expect(value.onCommand).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /음악 플레이어 열기/ }));
  expect(value.onOpen).toHaveBeenCalledTimes(1);
});
it.each([
  'javascript:alert(1)',
  'https://user:password@example.com/cover.jpg',
  'data:image/svg+xml,unsafe',
])('rejects unsafe artwork %s', (url) => {
  const value = props();
  value.playback.snapshot.current!.albumCoverUrl = url;
  const { container } = render(<ChatMusicCompactCard {...value} />);
  expect(container.querySelector('img')).toBeNull();
  expect(
    container.querySelector('section')?.style.getPropertyValue('--chat-now-playing-artwork'),
  ).toBe('none');
  expect(screen.getByText('노래 99')).toBeVisible();
});
it('uses safe artwork for the blurred background and clears it on image failure', () => {
  const value = props();
  value.playback.snapshot.current!.albumCoverUrl = 'https://example.com/cover.jpg';
  const { container } = render(<ChatMusicCompactCard {...value} />);
  const image = container.querySelector('img')!;
  expect(
    container.querySelector('section')?.style.getPropertyValue('--chat-now-playing-artwork'),
  ).toContain('https://example.com/cover.jpg');
  fireEvent.error(image);
  expect(container.querySelector('img')).toBeNull();
  expect(
    container.querySelector('section')?.style.getPropertyValue('--chat-now-playing-artwork'),
  ).toBe('none');
});
it('retains full long Korean and English metadata in the accessible name', () => {
  const value = props();
  const title = '아주 긴 한국어 제목 A long song title '.repeat(10).trim();
  value.playback.snapshot.current!.title = title;
  render(<ChatMusicCompactCard {...value} />);
  expect(
    screen.getByRole('button', { name: `${title} / 가수 99 음악 플레이어 열기` }),
  ).toBeEnabled();
  expect(screen.getByTitle(title)).toBeVisible();
});

it('reuses the music-record 680px artwork for compact cover and background', () => {
  const value = props();
  value.playback.snapshot.current!.albumCoverUrl =
    'https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg';
  const { container } = render(<ChatMusicCompactCard {...value} />);
  expect(container.querySelector('img')).toHaveAttribute(
    'src',
    'https://is1-ssl.mzstatic.com/image/thumb/Music/680x680bb.jpg',
  );
  expect(
    container.querySelector('section')?.style.getPropertyValue('--chat-now-playing-artwork'),
  ).toContain('680x680bb');
});

it('uses the active region only in the empty mini guidance', () => {
  const { rerender } = render(
    <ChatMusicCompactCard {...props()} playback={playback('IDLE')} regionName="성남시 분당구" />,
  );
  expect(
    screen.getByText("'/신청'을 입력해서 성남시 분당구에서의 음악을 신청해보세요"),
  ).toBeVisible();
  rerender(<ChatMusicCompactCard {...props()} regionName="성남시 분당구" />);
  expect(screen.queryByText(/입력해서/)).toBeNull();
  expect(screen.getByText('노래 99')).toBeVisible();
});
