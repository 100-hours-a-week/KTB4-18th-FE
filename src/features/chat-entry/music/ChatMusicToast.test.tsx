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
it.each(['대기 중인 곡이 없어요. 먼저 곡을 신청해 주세요.', '음악 신청 성공했습니다'])(
  'shows %s for 5000ms and permits a fresh repeated occurrence',
  async (notice) => {
    const value = setup();
    value.isCoolingDown = true;
    value.isVideoCoolingDown = true;
    value.notice = notice;
    const { rerender } = render(<ChatMusicToast {...value} />, { wrapper: StrictMode });
    await flush();
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent(value.notice);
    expect(toast).toHaveTextContent('영상 검색·신청');
    expect(toast).not.toHaveTextContent('잠시 후 다음 요청을 보낼 수 있어요.');
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
  },
);
it('keeps a short video cooldown toast for full duration but cleans on close and does not replay on reopen', async () => {
  const value = setup();
  value.isVideoCoolingDown = true;
  const { rerender, unmount } = render(<ChatMusicToast {...value} />);
  await flush();
  const toast = screen.getByRole('status');
  rerender(<ChatMusicToast {...value} isVideoCoolingDown={false} />);
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

it('never displays the exact generic cooldown from either flag or notice', async () => {
  const value = setup();
  const { rerender } = render(
    <ChatMusicToast {...value} isCoolingDown notice="잠시 후 다음 요청을 보낼 수 있어요." />,
  );
  await flush();
  expect(screen.getByRole('status', { hidden: true })).toHaveAttribute('data-visible', 'false');
  expect(screen.getByRole('status', { hidden: true })).toBeEmptyDOMElement();
  rerender(
    <ChatMusicToast
      {...value}
      isCoolingDown
      isVideoCoolingDown
      notice="잠시 후 다음 요청을 보낼 수 있어요."
    />,
  );
  await flush();
  expect(screen.getByRole('status')).toHaveTextContent(
    '영상 검색·신청은 잠시 후 다시 이용해 주세요.',
  );
  expect(screen.getByRole('status')).not.toHaveTextContent('잠시 후 다음 요청을 보낼 수 있어요.');
});
