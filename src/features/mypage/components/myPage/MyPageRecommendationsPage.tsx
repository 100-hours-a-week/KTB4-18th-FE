import { useCallback, useEffect, useRef, useState } from 'react';

import { getHighResolutionArtworkUrl } from '../../../../shared/albumArtwork';
import { getRecommendationHistoryPage, type RecommendationHistoryItem } from '../../api/mypageApi';
import { useMusicPreview } from '../../../music-record/hooks/useMusicPreview';
import { MyPageRecommendationsSkeleton } from '../../../../components/RouteLoadSkeleton';
import { useDelayedPending } from '../../../../hooks/useDelayedPending';
import { MyPageHeader } from './MyPageHeader';
import { message } from './useMyPageOverview';

type RecommendedSong = RecommendationHistoryItem & { date: string };

function flattenRecommendationPage(
  groups: Awaited<ReturnType<typeof getRecommendationHistoryPage>>['groups'],
) {
  return groups.flatMap((group) =>
    group.recommendations.flatMap((recommendation) =>
      recommendation.items.map((item) => ({ ...item, date: group.date })),
    ),
  );
}

export function RecommendationPage({ back }: { back: () => void }) {
  const [songs, setSongs] = useState<RecommendedSong[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [lastPage, setLastPage] = useState({ start: 0, length: 0 });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [requestId, setRequestId] = useState(0);
  const requestGeneration = useRef(0);
  const isSkeletonVisible = useDelayedPending(isLoading, requestId);
  const preview = useMusicPreview();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isLoadingRef = useRef(false);
  const loadedSongCountRef = useRef(0);

  const load = useCallback(async (nextCursor?: string | null) => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    const current = ++requestGeneration.current;
    setRequestId(current);
    setIsLoading(true);
    setError('');
    try {
      const page = await getRecommendationHistoryPage(nextCursor);
      if (current !== requestGeneration.current) return;
      const pageSongs = flattenRecommendationPage(page.groups);
      const start = nextCursor ? loadedSongCountRef.current : 0;
      loadedSongCountRef.current = start + pageSongs.length;
      setLastPage({ start, length: pageSongs.length });
      setSongs((current) => (nextCursor ? [...current, ...pageSongs] : pageSongs));
      setCursor(page.next_cursor);
      setHasNext(page.has_next);
    } catch (caught) {
      if (current === requestGeneration.current)
        setError(message(caught, '추천 받은 곡을 불러오지 못했어요.'));
    } finally {
      isLoadingRef.current = false;
      if (current === requestGeneration.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !hasNext || !cursor || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void load(cursor);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, hasNext, load, lastPage]);

  const preloadIndex = lastPage.start + Math.max(0, Math.ceil(lastPage.length / 2) - 1);
  return (
    <>
      <MyPageHeader title="지난 선곡" onBack={back} />
      <section
        className="mypage-page-content mypage-recommendations"
        aria-labelledby="recommendations-title"
        aria-busy={isLoading}
      >
        <h2 id="recommendations-title">지난 선곡</h2>
        <p className="mypage-recommendations-caption">추천 받은 곡 {songs.length}곡</p>
        {songs.map((song, index) => {
          const trackKey = [song.music_id, song.date, index].join('-');
          const isCurrentPreview = preview.activeTrack === trackKey;
          const isPreviewActive = isCurrentPreview && (preview.isPlaying || preview.isLoading);
          return (
            <article className="mypage-recommendation-item" key={trackKey}>
              <img
                className="mypage-recommendation-cover"
                src={
                  getHighResolutionArtworkUrl(song.album_cover_url ?? null) ??
                  '/album-placeholder.svg'
                }
                alt=""
              />
              <div>
                <strong>{song.title}</strong>
                <span>{song.artist_name}</span>
              </div>
              <button
                className="mypage-recommendation-play"
                type="button"
                disabled={!song.preview_url}
                aria-label={
                  song.title +
                  ' ' +
                  (isPreviewActive
                    ? '미리 듣기 중지'
                    : song.preview_url
                      ? '30초 미리 듣기'
                      : '미리 듣기 불가')
                }
                aria-pressed={isPreviewActive}
                onClick={() => {
                  if (song.preview_url) void preview.toggle(trackKey, song.preview_url);
                }}
              >
                <img
                  src={
                    isPreviewActive
                      ? '/icons/chatbot/Play-stop.svg'
                      : '/icons/chatbot/Playbutton.svg'
                  }
                  alt=""
                  aria-hidden="true"
                  width="16"
                  height="16"
                />
              </button>
              {index === preloadIndex && hasNext && <div ref={sentinelRef} aria-hidden="true" />}
            </article>
          );
        })}
        {preview.error && (
          <p className="mypage-notice" role="alert">
            {preview.error}
          </p>
        )}
        {error && (
          <p className="mypage-notice" role="alert">
            {error}{' '}
            <button
              className="mypage-inline-button"
              type="button"
              onClick={() => void load(cursor)}
            >
              다시 시도
            </button>
          </p>
        )}
        {isSkeletonVisible && !error && (
          <MyPageRecommendationsSkeleton count={songs.length ? 2 : 3} />
        )}
        {!songs.length && !isLoading && !error && (
          <p className="mypage-loading">아직 챗봇으로 추천 받은 곡이 없어요.</p>
        )}
        {hasNext && !isLoading && (
          <button className="mypage-inline-button" type="button" onClick={() => void load(cursor)}>
            다음 추천 불러오기
          </button>
        )}
      </section>
    </>
  );
}
