import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMusicSheetHeight } from './useMusicSheetHeight';

let playerHeight: number;
let resize: ResizeObserverCallback;
const disconnect = vi.fn();
function Fixture({ enabled = true, isOpen = true, playerTab = false }) {
  const ref = useRef<HTMLDialogElement>(null);
  useMusicSheetHeight(ref, isOpen, enabled);
  return (
    <dialog
      open={isOpen}
      ref={ref}
      className={playerTab ? 'chat-music-dialog chat-music-player-dialog' : 'chat-music-dialog'}
      style={{ borderWidth: 1 }}
    >
      <div className="chat-music-sheet" style={{ paddingTop: 12, paddingBottom: 40 }}>
        <div className="chat-music-drag-handle" />
        <header />
        <nav />
        <div className="chat-music-player-pane" hidden style={{ display: 'grid' }}>
          <div className="chat-room-player" />
        </div>
        <div className="chat-music-footer" />
      </div>
    </dialog>
  );
}
beforeEach(() => {
  playerHeight = 350;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const element = this as Element;
    const height = element.matches('.chat-room-player')
      ? element.closest('[data-music-measuring-album]') &&
        element.parentElement?.style.getPropertyPriority('display') === 'important'
        ? playerHeight
        : 0
      : element.matches('.chat-music-drag-handle')
        ? 16
        : element.matches('header')
          ? 36
          : element.matches('nav')
            ? 56
            : 0;
    return new DOMRect(0, 0, 350, height);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('measures the hidden album on direct search opening and restores the measuring state', () => {
  const { rerender } = render(<Fixture />);
  const dialog = screen.getByRole('dialog');
  expect(dialog.style.getPropertyValue('--music-album-height')).toBe('512px');
  expect(dialog).toHaveAttribute('data-music-album-height');
  rerender(<Fixture playerTab />);
  expect(dialog).toHaveAttribute('data-music-album-height');
  expect(dialog.style.getPropertyValue('--music-album-height')).toBe('512px');
  expect(dialog).not.toHaveAttribute('data-music-measuring-album');
  expect(dialog.querySelector('.chat-music-player-pane')).toHaveAttribute('hidden');
  expect(dialog.querySelector('.chat-music-player-pane')).toHaveStyle({ display: 'grid' });
  expect(
    (dialog.querySelector('.chat-music-player-pane') as HTMLElement).style.getPropertyPriority(
      'display',
    ),
  ).toBe('');
});
it('updates the natural reference after resize and removes observers and styles on close', () => {
  vi.useFakeTimers();
  const { rerender } = render(<Fixture />);
  const dialog = screen.getByRole('dialog');
  playerHeight = 400;
  act(() => {
    resize([], {} as ResizeObserver);
    vi.advanceTimersByTime(20);
  });
  expect(dialog.style.getPropertyValue('--music-album-height')).toBe('562px');
  rerender(<Fixture isOpen={false} />);
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(dialog.style.getPropertyValue('--music-album-height')).toBe('');
  expect(dialog).not.toHaveAttribute('data-music-album-height');
  vi.useRealTimers();
});
it('leaves the legacy feature-flag-off layout untouched', () => {
  render(<Fixture enabled={false} />);
  expect(screen.getByRole('dialog').style.getPropertyValue('--music-album-height')).toBe('');
  expect(screen.getByRole('dialog')).not.toHaveAttribute('data-music-album-height');
});
