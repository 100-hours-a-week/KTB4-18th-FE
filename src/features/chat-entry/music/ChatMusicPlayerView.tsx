import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChatMusicPlayer, type TimedPlayback } from './chatMusicPlayer';
import type { PlaybackAction } from './chatMusicApi';
import './chatMusicPlayer.css';

interface ChatMusicPlayerViewProps {
  playback: TimedPlayback | null;
  isReady: boolean;
  isCommandDisabled: boolean;
  onCommand: (action: PlaybackAction) => void;
  onRefresh: () => void;
}
export function ChatMusicPlayerView({
  playback,
  isReady,
  isCommandDisabled,
  onCommand,
  onRefresh,
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
  return (
    <section className="chat-room-player" aria-label="공동 음악 재생">
      <div className="chat-room-player-heading">
        <div className="chat-room-player-track">
          <strong>{s?.current?.title ?? '함께 들을 곡을 신청해 보세요'}</strong>
          {s?.current && <small>{s.current.artistName}</small>}
        </div>
        <span>
          {s?.state === 'PLAYING'
            ? '방에서 재생 중'
            : s?.state === 'PAUSED'
              ? '방에서 일시정지'
              : '방에서 대기 중'}
        </span>
      </div>
      <div ref={container} className="chat-room-youtube" aria-label="YouTube 음악 영상" />
      <div className="chat-room-player-status" role="status">
        {!isReady ? '연결을 확인하고 있어요. 재생은 연결 후 이어져요.' : labels[state.status]}
        {hasTrack && (
          <span aria-label="재생 위치">
            {' '}
            {formatPosition(state.position)} / {formatPosition((s?.durationMillis ?? 0) / 1000)}
          </span>
        )}
      </div>
      {state.message && <p role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</p>}
      {state.status === 'blocked' && (
        <button type="button" disabled={!isReady} onClick={() => player.allowPlayback()}>
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
      <div className="chat-room-player-actions" aria-label="방 전체 재생 조작">
        <button
          type="button"
          disabled={isCommandDisabled || !s || (s.state === 'IDLE' && !isReady)}
          onClick={() =>
            onCommand(s?.state === 'PLAYING' ? 'PAUSE' : s?.state === 'PAUSED' ? 'RESUME' : 'PLAY')
          }
        >
          {s?.state === 'PLAYING'
            ? '전체 일시정지'
            : s?.state === 'PAUSED'
              ? '전체 재개'
              : '전체 재생'}
        </button>
        <button
          type="button"
          disabled={isCommandDisabled || !hasTrack}
          onClick={() => onCommand('SKIP')}
        >
          다음 곡으로
        </button>
      </div>
      <div className="chat-room-player-volume">
        <button type="button" aria-pressed={state.isMuted} onClick={() => player.mute()}>
          내 음소거
        </button>
        <label htmlFor="chat-music-volume">내 음량</label>
        <input
          id="chat-music-volume"
          type="range"
          min="0"
          max="100"
          step="1"
          value={state.volume}
          onChange={(event) => player.volume(Number(event.target.value))}
        />
        <output htmlFor="chat-music-volume">{state.volume}%</output>
      </div>
      <p className="chat-room-player-hint">
        재생 조작은 방 전체에, 음량·음소거는 나에게만 적용돼요.
      </p>
    </section>
  );
}
function formatPosition(seconds: number) {
  const n = Math.floor(Math.max(0, seconds));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
