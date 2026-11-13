import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatMusicFooter } from './ChatMusicFooter';
import type { MusicQueueState } from './chatMusicQueueController';

const props = () => ({
  isPlayer: true,
  count: '0',
  isReady: true,
  isMusicReady: true,
  feedback: { isCoolingDown: false, isMutating: false, pending: null } as Pick<
    MusicQueueState,
    'isCoolingDown' | 'isMutating' | 'pending'
  >,
  onSearch: vi.fn(),
  onQueue: vi.fn(),
  onRetry: vi.fn(),
});
afterEach(cleanup);
it('retains menu callbacks without descriptions, statuses or an empty focus stop', () => {
  const value = props();
  const { rerender } = render(<ChatMusicFooter {...value} />);
  fireEvent.click(screen.getByRole('button', { name: '＋ 음악 신청' }));
  fireEvent.click(screen.getByRole('button', { name: '대기열 0' }));
  expect(value.onSearch).toHaveBeenCalledOnce();
  expect(value.onQueue).toHaveBeenCalledOnce();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('region')).not.toHaveAttribute('tabindex');
  rerender(<ChatMusicFooter {...value} isPlayer={false} />);
  expect(screen.queryByText('신청한 곡은 대기 순서대로 재생돼요.')).toBeNull();
});
it.each([
  ['playback', '재생 요청 결과 다시 확인'],
  ['add', '신청 결과 다시 확인'],
  ['remove', '취소 결과 다시 확인'],
] as const)('retains %s pending action and readiness locks', (kind, label) => {
  const value = props();
  value.feedback.pending = {
    id: 'original-id',
    kind,
    action: 'PAUSE',
    queueItemId: 99,
    expectedVersion: 1,
    label: '공동 재생',
  } as NonNullable<typeof value.feedback.pending>;
  const { rerender } = render(<ChatMusicFooter {...value} />);
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(value.onRetry).toHaveBeenCalledOnce();
  rerender(<ChatMusicFooter {...value} isMusicReady={false} />);
  expect(screen.getByRole('button', { name: label })).toBeDisabled();
  value.feedback.isCoolingDown = true;
  rerender(<ChatMusicFooter {...value} />);
  expect(screen.getByRole('button', { name: label })).toBeDisabled();
  value.feedback.isMutating = true;
  rerender(<ChatMusicFooter {...value} />);
  expect(screen.queryByRole('button', { name: label })).toBeNull();
  expect(screen.queryByText('요청을 확인하고 있어요…')).toBeNull();
});
