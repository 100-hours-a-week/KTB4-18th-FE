import { useEffect, useRef, useState } from 'react';
import type {
  ChatMusicEvent,
  ChatMusicSession,
  RequestableMusic,
  MusicQueueItem,
} from './chatMusicTypes';
import { useChatMusicQueue } from './useChatMusicQueue';
import './chatMusicPanel.css';
import './chatMusicSheet.css';
import { useMusicDialogBounds } from './useMusicDialogBounds';
import { ChatMusicPlayerView } from './ChatMusicPlayerView';
import { ChatMusicCompactCard } from './ChatMusicCompactCard';
import { ChatMusicFooter } from './ChatMusicFooter';
import { ChatMusicToast } from './ChatMusicToast';
import { ChatMusicSongSkeleton } from './ChatMusicSongSkeleton';
import { ChatMusicVideoCandidateRow } from './ChatMusicVideoCandidateRow';
import { getHighResolutionArtworkUrl } from '../../../shared/albumArtwork';
import { chatMusicPlayerEnabled } from './chatMusicCommands';
import { ScrollingTrackTitle } from '../../../components/ScrollingTrackTitle';
import { useMusicSheetDrag } from './useMusicSheetDrag';
import { useDelayedMusicLoading } from './useDelayedMusicLoading';

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
  regionName,
}: {
  session: ChatMusicSession;
  isReady: boolean;
  event?: ChatMusicEvent;
  currentUserId?: number | null;
  request: MusicSearchRequest;
  regionName?: string;
}) {
  const { state, controller } = useChatMusicQueue(session, isReady, event);
  const [tab, setTab] = useState<'player' | 'search' | 'queue' | null>(null);
  const [playerAttention, setPlayerAttention] = useState('');
  const showQueueSkeleton = useDelayedMusicLoading(
    isReady && tab === 'queue' && state.queueLoading,
  );
  const showVideoSkeleton = useDelayedMusicLoading(
    isReady && tab === 'search' && !!state.selectedSong && state.videoLoading,
  );
  const [query, setQuery] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [handledRequest, setHandledRequest] = useState(request.sequence);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const moreButton = useRef<HTMLButtonElement>(null);
  const songFocus = useRef<HTMLElement | null>(null);
  useMusicDialogBounds(dialog, tab !== null);
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
      element.querySelector<HTMLButtonElement>('header button')?.focus();
    } else if (tab === null && element.open) {
      element.close();
      const composer = element
        .closest('.chat-entry-shell')
        ?.querySelector<HTMLTextAreaElement>('.region-chat-composer textarea');
      const mini = element
        .closest('.chat-music')
        ?.querySelector<HTMLButtonElement>('.chat-now-playing-metadata');
      for (const target of [returnFocus.current, mini, composer]) {
        if (
          !target?.isConnected ||
          target.matches(':disabled, [aria-disabled="true"]') ||
          target.closest('[hidden], [inert]')
        )
          continue;
        target.focus({ preventScroll: true });
        if (document.activeElement === target) break;
      }
    }
    if (tab === 'player') {
      const pane = element.querySelector('.chat-music-player-pane');
      if (pane) pane.scrollTop = 0;
    }
    if (tab !== null && element.open && !element.contains(document.activeElement))
      element.querySelector<HTMLButtonElement>('header button')?.focus();
    if (tab !== null && document.activeElement?.closest('[hidden]'))
      element.querySelector<HTMLButtonElement>('header button')?.focus();
  }, [tab]);
  useEffect(() => {
    if (tab !== 'search' || state.selectedSong || !isReady || isComposing) {
      controller.cancelSearch();
      return;
    }
    // Do not turn partially composed Korean input into a different search request.
    const snapshot = controller.getSnapshot();
    if (
      (snapshot.search || snapshot.searchLoading) &&
      snapshot.searchQuery === query.normalize('NFC').trim().replace(/\s+/g, ' ')
    )
      return;
    controller.cancelSearch();
    const timer = setTimeout(() => void controller.search(query), query.trim() ? 300 : 0);
    return () => clearTimeout(timer);
  }, [controller, tab, query, isComposing, isReady, session.generation, state.selectedSong]);
  useEffect(() => {
    if (state.selectedSong)
      dialog.current?.querySelector<HTMLButtonElement>('.chat-music-video-heading button')?.focus();
  }, [state.selectedSong]);
  useEffect(() => {
    const target = moreButton.current;
    if (
      !target ||
      !scroller.current ||
      typeof IntersectionObserver !== 'function' ||
      state.selectedSong
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (
          tab === 'search' &&
          state.search?.nextCursor &&
          !state.searchLoading &&
          !state.searchError
        )
          void controller.search(query, true);
        if (
          tab === 'queue' &&
          state.queue?.nextCursor &&
          !state.queueLoading &&
          !state.queueError &&
          !state.isQueueStale
        )
          void controller.loadQueue(true);
      },
      { root: scroller.current, rootMargin: '100px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [
    controller,
    tab,
    query,
    state.selectedSong,
    state.search?.nextCursor,
    state.searchLoading,
    state.searchError,
    state.queue?.nextCursor,
    state.queueLoading,
    state.queueError,
    state.isQueueStale,
  ]);
  useEffect(() => {
    controller.cancelVideos();
  }, [controller, request.sequence]);
  const isMusicReady = isReady && state.recoveryStatus === 'ready';
  const isWriteDisabled = !isMusicReady || !!state.pending || state.isCoolingDown;
  const current = state.queue?.current;
  const stateLabel = '현재 곡';
  const isAddConfirmed = state.notice === '곡 신청을 확인했어요.';
  const notice = isAddConfirmed
    ? '음악 신청 성공했습니다'
    : ['공동 재생 요청을 확인했어요.', '대기 곡 신청을 취소했어요.'].includes(state.notice)
      ? ''
      : state.notice;
  const attentionNotice = isAddConfirmed ? '' : notice;
  const needsAttention =
    !!attentionNotice ||
    !!playerAttention ||
    !!state.pending ||
    !!state.queueError ||
    state.recoveryStatus !== 'ready';
  const finishClose = () => {
    setTab(null);
    controller.cancelSearch();
    controller.cancelVideos();
  };
  const sheetDrag = useMusicSheetDrag(
    dialog,
    tab !== null,
    finishClose,
    tab === null ? null : `${tab}:${request.sequence}`,
  );
  const close = sheetDrag.requestClose;
  const showSearch = () => {
    controller.cancelVideos();
    setQuery('');
    if (isReady) void controller.search('');
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
        <ScrollingTrackTitle as="strong" title={song.title} fadeEdges={false} />
        <span>{song.artistName}</span>
        {'sources' in song ? (
          <div className="chat-music-sources">
            {song.sources.map((source) => (
              <span key={source} data-source={source}>
                {source === 'RECORDED' ? '지역 기록' : '내 추천'}
              </span>
            ))}
          </div>
        ) : (
          <small>{song.addedByUserId === currentUserId ? '내 신청' : '이웃 신청'}</small>
        )}
      </div>
      {kind === 'search' && 'sources' in song ? (
        <button
          type="button"
          disabled={isWriteDisabled || state.isVideoCoolingDown}
          data-music-id={song.musicId}
          aria-label={`${song.title} 영상 선택`}
          onClick={(event) => {
            listScroll.current = scroller.current?.scrollTop ?? 0;
            songFocus.current = event.currentTarget;
            void controller.selectSong(song);
          }}
        >
          영상 선택
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
      aria-describedby={needsAttention ? 'chat-music-attention' : undefined}
    >
      {chatMusicPlayerEnabled() && (
        <ChatMusicCompactCard
          regionName={regionName}
          playback={state.playback}
          hasQueuedTracks={(state.queue?.items.length ?? 0) > 0}
          isCommandDisabled={isWriteDisabled || !state.playback}
          onOpen={() => setTab('player')}
          onCommand={(action) => controller.control(action)}
        />
      )}
      {needsAttention && (
        <span id="chat-music-attention" className="chat-music-accessible" role="status">
          음악 상태를 확인해 주세요.{' '}
          {attentionNotice || playerAttention || state.recoveryMessage || state.queueError}
        </span>
      )}
      <dialog
        ref={dialog}
        className={`chat-music-dialog${tab === 'player' ? ' chat-music-player-dialog' : ''}`}
        aria-modal="true"
        aria-labelledby="chat-music-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={(event) => {
          // A queued close from the previous opening must not close a newly reopened native dialog.
          if (!event.currentTarget.open) setTab(null);
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            close();
        }}
      >
        <div className={`chat-music-sheet${tab === 'queue' ? ' chat-music-queue-sheet' : ''}`}>
          <div className="chat-music-drag-handle" aria-hidden="true" {...sheetDrag.handleProps} />
          <header>
            <h2 id="chat-music-title">{tab === 'queue' ? '음악 대기열' : '음악 신청'}</h2>
            <button type="button" aria-label="음악 창 닫기" onClick={close}>
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              >
                <path d="m5 5 14 14M19 5 5 19" />
              </svg>
            </button>
          </header>
          <nav aria-label="음악 메뉴">
            {chatMusicPlayerEnabled() && (
              <button
                type="button"
                aria-pressed={tab === 'player'}
                onClick={() => setTab('player')}
              >
                플레이어
              </button>
            )}
            <button type="button" aria-pressed={tab === 'search'} onClick={showSearch}>
              곡 찾기
            </button>
            <button
              type="button"
              aria-pressed={tab === 'queue'}
              onClick={() => {
                controller.cancelVideos();
                setTab('queue');
                void controller.loadQueue();
              }}
            >
              대기열
            </button>
          </nav>
          {tab !== null && isReady && state.recoveryStatus !== 'ready' && (
            <div className="chat-music-recovery" role="status">
              <span>{state.recoveryMessage}</span>
              {['error', 'denied'].includes(state.recoveryStatus) && (
                <button
                  type="button"
                  disabled={state.queueLoading}
                  onClick={() => controller.recover()}
                >
                  음악 상태 다시 확인
                </button>
              )}
            </div>
          )}
          {!isReady && (
            <p className="chat-music-warning" role="status">
              연결을 확인하고 있어요. 연결 후 다시 이용해 주세요.
            </p>
          )}
          <div className="chat-music-player-pane" hidden={tab !== 'player'}>
            {chatMusicPlayerEnabled() && (
              <ChatMusicPlayerView
                playback={state.playback}
                isReady={isMusicReady}
                isCommandDisabled={isWriteDisabled || !state.playback}
                onCommand={(action) => controller.control(action)}
                onRefresh={() => controller.recover()}
                onAttentionChange={setPlayerAttention}
              />
            )}
          </div>
          {tab === 'search' && state.selectedSong ? (
            <>
              <div className="chat-music-video-heading">
                <button
                  type="button"
                  onClick={() => {
                    const musicId = state.selectedSong?.musicId;
                    controller.cancelVideos();
                    requestAnimationFrame(() => {
                      if (scroller.current) scroller.current.scrollTop = listScroll.current;
                      const target = dialog.current?.querySelector<HTMLButtonElement>(
                        `[data-music-id="${musicId}"]`,
                      );
                      (target ?? songFocus.current)?.focus({ preventScroll: true });
                    });
                  }}
                >
                  ← 지역 음악
                </button>
                <ScrollingTrackTitle
                  as="strong"
                  title={`${state.selectedSong.title} · ${state.selectedSong.artistName}`}
                  fadeEdges={false}
                />
              </div>
              <div
                className={`chat-music-scroll chat-music-video-scroll${!state.videoLoading && (state.videoError || state.videos?.resultKind === 'EMPTY') ? ' chat-music-video-feedback-mode' : ''}`}
                ref={scroller}
                tabIndex={0}
                aria-label="영상 후보 목록"
              >
                {state.videoLoading && (
                  <p className="chat-music-accessible" role="status">
                    재생할 수 있는 영상을 찾고 있어요…
                  </p>
                )}
                {!state.videoLoading &&
                  (state.videoError || state.videos?.resultKind === 'EMPTY') && (
                    <div className="chat-music-video-feedback">
                      {state.videoError ? (
                        <p role="alert">{state.videoError}</p>
                      ) : (
                        <p>신청할 수 있는 영상을 찾지 못했어요.</p>
                      )}
                      <button
                        type="button"
                        disabled={isWriteDisabled || state.isVideoCoolingDown}
                        onClick={() => {
                          if (state.selectedSong) void controller.selectSong(state.selectedSong);
                        }}
                      >
                        영상 다시 찾기
                      </button>
                    </div>
                  )}
                <ul
                  className="chat-music-list"
                  aria-label="선택 가능한 영상"
                  aria-busy={state.videoLoading}
                >
                  {state.videos?.items.map((video) => (
                    <ChatMusicVideoCandidateRow
                      key={video.candidateId}
                      video={video}
                      cover={<MusicCover url={video.thumbnailUrl} />}
                      disabled={isWriteDisabled || state.isVideoCoolingDown}
                      onSelect={() => {
                        if (state.selectedSong) controller.add(state.selectedSong, video);
                      }}
                    />
                  ))}
                  {showVideoSkeleton && <ChatMusicSongSkeleton count={3} variant="video" />}
                </ul>
              </div>
            </>
          ) : tab === 'search' ? (
            <>
              <form
                className="chat-music-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!isComposing && isReady) void controller.search(query);
                }}
              >
                <label className="chat-music-accessible" htmlFor="chat-music-query">
                  제목 또는 가수
                </label>
                <div>
                  <img
                    className="chat-music-search-icon"
                    src="/icons/chat/Search.svg"
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                  />
                  <input
                    ref={input}
                    id="chat-music-query"
                    type="search"
                    value={query}
                    maxLength={100}
                    placeholder="듣고 싶은 곡 또는 가수를 찾아보세요"
                    disabled={!isReady}
                    onChange={(event) => {
                      controller.cancelSearch();
                      setQuery(event.target.value);
                    }}
                    onPointerDown={(event) => {
                      event.currentTarget.dataset.pointerFocus = 'true';
                    }}
                    onBlur={(event) => {
                      delete event.currentTarget.dataset.pointerFocus;
                    }}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={() => setIsComposing(false)}
                  />
                </div>
              </form>
              <div
                className="chat-music-scroll chat-music-song-scroll"
                ref={scroller}
                tabIndex={0}
                aria-label="지역 음악 목록"
                onScroll={(event) => {
                  const element = event.currentTarget;
                  if (
                    element.scrollHeight - element.scrollTop - element.clientHeight < 120 &&
                    state.search?.nextCursor &&
                    !state.searchLoading &&
                    !state.searchError
                  )
                    void controller.search(query, true);
                }}
              >
                {state.searchLoading && (
                  <p className="chat-music-accessible" role="status">
                    곡을 찾고 있어요…
                  </p>
                )}
                {state.searchError && (
                  <p role="alert">
                    {state.searchError}
                    <button
                      type="button"
                      disabled={!isReady}
                      onClick={() =>
                        void controller.search(
                          query,
                          !!state.search?.nextCursor &&
                            state.searchQuery ===
                              query.normalize('NFC').trim().replace(/\s+/g, ' '),
                        )
                      }
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
                <ul
                  className="chat-music-list chat-music-song-list"
                  aria-label="신청 가능한 곡"
                  aria-busy={state.searchLoading}
                >
                  {state.search?.items.map((song, index) => item(song, index, 'search'))}
                  {state.searchLoading && (
                    <ChatMusicSongSkeleton count={state.search?.items.length ? 2 : 6} />
                  )}
                </ul>
                {state.search?.nextCursor && (
                  <button
                    type="button"
                    className="chat-music-more"
                    ref={moreButton}
                    disabled={!isReady || state.searchLoading}
                    onClick={() => void controller.search(query, true)}
                  >
                    곡 더 보기
                  </button>
                )}
              </div>
            </>
          ) : tab === 'queue' ? (
            <>
              {current && (
                <>
                  <h3 className="chat-music-queue-heading">현재 곡</h3>
                  <section className="chat-music-current" aria-label={stateLabel}>
                    <MusicCover url={current.albumCoverUrl} />
                    <div>
                      <ScrollingTrackTitle as="strong" title={current.title} fadeEdges={false} />
                      <span>{current.artistName}</span>
                    </div>
                  </section>
                </>
              )}
              <h3 className="chat-music-queue-heading">대기 곡</h3>
              <div
                className={`chat-music-scroll${current && !state.queueLoading && !state.queueError && state.queue?.items.length === 0 ? ' chat-music-queue-empty-with-current' : ''}`}
                ref={scroller}
                tabIndex={0}
                aria-label="음악 대기 목록"
                onScroll={(event) => {
                  const element = event.currentTarget;
                  if (
                    element.scrollHeight - element.scrollTop - element.clientHeight < 120 &&
                    state.queue?.nextCursor &&
                    !state.queueLoading &&
                    !state.isQueueStale &&
                    !state.queueError
                  )
                    void controller.loadQueue(true);
                }}
              >
                {state.queueLoading && (
                  <p className="chat-music-accessible" role="status">
                    대기열을 확인하고 있어요…
                  </p>
                )}
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
                  <p className="chat-music-empty chat-music-empty-queue">
                    대기 중인 곡이 없어요.
                    <button type="button" onClick={showSearch} disabled={!isReady}>
                      곡 신청하기
                    </button>
                  </p>
                )}
                <ol
                  className="chat-music-list"
                  aria-label="대기 중인 곡"
                  aria-busy={state.queueLoading}
                >
                  {state.queue?.items.map((song, index) => item(song, index, 'queue'))}
                  {showQueueSkeleton && (
                    <ChatMusicSongSkeleton
                      count={state.queue?.items.length ? 2 : 3}
                      variant="queue"
                    />
                  )}
                </ol>
                {state.queue?.nextCursor && (
                  <button
                    type="button"
                    className="chat-music-more"
                    ref={moreButton}
                    disabled={!isReady || state.queueLoading || state.isQueueStale}
                    onClick={() => void controller.loadQueue(true)}
                  >
                    대기 곡 더 보기
                  </button>
                )}
              </div>
            </>
          ) : null}
          <ChatMusicFooter
            isMusicReady={isMusicReady}
            feedback={state}
            onRetry={() => controller.retryMutation()}
          />
        </div>
        <ChatMusicToast
          dialog={dialog}
          isOpen={tab !== null}
          notice={notice}
          isCoolingDown={state.isCoolingDown}
          isVideoCoolingDown={state.isVideoCoolingDown}
        />
      </dialog>
    </section>
  );
}
function MusicCover({ url }: { url: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  let safe: string | null = null;
  try {
    if (url) {
      const parsed = new URL(getHighResolutionArtworkUrl(url)!, window.location.origin);
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
