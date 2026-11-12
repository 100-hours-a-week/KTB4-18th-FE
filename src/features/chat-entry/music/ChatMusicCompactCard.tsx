import { useState, type CSSProperties } from 'react';
import type { TimedPlayback } from './chatMusicPlayer';
import type { PlaybackAction } from './chatMusicApi';
import { getHighResolutionArtworkUrl } from '../../../shared/albumArtwork';
import './chatMusicCompactCard.css';

interface ChatMusicCompactCardProps {
  playback: TimedPlayback | null;
  hasQueuedTracks: boolean;
  isCommandDisabled: boolean;
  onOpen: () => void;
  onCommand: (action: PlaybackAction) => void;
}
export function ChatMusicCompactCard({
  playback,
  hasQueuedTracks,
  isCommandDisabled,
  onOpen,
  onCommand,
}: ChatMusicCompactCardProps) {
  const snapshot = playback?.snapshot;
  const track = snapshot?.current;
  const [failedCover, setFailedCover] = useState<string | null>(null);
  let safeCover: string | null = null;
  try {
    if (track?.albumCoverUrl) {
      const url = new URL(
        getHighResolutionArtworkUrl(track.albumCoverUrl)!,
        window.location.origin,
      );
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
        safeCover = url.href;
    }
  } catch {
    safeCover = null;
  }
  const cover = safeCover && failedCover !== safeCover ? safeCover : null;
  const canPlay = !!snapshot && (!!track || (snapshot.state === 'IDLE' && hasQueuedTracks));
  const action =
    snapshot?.state === 'PLAYING' ? 'PAUSE' : snapshot?.state === 'PAUSED' ? 'RESUME' : 'PLAY';
  const playLabel =
    action === 'PAUSE' ? '전체 일시정지' : action === 'RESUME' ? '전체 재개' : '전체 재생';
  return (
    <section
      className="chat-now-playing"
      aria-label="현재 방 음악"
      style={
        {
          '--chat-now-playing-artwork': cover ? `url(${JSON.stringify(cover)})` : 'none',
        } as CSSProperties
      }
    >
      <button
        type="button"
        className="chat-now-playing-metadata"
        onClick={onOpen}
        aria-label={
          track
            ? `${track.title} / ${track.artistName} 음악 플레이어 열기`
            : '음악 신청 플레이어 열기'
        }
      >
        {track ? (
          <>
            <span className="chat-now-playing-cover" aria-hidden="true">
              {cover ? (
                <img
                  src={cover}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setFailedCover(cover)}
                />
              ) : (
                <span>♪</span>
              )}
            </span>
            <span className="chat-now-playing-track">
              <strong title={track.title}>{track.title}</strong>
              <small title={track.artistName}>{track.artistName}</small>
            </span>
          </>
        ) : (
          <span className="chat-now-playing-empty">함께 들을 곡을 신청해 보세요</span>
        )}
      </button>
      <div className="chat-now-playing-controls" aria-label="방 전체 음악 조작">
        <button
          type="button"
          aria-label={playLabel}
          disabled={isCommandDisabled || !canPlay}
          onClick={() => onCommand(action)}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
            {action === 'PAUSE' ? (
              <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
            ) : (
              <path d="M6 3l16 9-16 9z" />
            )}
          </svg>
        </button>
        <button
          type="button"
          aria-label="다음 곡으로"
          disabled={isCommandDisabled || !track}
          onClick={() => onCommand('SKIP')}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
            <path d="M4 4l13 8-13 8zm14 0h3v16h-3z" />
          </svg>
        </button>
      </div>
    </section>
  );
}
