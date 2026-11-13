import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatMusicVideoCandidateRow } from './ChatMusicVideoCandidateRow';
import { videoPage } from './chatMusicTestHelpers';
import { parseMusicVideos } from './chatMusicTypes';

let height = 50;
let notify: (() => void) | undefined;
const observe = vi.fn();
const disconnect = vi.fn();
beforeEach(() => {
  height = 50;
  vi.clearAllMocks();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(0, 0, 120, this.classList.contains('chat-music-item-text') ? height : 0);
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = observe;
      disconnect = disconnect;
      constructor(callback: ResizeObserverCallback) {
        notify = () => callback([], this as unknown as ResizeObserver);
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const props = () => ({
  video: parseMusicVideos(videoPage())!.items[0],
  cover: <span className="chat-music-cover">♪</span>,
  disabled: false,
  onSelect: vi.fn(),
});
it('matches measured metadata at50/68px and ignores hidden or invalid sizes, cleaning observers', () => {
  const { container, unmount } = render(
    <ul>
      <ChatMusicVideoCandidateRow {...props()} />
    </ul>,
  );
  const row = container.querySelector('li')!;
  expect(row.style.getPropertyValue('--chat-video-cover-size')).toBe('50px');
  height = 68;
  act(() => notify?.());
  expect(row.style.getPropertyValue('--chat-video-cover-size')).toBe('68px');
  height = 0;
  act(() => notify?.());
  expect(row.style.getPropertyValue('--chat-video-cover-size')).toBe('68px');
  height = Number.NaN;
  act(() => notify?.());
  expect(row.style.getPropertyValue('--chat-video-cover-size')).toBe('68px');
  expect(observe).toHaveBeenCalledWith(container.querySelector('.chat-music-item-text'));
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  height = 50;
  act(() => notify?.());
  expect(row.style.getPropertyValue('--chat-video-cover-size')).toBe('68px');
});
it('keeps full title without marquee and preserves request callback and disabled gate', () => {
  const value = props();
  const { container, rerender } = render(
    <ul>
      <ChatMusicVideoCandidateRow {...value} />
    </ul>,
  );
  expect(screen.getByTitle(value.video.title).tagName).toBe('STRONG');
  expect(container.querySelector('.scrolling-track-title')).toBeNull();
  expect(screen.getByTitle(value.video.channelTitle)).toHaveTextContent(value.video.channelTitle);
  fireEvent.click(screen.getByRole('button', { name: `${value.video.title} 영상 신청` }));
  expect(value.onSelect).toHaveBeenCalledOnce();
  rerender(
    <ul>
      <ChatMusicVideoCandidateRow {...value} disabled />
    </ul>,
  );
  expect(screen.getByRole('button')).toBeDisabled();
  fireEvent.click(screen.getByRole('button'));
  expect(value.onSelect).toHaveBeenCalledOnce();
});
it('uses resize fallback when ResizeObserver is unavailable', () => {
  vi.stubGlobal('ResizeObserver', undefined);
  const { container, unmount } = render(
    <ul>
      <ChatMusicVideoCandidateRow {...props()} />
    </ul>,
  );
  const row = container.querySelector('li')!;
  height = 68;
  fireEvent.resize(window);
  expect(row.style.getPropertyValue('--chat-video-cover-size')).toBe('68px');
  unmount();
  height = 50;
  fireEvent.resize(window);
  expect(row.style.getPropertyValue('--chat-video-cover-size')).toBe('68px');
});
