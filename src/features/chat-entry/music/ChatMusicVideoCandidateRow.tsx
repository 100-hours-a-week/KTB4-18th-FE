import type { ReactNode } from 'react';
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
  return (
    <li className="chat-music-item chat-music-video-item">
      {cover}
      <div className="chat-music-item-text">
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
