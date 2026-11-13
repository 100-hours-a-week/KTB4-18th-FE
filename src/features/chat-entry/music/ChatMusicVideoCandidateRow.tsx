import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { MusicVideoCandidate } from './chatMusicTypes';

interface ChatMusicVideoCandidateRowProps {
  video: MusicVideoCandidate;
  cover: ReactNode;
  disabled: boolean;
  onSelect: () => void;
}

export function ChatMusicVideoCandidateRow({
  video,
  cover,
  disabled,
  onSelect,
}: ChatMusicVideoCandidateRowProps) {
  const row = useRef<HTMLLIElement>(null);
  const metadata = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = row.current;
    const content = metadata.current;
    if (!element || !content) return;
    let active = true;
    const update = () => {
      if (!active) return;
      const height = content.getBoundingClientRect().height;
      if (!Number.isFinite(height) || height <= 0) return;
      const size = `${height}px`;
      if (element.style.getPropertyValue('--chat-video-cover-size') !== size)
        element.style.setProperty('--chat-video-cover-size', size);
    };
    update();
    const frame = requestAnimationFrame(update);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(content);
    if (!observer) window.addEventListener('resize', update);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [video.title, video.channelTitle]);

  return (
    <li ref={row} className="chat-music-item chat-music-video-item">
      {cover}
      <div ref={metadata} className="chat-music-item-text">
        <strong title={video.title}>{video.title}</strong>
        <span title={video.channelTitle}>{video.channelTitle}</span>
        <small>
          {Math.floor(video.durationMillis / 60000)}:
          {String(Math.floor(video.durationMillis / 1000) % 60).padStart(2, '0')}
        </small>
      </div>
      <button
        type="button"
        disabled={disabled}
        aria-label={`${video.title} 영상 신청`}
        onClick={onSelect}
      >
        신청
      </button>
    </li>
  );
}
