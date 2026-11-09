import { useEffect, useRef, useState } from 'react';
import type {
  ChatMusicEvent,
  ChatMusicSession,
  RequestableMusic,
  MusicQueueItem,
} from './chatMusicTypes';
import { useChatMusicQueue } from './useChatMusicQueue';
import './chatMusicPanel.css';
import { ChatMusicPlayerView } from './ChatMusicPlayerView';
import { chatMusicPlayerEnabled } from './chatMusicCommands';

export interface MusicSearchRequest {
  sequence: number;
  query: string;
}
export function ChatMusicPanel({
  session,
  isReady,
  event,
  currentUserId,
  request,
}: {
  session: ChatMusicSession;
  isReady: boolean;
  event?: ChatMusicEvent;
  currentUserId?: number | null;
  request: MusicSearchRequest;
}) {
  const { state, controller } = useChatMusicQueue(session, isReady, event);
  const [tab, setTab] = useState<'search' | 'queue' | null>(null);
  const [query, setQuery] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [handledRequest, setHandledRequest] = useState(request.sequence);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  if (request.sequence !== handledRequest) {
    setHandledRequest(request.sequence);
    setQuery(request.query);
    setTab('search');
  }
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (tab !== null && !element.open) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    } else if (tab === null && element.open) {
      element.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    }
    if (tab === 'search') input.current?.focus();
  }, [tab]);
  useEffect(() => {
    if (tab !== 'search' || !isReady || isComposing) {
      controller.cancelSearch();
      return;
    }
    // Do not turn partially composed Korean input into a different search request.
    controller.cancelSearch();
    const timer = setTimeout(() => void controller.search(query), 300);
    return () => clearTimeout(timer);
  }, [controller, tab, query, isComposing, isReady, session.generation]);
  const isWriteDisabled = !isReady || !!state.pending || state.isCoolingDown;
  const current = state.queue?.current;
  const stateLabel = state.queue?.state === 'PAUSED' ? '일시정지' : '현재 곡';
  const count = state.queue
    ? `${state.queue.items.length}${state.queue.nextCursor ? '+' : ''}`
    : null;
  const close = () => {
    setTab(null);
    controller.cancelSearch();
  };
  const showSearch = () => {
    setQuery('');
    setTab('search');
  };
  const item = (
    song: RequestableMusic | MusicQueueItem,
    index: number,
    kind: 'search' | 'queue',
  ) => (
    <li key={'queueItemId' in song ? song.queueItemId : song.musicId} className="chat-music-item">
      {kind === 'queue' && (
        <span className="chat-music-rank" aria-label={`대기 ${index + 1}번째`}>
          {index + 1}
        </span>
      )}
      <MusicCover url={song.albumCoverUrl} />
      <div className="chat-music-item-text">
        <strong>{song.title}</strong>
        <span>{song.artistName}</span>
        {'sources' in song ? (
          <div className="chat-music-sources">
            {song.sources.map((source) => (
              <span key={source}>{source === 'RECORDED' ? '지역 기록' : '내 추천'}</span>
            ))}
          </div>
        ) : (
          <small>{song.addedByUserId === currentUserId ? '내 신청' : '이웃 신청'}</small>
        )}
      </div>
      {kind === 'search' && 'sources' in song ? (
        <button
          type="button"
          disabled={isWriteDisabled}
          aria-label={`${song.title} 신청`}
          onClick={() => controller.add(song)}
        >
          신청
        </button>
      ) : (
        'queueItemId' in song && (
          <button
            type="button"
            className="chat-music-cancel"
            disabled={isWriteDisabled || state.isQueueStale || state.queueLoading}
            aria-label={`${song.title} 신청 취소`}
            onClick={() => controller.cancel(song)}
          >
            취소
          </button>
        )
      )}
    </li>
  );
  return (
    <section
      className={`chat-music${chatMusicPlayerEnabled() ? ' chat-music-with-player' : ''}`}
      aria-label="이야기방 음악"
    >
      <div className="chat-music-bar">
        <button type="button" onClick={showSearch} disabled={!isReady}>
          ＋ 음악 신청
        </button>
        <span className="chat-music-summary">
          {!isReady
            ? '연결 후 음악을 신청할 수 있어요'
            : current
              ? current.title
              : state.queueLoading
                ? '음악 목록 확인 중'
                : state.queueError
                  ? '음악 목록을 확인하지 못했어요'
                  : '함께 들을 곡을 신청해 보세요'}
        </span>
        <button
          type="button"
          onClick={() => {
            setTab('queue');
            void controller.loadQueue();
          }}
          disabled={!isReady}
        >
          대기열{count !== null ? ` ${count}` : ''}
        </button>
      </div>
      <div
        className="chat-music-notice"
        role="status"
        aria-live="polite"
        aria-hidden={tab !== null}
      >
        {state.notice}
        {state.pending && !state.isMutating && (
          <button
            type="button"
            onClick={() => controller.retryMutation()}
            disabled={!isReady || state.isCoolingDown}
          >
            {state.pending.kind === 'playback'
              ? '재생 요청 결과 다시 확인'
              : state.pending.kind === 'add'
                ? '신청 결과 다시 확인'
                : '취소 결과 다시 확인'}
          </button>
        )}
        {state.isMutating && <span>요청을 확인하고 있어요…</span>}
      </div>
      {chatMusicPlayerEnabled() && (
        <ChatMusicPlayerView
          playback={state.playback}
          isReady={isReady}
          isCommandDisabled={isWriteDisabled || !state.playback}
          onCommand={(action) => controller.control(action)}
          onRefresh={() => void controller.loadQueue()}
        />
      )}
      <dialog
        ref={dialog}
        className="chat-music-dialog"
        aria-modal="true"
        aria-labelledby="chat-music-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => setTab(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="chat-music-sheet">
          <header>
            <h2 id="chat-music-title">{tab === 'search' ? '음악 신청' : '음악 대기열'}</h2>
            <button type="button" aria-label="음악 창 닫기" onClick={close}>
              닫기
            </button>
          </header>
          <nav aria-label="음악 메뉴">
            <button type="button" aria-pressed={tab === 'search'} onClick={showSearch}>
              곡 찾기
            </button>
            <button type="button" aria-pressed={tab === 'queue'} onClick={() => setTab('queue')}>
              대기열
            </button>
          </nav>
          {!isReady && (
            <p className="chat-music-warning" role="status">
              연결을 확인하고 있어요. 연결 후 다시 이용해 주세요.
            </p>
          )}
          {tab === 'search' ? (
            <>
              <form
                className="chat-music-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!isComposing && isReady) void controller.search(query);
                }}
              >
                <label htmlFor="chat-music-query">제목 또는 가수</label>
                <div>
                  <input
                    ref={input}
                    id="chat-music-query"
                    type="search"
                    value={query}
                    maxLength={100}
                    placeholder="듣고 싶은 곡을 찾아보세요"
                    disabled={!isReady}
                    onChange={(event) => setQuery(event.target.value)}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={() => setIsComposing(false)}
                  />
                  <button type="submit" disabled={!isReady || isComposing}>
                    검색
                  </button>
                </div>
              </form>
              <p className="chat-music-description">
                이 지역의 공개 기록·내 기록과 내 추천에서 신청할 수 있는 곡을 찾아요.
              </p>
              {state.searchLoading && <p role="status">곡을 찾고 있어요…</p>}
              {state.searchError && (
                <p role="alert">
                  {state.searchError}
                  <button
                    type="button"
                    disabled={!isReady}
                    onClick={() => void controller.search(query)}
                  >
                    다시 검색
                  </button>
                </p>
              )}
              {!state.searchLoading && !state.searchError && state.search?.items.length === 0 && (
                <p className="chat-music-empty">
                  {state.searchQuery
                    ? '검색 결과가 없어요. 다른 제목이나 가수로 찾아보세요.'
                    : '아직 신청할 수 있는 곡이 없어요.'}
                </p>
              )}
              <ul className="chat-music-list" aria-label="신청 가능한 곡">
                {state.search?.items.map((song, index) => item(song, index, 'search'))}
              </ul>
              {state.search?.nextCursor && (
                <button
                  type="button"
                  className="chat-music-more"
                  disabled={!isReady || state.searchLoading}
                  onClick={() => void controller.search(query, true)}
                >
                  곡 더 보기
                </button>
              )}
            </>
          ) : (
            <>
              {current && (
                <section className="chat-music-current" aria-label={stateLabel}>
                  <MusicCover url={current.albumCoverUrl} />
                  <div>
                    <small>{stateLabel}</small>
                    <strong>{current.title}</strong>
                    <span>{current.artistName}</span>
                  </div>
                </section>
              )}
              <p className="chat-music-description">
                모든 참여자가 대기 곡을 신청하거나 취소할 수 있어요.
              </p>
              {state.queueLoading && <p role="status">대기열을 확인하고 있어요…</p>}
              {state.queueError && (
                <p role="alert">
                  {state.queueError}
                  <button
                    type="button"
                    disabled={!isReady || state.queueLoading}
                    onClick={() => void controller.loadQueue()}
                  >
                    대기열 다시 확인
                  </button>
                </p>
              )}
              {!state.queueLoading && !state.queueError && state.queue?.items.length === 0 && (
                <p className="chat-music-empty">
                  대기 중인 곡이 없어요.
                  <button type="button" onClick={showSearch} disabled={!isReady}>
                    곡 신청하기
                  </button>
                </p>
              )}
              <ol className="chat-music-list" aria-label="대기 중인 곡">
                {state.queue?.items.map((song, index) => item(song, index, 'queue'))}
              </ol>
              {state.queue?.nextCursor && (
                <button
                  type="button"
                  className="chat-music-more"
                  disabled={!isReady || state.queueLoading || state.isQueueStale}
                  onClick={() => void controller.loadQueue(true)}
                >
                  대기 곡 더 보기
                </button>
              )}
            </>
          )}
          <p className="chat-music-description">신청한 곡은 대기 순서대로 재생돼요.</p>
          {state.isCoolingDown && <p role="status">잠시 후 다음 요청을 보낼 수 있어요.</p>}
          {state.notice && <p role="status">{state.notice}</p>}
          {state.pending && !state.isMutating && (
            <button
              type="button"
              onClick={() => controller.retryMutation()}
              disabled={!isReady || state.isCoolingDown}
            >
              {state.pending.kind === 'playback'
                ? '재생 요청 결과 다시 확인'
                : state.pending.kind === 'add'
                  ? '신청 결과 다시 확인'
                  : '취소 결과 다시 확인'}
            </button>
          )}
        </div>
      </dialog>
    </section>
  );
}
function MusicCover({ url }: { url: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  let safe: string | null = null;
  try {
    if (url) {
      const parsed = new URL(url, window.location.origin);
      if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password)
        safe = parsed.href;
    }
  } catch {
    /* Malformed metadata uses the same placeholder as an absent cover. */
  }
  return (
    <span className="chat-music-cover" aria-hidden="true">
      {safe && failedUrl !== url ? (
        <img
          src={safe}
          alt=""
          width="44"
          height="44"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        '♪'
      )}
    </span>
  );
}
