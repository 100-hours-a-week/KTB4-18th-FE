import type { MusicQueueState } from './chatMusicQueueController';
import './chatMusicFooter.css';

type FeedbackState = Pick<MusicQueueState, 'isCoolingDown' | 'isMutating' | 'pending'>;
interface ChatMusicFooterProps {
  isMusicReady: boolean;
  feedback: FeedbackState;
  onRetry: () => void;
}
export function ChatMusicFooter({ isMusicReady, feedback, onRetry }: ChatMusicFooterProps) {
  return (
    <footer
      className="chat-music-footer"
      role="region"
      aria-label="음악 신청 상태"
      tabIndex={feedback.pending && !feedback.isMutating ? 0 : undefined}
    >
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
