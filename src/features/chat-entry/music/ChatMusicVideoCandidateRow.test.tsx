import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatMusicVideoCandidateRow } from './ChatMusicVideoCandidateRow';
import { videoPage } from './chatMusicTestHelpers';
import { parseMusicVideos } from './chatMusicTypes';

afterEach(cleanup);
const props = () => ({
  video: parseMusicVideos(videoPage())!.items[0],
  cover: <span className="chat-music-cover">♪</span>,
  disabled: false,
  onSelect: vi.fn(),
});
it.each(['입춘', '아주 긴 후보 영상 제목도 전체 텍스트를 유지합니다 '.repeat(4).trim()])(
  'keeps candidate title and supplied cover without marquee: %s',
  (title) => {
    const value = props();
    value.video = { ...value.video, title };
    const { container } = render(
      <ul>
        <ChatMusicVideoCandidateRow {...value} />
      </ul>,
    );
    expect(screen.getByTitle(title).tagName).toBe('STRONG');
    expect(screen.getByTitle(title)).toHaveTextContent(title.trim());
    expect(container.querySelector('.scrolling-track-title')).toBeNull();
    expect(container.querySelector('.chat-music-cover')).toHaveTextContent('♪');
    expect(screen.getByTitle(value.video.channelTitle)).toHaveTextContent(value.video.channelTitle);
    expect(screen.getByText('2:00')).toBeVisible();
  },
);
it('preserves request callback and disabled gate', () => {
  const value = props();
  const { rerender } = render(
    <ul>
      <ChatMusicVideoCandidateRow {...value} />
    </ul>,
  );
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
