import { ScrollingTrackTitle } from '../../../components/ScrollingTrackTitle';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { ChatMusicPlayer, type TimedPlayback } from './chatMusicPlayer';
import type { PlaybackAction } from './chatMusicApi';
import { getHighResolutionArtworkUrl } from '../../../shared/albumArtwork';
import './chatMusicPlayer.css';

interface ChatMusicPlayerViewProps {
  playback: TimedPlayback | null;
  isReady: boolean;
  isCommandDisabled: boolean;
  onCommand: (action: PlaybackAction) => void;
  onRefresh: () => void;
  onAttentionChange?: (message: string) => void;
}
export function ChatMusicPlayerView({
  playback,
  isReady,
  isCommandDisabled,
  onCommand,
  onRefresh,
  onAttentionChange,
}: ChatMusicPlayerViewProps) {
  const [player] = useState(() => new ChatMusicPlayer());
  const state = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (container.current) player.mount(container.current);
    return () => player.dispose();
  }, [player]);
  useEffect(() => {
    player.update(playback, isReady);
  }, [player, playback, isReady]);
  useEffect(() => {
    onAttentionChange?.(
      ['blocked', 'error'].includes(state.status)
        ? state.message ||
            (state.status === 'blocked'
              ? '브라우저 재생 허용이 필요해요.'
              : '음악 재생을 확인해 주세요.')
        : '',
    );
  }, [onAttentionChange, state.message, state.status]);
  const s = playback?.snapshot;
  const labels = {
    waiting: '대기 중',
    loading: '재생 준비 중',
    playing: '내 기기에서 재생 중',
    paused: '내 기기에서 일시정지',
    buffering: '버퍼링 중',
    blocked: '자동재생 차단',
    error: '재생 오류',
  };
  const hasTrack = !!s?.current;
  const [presentation, setPresentation] = useState<'album' | 'video'>('album');
  const hasVideo =
    hasTrack &&
    /^[A-Za-z0-9_-]{11}$/.test(s?.sourceVideoId ?? '') &&
    Number.isFinite(s?.durationMillis) &&
    (s?.durationMillis ?? 0) > 0;
  const isVideo = presentation === 'video' && hasVideo;
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const cover = getHighResolutionArtworkUrl(s?.current?.albumCoverUrl ?? null);
  let safeCover: string | null = null;
  try {
    if (cover) {
      const url = new URL(cover, window.location.origin);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password)
        safeCover = url.href;
    }
  } catch {
    safeCover = null;
  }
  const duration = Number.isFinite(s?.durationMillis)
    ? Math.max(0, (s?.durationMillis ?? 0) / 1000)
    : 0;
  const position = Number.isFinite(state.position)
    ? Math.min(duration, Math.max(0, state.position))
    : 0;
  return (
    <section
      className={`chat-room-player${hasTrack ? '' : ' chat-room-player-empty'}`}
      aria-label="공동 음악 재생"
    >
      <div className={`chat-room-artwork-stage${isVideo ? ' chat-room-video-stage' : ''}`}>
        <div className="chat-room-provider" inert aria-hidden="true">
          <div ref={container} className="chat-room-youtube" />
        </div>
        <div className="chat-room-video-shield" hidden={!isVideo} aria-hidden="true" />
        <div className="chat-room-artwork" aria-hidden="true" hidden={isVideo}>
          <div className={`chat-room-vinyl${state.status === 'playing' ? ' is-playing' : ''}`}>
            <span className="chat-room-record-label">
              {safeCover && failedCover !== cover && (
                <img
                  src={safeCover}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setFailedCover(cover ?? null)}
                />
              )}
            </span>
          </div>
          <div className="chat-room-album">
            {!hasTrack ? (
              <div className="chat-room-empty-sleeve">
                <span className="brand-mark" />
                <span className="chat-room-empty-sleeve-label">MEOMUNEUM</span>
              </div>
            ) : safeCover && failedCover !== cover ? (
              <img
                src={safeCover}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setFailedCover(cover ?? null)}
              />
            ) : (
              <span>♪</span>
            )}
          </div>
        </div>
      </div>
      <div className="chat-room-timeline">
        <span>{formatPosition(position)}</span>
        <progress aria-label="재생 위치" max={duration || 1} value={position} />
        <span>{formatPosition(duration)}</span>
      </div>
      <div className="chat-room-metadata-row">
        <div className="chat-room-player-heading">
          <div className="chat-room-player-track">
            {s?.current ? (
              <ScrollingTrackTitle as="strong" title={s.current.title} fadeEdges={false} />
            ) : (
              <strong>함께 들을 곡을 신청해 보세요</strong>
            )}
            {s?.current && <small>{s.current.artistName}</small>}
          </div>
        </div>
        <div className="chat-room-player-actions" aria-label="방 전체 재생 조작">
          <button
            type="button"
            className="chat-room-play-toggle"
            aria-label={
              s?.state === 'PLAYING'
                ? '전체 일시정지'
                : s?.state === 'PAUSED'
                  ? '전체 재개'
                  : '전체 재생'
            }
            disabled={isCommandDisabled || !s || (s.state === 'IDLE' && !isReady)}
            onClick={() =>
              onCommand(
                s?.state === 'PLAYING' ? 'PAUSE' : s?.state === 'PAUSED' ? 'RESUME' : 'PLAY',
              )
            }
          >
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="currentColor">
              {s?.state === 'PLAYING' ? (
                <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
              ) : (
                <path d="M6 3l16 9-16 9z" />
              )}
            </svg>
          </button>
          <button
            type="button"
            disabled={isCommandDisabled || !hasTrack}
            aria-label="다음 곡으로"
            onClick={() => onCommand('SKIP')}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor">
              <path d="M4 4l13 8-13 8zm14 0h3v16h-3z" />
            </svg>
          </button>
        </div>
      </div>
      <div className="chat-room-view-row">
        {!hasVideo && (
          <p className="chat-room-view-note">
            {hasTrack
              ? '영상 정보가 준비되면 영상 보기를 사용할 수 있어요.'
              : '곡을 신청하면 영상도 볼 수 있어요.'}
          </p>
        )}
        <div
          className="chat-room-view-options"
          role="group"
          aria-label="플레이어 표시 방식"
          data-presentation={isVideo ? 'video' : 'album'}
        >
          <span className="chat-room-view-indicator" aria-hidden="true" />
          <button type="button" aria-pressed={!isVideo} onClick={() => setPresentation('album')}>
            앨범 보기
          </button>
          <button
            type="button"
            aria-pressed={isVideo}
            disabled={!hasVideo}
            onClick={() => setPresentation('video')}
          >
            영상 보기
          </button>
        </div>
      </div>
      <div
        className={`chat-room-player-status${isReady && !['blocked', 'error'].includes(state.status) ? ' chat-music-accessible' : ''}`}
        role="status"
      >
        {!isReady ? '연결을 확인하고 있어요. 재생은 연결 후 이어져요.' : labels[state.status]}
      </div>
      {state.message && <p role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</p>}
      {state.status === 'blocked' && (
        <button
          type="button"
          disabled={!isReady}
          onClick={() => {
            player.allowPlayback();
            requestAnimationFrame(() => {
              const pane = container.current?.closest('.chat-music-player-pane');
              if (pane) pane.scrollTop = 0;
            });
          }}
        >
          브라우저 재생 허용
        </button>
      )}
      {state.status === 'error' && (
        <div className="chat-room-player-actions">
          <button type="button" disabled={!isReady} onClick={() => player.retry()}>
            YouTube 다시 연결
          </button>
          <button type="button" disabled={!isReady} onClick={onRefresh}>
            재생 상태 새로 확인
          </button>
        </div>
      )}
      <div className="chat-room-player-volume">
        <button
          type="button"
          aria-label="내 음소거"
          aria-pressed={state.isMuted}
          onClick={() => player.mute()}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 9h4l5-4v14l-5-4H4z" />
            {state.isMuted ? (
              <path d="m17 9 5 6m0-6-5 6" />
            ) : (
              <path d="M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
            )}
          </svg>
        </button>
        <label className="chat-music-accessible" htmlFor="chat-music-volume">
          내 음량
        </label>
        <div className="chat-room-volume-slider">
          <input
            id="chat-music-volume"
            type="range"
            min="0"
            max="100"
            step="1"
            style={{ '--music-volume': `${state.volume}%` } as CSSProperties}
            value={state.volume}
            onChange={(event) => player.volume(Number(event.target.value))}
          />
          <div className="chat-room-volume-ticks" aria-hidden="true">
            {[0, 25, 50, 75, 100].map((value) => (
              <span key={value} />
            ))}
          </div>
        </div>
        <output htmlFor="chat-music-volume">{state.volume}%</output>
      </div>
      <p className="chat-room-player-hint">
        재생 조작은 방 전체에, 음량·음소거는 나에게만 적용돼요.
      </p>
    </section>
  );
}
function formatPosition(seconds: number) {
  const n = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
