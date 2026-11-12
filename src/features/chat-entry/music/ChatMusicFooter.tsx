import type { MusicQueueState } from './chatMusicQueueController';
import './chatMusicFooter.css';

type FeedbackState = Pick<
  MusicQueueState,
  'isVideoCoolingDown' | 'isCoolingDown' | 'isMutating' | 'pending'
>;
interface ChatMusicFooterProps {
  isPlayer: boolean;
  count: string | null;
  isReady: boolean;
  isMusicReady: boolean;
  feedback: FeedbackState;
  notice: string;
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
  notice,
  onSearch,
  onQueue,
  onRetry,
}: ChatMusicFooterProps) {
  const hasFeedback = !!(
    feedback.isVideoCoolingDown ||
    feedback.isCoolingDown ||
    feedback.isMutating ||
    feedback.pending ||
    notice
  );
  return (
    <footer
      className="chat-music-footer"
      role="region"
      aria-label="음악 신청 상태"
      tabIndex={hasFeedback ? 0 : undefined}
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
      {!isPlayer && <p className="chat-music-description">신청한 곡은 대기 순서대로 재생돼요.</p>}
      <div className="chat-music-feedback">
        {feedback.isVideoCoolingDown && (
          <p role="status">영상 검색·신청은 잠시 후 다시 이용해 주세요.</p>
        )}
        {feedback.isCoolingDown && <p role="status">잠시 후 다음 요청을 보낼 수 있어요.</p>}
        {notice && (
          <p
            className={
              notice === '대기 중인 곡이 없어요. 먼저 곡을 신청해 주세요.'
                ? 'chat-music-empty-queue-notice'
                : undefined
            }
            role="status"
          >
            {notice}
          </p>
        )}
        {feedback.isMutating && <p role="status">요청을 확인하고 있어요…</p>}
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
