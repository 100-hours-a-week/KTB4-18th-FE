import type { MusicQueueState } from './chatMusicQueueController';
import './chatMusicFooter.css';

type FeedbackState = Pick<MusicQueueState, 'isCoolingDown' | 'isMutating' | 'pending'>;
interface ChatMusicFooterProps {
  isPlayer: boolean;
  count: string | null;
  isReady: boolean;
  isMusicReady: boolean;
  feedback: FeedbackState;
  onSearch: () => void;
  onQueue: () => void;
  onRetry: () => void;
}
export function ChatMusicFooter({
  isPlayer,
  count,
  isReady,
  isMusicReady,
  feedback,
  onSearch,
  onQueue,
  onRetry,
}: ChatMusicFooterProps) {
  return (
    <footer
      className="chat-music-footer"
      role="region"
      aria-label="음악 신청 상태"
      tabIndex={feedback.pending && !feedback.isMutating ? 0 : undefined}
    >
      {isPlayer && (
        <div className="chat-music-player-menu">
          <button type="button" onClick={onSearch} disabled={!isReady}>
            ＋ 음악 신청
          </button>
          <button type="button" onClick={onQueue} disabled={!isReady}>
            대기열{count !== null ? ` ${count}` : ''}
          </button>
        </div>
      )}
      <div className="chat-music-feedback">
        {feedback.pending && !feedback.isMutating && (
          <button
            type="button"
            onClick={onRetry}
            disabled={!isMusicReady || feedback.isCoolingDown}
          >
            {feedback.pending.kind === 'playback'
              ? '재생 요청 결과 다시 확인'
              : feedback.pending.kind === 'add'
                ? '신청 결과 다시 확인'
                : '취소 결과 다시 확인'}
          </button>
        )}
      </div>
    </footer>
  );
}
