import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatMusicFooter } from './ChatMusicFooter';
import type { MusicQueueState } from './chatMusicQueueController';

const props = () => ({
  isMusicReady: true,
  feedback: { isCoolingDown: false, isMutating: false, pending: null } as Pick<
    MusicQueueState,
    'isCoolingDown' | 'isMutating' | 'pending'
  >,
  onRetry: vi.fn(),
});
afterEach(cleanup);
it('keeps only mutation recovery with no navigation or empty focus stop', () => {
  render(<ChatMusicFooter {...props()} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('region')).not.toHaveAttribute('tabindex');
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
