import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatMusicFooter } from './ChatMusicFooter';
import type { MusicQueueState } from './chatMusicQueueController';

const props = () => ({
  isPlayer: true,
  count: '0',
  isReady: true,
  isMusicReady: true,
  feedback: {
    isVideoCoolingDown: false,
    isCoolingDown: false,
    isMutating: false,
    pending: null,
  } as Pick<MusicQueueState, 'isVideoCoolingDown' | 'isCoolingDown' | 'isMutating' | 'pending'>,
  notice: '',
  onSearch: vi.fn(),
  onQueue: vi.fn(),
  onRetry: vi.fn(),
});
afterEach(cleanup);
it('always reserves feedback structure without creating an empty status or focus stop', () => {
  const value = props();
  const { container } = render(<ChatMusicFooter {...value} />);
  expect(container.querySelector('.chat-music-feedback')).toBeEmptyDOMElement();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('region', { name: '음악 신청 상태' })).not.toHaveAttribute('tabindex');
  fireEvent.click(screen.getByRole('button', { name: '＋ 음악 신청' }));
  fireEvent.click(screen.getByRole('button', { name: '대기열 0' }));
  expect(value.onSearch).toHaveBeenCalledTimes(1);
  expect(value.onQueue).toHaveBeenCalledTimes(1);
});
it('preserves full long feedback and explicit retry locks in the keyboard-accessible footer', () => {
  const value = props();
  value.notice = '긴 오류 안내 https://example.test/very-long-path '.repeat(20);
  value.feedback.isVideoCoolingDown = true;
  value.feedback.pending = {
    id: 'original-id',
    kind: 'playback',
    action: 'PAUSE',
    queueItemId: 99,
    expectedVersion: 1,
    label: '공동 재생',
  };
  const { rerender } = render(<ChatMusicFooter {...value} />);
  expect(screen.getByRole('region', { name: '음악 신청 상태' })).toHaveAttribute('tabindex', '0');
  expect(screen.getByText(value.notice.trim().replace(/\s+/g, ' '))).toBeVisible();
  expect(screen.getByText('영상 검색·신청은 잠시 후 다시 이용해 주세요.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '재생 요청 결과 다시 확인' }));
  expect(value.onRetry).toHaveBeenCalledTimes(1);
  rerender(<ChatMusicFooter {...value} isMusicReady={false} />);
  expect(screen.getByRole('button', { name: '재생 요청 결과 다시 확인' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '재생 요청 결과 다시 확인' }));
  expect(value.onRetry).toHaveBeenCalledTimes(1);
});
it('targets only the empty-queue alignment class while retaining all other notices', () => {
  const value = props();
  const { rerender } = render(
    <ChatMusicFooter {...value} notice="대기 중인 곡이 없어요. 먼저 곡을 신청해 주세요." />,
  );
  expect(screen.getByRole('status')).toHaveClass('chat-music-empty-queue-notice');
  rerender(<ChatMusicFooter {...value} notice="권한을 확인해 주세요." />);
  expect(screen.getByRole('status')).not.toHaveClass('chat-music-empty-queue-notice');
});
