import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatMusicToast } from './ChatMusicToast';

const setup = () => {
  const modal = document.createElement('dialog');
  modal.open = true;
  document.body.append(modal);
  return {
    dialog: { current: modal },
    isOpen: true,
    notice: '',
    isCoolingDown: false,
    isVideoCoolingDown: false,
  };
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  document.querySelectorAll('dialog').forEach((node) => node.remove());
  vi.useRealTimers();
});
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}
it('shows all message sources for 5000ms without repeating unchanged active flags', async () => {
  const value = setup();
  value.isCoolingDown = true;
  value.isVideoCoolingDown = true;
  value.notice = '대기 중인 곡이 없어요. 먼저 곡을 신청해 주세요.';
  const { rerender } = render(<ChatMusicToast {...value} />, { wrapper: StrictMode });
  await flush();
  const toast = screen.getByRole('status');
  expect(toast).toHaveTextContent(value.notice);
  expect(toast).toHaveTextContent('영상 검색·신청');
  expect(toast).toHaveTextContent('잠시 후 다음 요청');
  expect(toast).not.toHaveAttribute('popover');
  expect(toast).toHaveAttribute('data-fallback', 'true');
  expect(toast).not.toHaveAttribute('tabindex');
  act(() => vi.advanceTimersByTime(4999));
  expect(toast).toHaveAttribute('data-visible', 'true');
  act(() => vi.advanceTimersByTime(1));
  expect(toast).toHaveAttribute('data-visible', 'false');
  rerender(<ChatMusicToast {...value} />);
  await flush();
  expect(toast).toHaveAttribute('data-visible', 'false');
  rerender(
    <ChatMusicToast {...value} notice="" isCoolingDown={false} isVideoCoolingDown={false} />,
  );
  rerender(<ChatMusicToast {...value} />);
  await flush();
  expect(toast).toHaveAttribute('data-visible', 'true');
});
it('keeps a short cooldown toast for full duration but cleans on close and does not replay on reopen', async () => {
  const value = setup();
  value.isCoolingDown = true;
  const { rerender, unmount } = render(<ChatMusicToast {...value} />);
  await flush();
  const toast = screen.getByRole('status');
  rerender(<ChatMusicToast {...value} isCoolingDown={false} />);
  await flush();
  expect(toast).toHaveAttribute('data-visible', 'true');
  rerender(<ChatMusicToast {...value} isOpen={false} />);
  expect(toast).toHaveAttribute('data-visible', 'false');
  rerender(<ChatMusicToast {...value} />);
  await flush();
  expect(toast).toHaveAttribute('data-visible', 'false');
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it('shows a fresh error occurrence and preserves full long text', async () => {
  const value = setup();
  value.notice = '긴 오류 안내 '.repeat(100);
  const { rerender } = render(<ChatMusicToast {...value} />);
  await flush();
  expect(screen.getByRole('status').textContent).toBe(value.notice);
  rerender(<ChatMusicToast {...value} notice="" />);
  rerender(<ChatMusicToast {...value} notice="다른 오류" />);
  await flush();
  expect(screen.getByRole('status')).toHaveTextContent('다른 오류');
});
