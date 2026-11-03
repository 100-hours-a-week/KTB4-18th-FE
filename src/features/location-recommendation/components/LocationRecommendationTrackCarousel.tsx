import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { resolveItunesTrack } from '../api/itunesTrackSearch';
import type { LocationRecommendationTrack } from '../locationRecommendationTypes';
import './locationRecommendationTrackCarousel.css';

const TRACK_SWIPE_THRESHOLD_PX = 48;
const TRACK_DRAG_ACTIVATION_PX = 8;
const ITUNES_LOOKUP_TIMEOUT_MS = 8_000;
const MAX_DRAG_PROGRESS = 0.34;
const SIDE_CARD_POSITION_PERCENT = 16;
const CENTER_POSITION_PERCENT = 50;
const SIDE_CARD_SCALE = 0.68;

type SlidePosition = 'previous' | 'current' | 'next';

type ResolvedTrackMedia = Record<string, LocationRecommendationTrack>;

type MusicPreviewState = {
  activeTrack: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  error: string;
  toggle: (trackId: string, previewUrl: string) => Promise<void>;
  stop: () => void;
};

type LocationRecommendationTrackCarouselProps = {
  tracks: LocationRecommendationTrack[];
  isPreviewAllowed: boolean;
  preview: MusicPreviewState;
};

function withoutRecommendationMedia(track: LocationRecommendationTrack) {
  return { ...track, previewUrl: null, artworkUrl: null, storeUrl: null };
}

function getTrackKey(track: LocationRecommendationTrack) {
  return JSON.stringify([track.trackId, track.title, track.artist]);
}

export function LocationRecommendationTrackCarousel({
  tracks,
  isPreviewAllowed,
  preview,
}: LocationRecommendationTrackCarouselProps) {
  const isDevelopmentBuild = import.meta.env.DEV;
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(tracks[0]?.trackId ?? null);
  const [resolvedTrackMedia, setResolvedTrackMedia] = useState<ResolvedTrackMedia>({});
  const [unavailableArtworkUrls, setUnavailableArtworkUrls] = useState<Set<string>>(
    () => new Set(),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const mediaTracks = isDevelopmentBuild
    ? tracks.map(
        (item) => resolvedTrackMedia[getTrackKey(item)] ?? withoutRecommendationMedia(item),
      )
    : tracks;
  const resolvingTrackIds = new Set(
    isDevelopmentBuild
      ? tracks
          .filter(
            (item) => !Object.prototype.hasOwnProperty.call(resolvedTrackMedia, getTrackKey(item)),
          )
          .map((item) => item.trackId)
      : [],
  );
  const selectedTrackIndex = Math.max(
    0,
    mediaTracks.findIndex((item) => item.trackId === selectedTrackId),
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    stageWidth: number;
  } | null>(null);
  const track = mediaTracks[selectedTrackIndex];
  const hasMultipleTracks = mediaTracks.length > 1;
  const isTrackActive = preview.activeTrack === track.trackId;

  useEffect(() => {
    if (!isDevelopmentBuild || tracks.length === 0) return;
    let isCurrent = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), ITUNES_LOOKUP_TIMEOUT_MS);
    void Promise.all(
      tracks.map(async (item) => {
        const resolvedTrack = await resolveItunesTrack(item, controller.signal);
        if (!isCurrent) return;
        setResolvedTrackMedia((current) => ({ ...current, [getTrackKey(item)]: resolvedTrack }));
      }),
    ).finally(() => window.clearTimeout(timeout));

    return () => {
      isCurrent = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isDevelopmentBuild, tracks]);

  const selectTrack = (index: number) => {
    if (mediaTracks.length === 0) return;
    const nextIndex = ((index % mediaTracks.length) + mediaTracks.length) % mediaTracks.length;
    if (nextIndex === selectedTrackIndex) return;
    preview.stop();
    setSelectedTrackId(mediaTracks[nextIndex].trackId);
    setDragProgress(0);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      !hasMultipleTracks ||
      !event.isPrimary ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest('button, a, input, select, textarea, [role="button"]')
    ) {
      return;
    }
    pointerStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      stageWidth: stageRef.current?.clientWidth ?? event.currentTarget.clientWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointerStart = pointerStartRef.current;
    if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pointerStart.startX;
    const deltaY = event.clientY - pointerStart.startY;
    if (Math.abs(deltaX) < TRACK_DRAG_ACTIVATION_PX || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    setIsDragging(true);
    setDragProgress(
      Math.max(-1, Math.min(1, deltaX / (pointerStart.stageWidth * MAX_DRAG_PROGRESS))),
    );
    event.preventDefault();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointerStart = pointerStartRef.current;
    if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
    pointerStartRef.current = null;
    setIsDragging(false);
    setDragProgress(0);
    const deltaX = event.clientX - pointerStart.startX;
    const deltaY = event.clientY - pointerStart.startY;
    if (Math.abs(deltaX) < TRACK_SWIPE_THRESHOLD_PX || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }
    selectTrack(selectedTrackIndex + (deltaX < 0 ? 1 : -1));
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerStartRef.current?.pointerId !== event.pointerId) return;
    pointerStartRef.current = null;
    setIsDragging(false);
    setDragProgress(0);
  };

  const previousTrackIndex = (selectedTrackIndex - 1 + mediaTracks.length) % mediaTracks.length;
  const nextTrackIndex = (selectedTrackIndex + 1) % mediaTracks.length;
  const slides = hasMultipleTracks
    ? [
        { track: mediaTracks[previousTrackIndex], position: 'previous' as const },
        { track, position: 'current' as const },
        { track: mediaTracks[nextTrackIndex], position: 'next' as const },
      ]
    : [{ track, position: 'current' as const }];

  const getSlideStyle = (position: SlidePosition) => {
    const dragAmount = Math.abs(dragProgress);
    let left = CENTER_POSITION_PERCENT;
    let scale: number;
    let zIndex = 2;

    if (position === 'current') {
      left += dragProgress * (CENTER_POSITION_PERCENT - SIDE_CARD_POSITION_PERCENT);
      scale = 1 - dragAmount * 0.28;
    } else if (position === 'previous') {
      left =
        SIDE_CARD_POSITION_PERCENT +
        Math.max(dragProgress, 0) * (CENTER_POSITION_PERCENT - SIDE_CARD_POSITION_PERCENT);
      scale =
        dragProgress > 0
          ? SIDE_CARD_SCALE + dragProgress * (1 - SIDE_CARD_SCALE)
          : SIDE_CARD_SCALE - dragAmount * 0.12;
      zIndex = dragProgress > 0 ? 3 : 1;
    } else {
      left =
        100 -
        SIDE_CARD_POSITION_PERCENT +
        Math.min(dragProgress, 0) * (CENTER_POSITION_PERCENT - SIDE_CARD_POSITION_PERCENT);
      scale =
        dragProgress < 0
          ? SIDE_CARD_SCALE + dragAmount * (1 - SIDE_CARD_SCALE)
          : SIDE_CARD_SCALE - dragAmount * 0.12;
      zIndex = dragProgress < 0 ? 3 : 1;
    }

    return {
      left: `${left}%`,
      transform: `translate(-50%, -50%) scale(${scale})`,
      zIndex,
    };
  };

  const getArtwork = (item: LocationRecommendationTrack) =>
    item.artworkUrl && !unavailableArtworkUrls.has(item.artworkUrl)
      ? item.artworkUrl
      : '/album-placeholder.svg';

  return (
    <div
      className={`location-recommendation-carousel${isDragging ? ' location-recommendation-carousel--dragging' : ''}`}
      role="group"
      aria-label="지역 추천 음악. 좌우로 드래그하거나 탐색 버튼을 눌러 곡을 넘길 수 있어요."
      aria-roledescription="carousel"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div className="location-recommendation-carousel__stage" ref={stageRef}>
        {slides.map(({ track: slideTrack, position }) => (
          <div
            className={`location-recommendation-carousel__slide location-recommendation-carousel__slide--${position}`}
            key={
              mediaTracks.length === 2 ? `${position}-${slideTrack.trackId}` : slideTrack.trackId
            }
            aria-hidden={position !== 'current'}
            style={getSlideStyle(position)}
          >
            <img
              className="location-recommendation-carousel__artwork"
              src={getArtwork(slideTrack)}
              alt=""
              draggable={false}
              onError={() => {
                if (!slideTrack.artworkUrl) return;
                setUnavailableArtworkUrls((current) =>
                  new Set(current).add(slideTrack.artworkUrl!),
                );
              }}
            />
          </div>
        ))}
      </div>
      <div className="location-recommendation-carousel__copy" aria-live="polite">
        <p className="location-recommendation-carousel__title">{track.title}</p>
        <p className="location-recommendation-carousel__artist">{track.artist}</p>
        <button
          className="location-recommendation-carousel__preview"
          type="button"
          disabled={!track.previewUrl || !isPreviewAllowed}
          aria-label={`${isTrackActive && preview.isPlaying ? '미리 듣기 중지' : '미리 듣기'}: ${track.title}`}
          onClick={() => {
            if (track.previewUrl && isPreviewAllowed) {
              void preview.toggle(track.trackId, track.previewUrl);
            }
          }}
        >
          {!track.previewUrl && resolvingTrackIds.has(track.trackId)
            ? '미리 듣기 찾는 중…'
            : isTrackActive && (preview.isPlaying || preview.isLoading)
              ? '중지 ■'
              : track.previewUrl
                ? '미리 듣기 ▶'
                : '미리 듣기 없음'}
        </button>
        {(track.previewUrl || track.storeUrl) && (
          <p className="location-recommendation-carousel__attribution">iTunes에서 제공</p>
        )}
        {track.storeUrl && (
          <a
            className="location-recommendation-carousel__store-link"
            href={track.storeUrl}
            target="_blank"
            rel="noreferrer"
          >
            Apple Music에서 보기
          </a>
        )}
      </div>
      {hasMultipleTracks && (
        <div className="location-recommendation-carousel__navigation">
          <button
            className="location-recommendation-carousel__arrow"
            type="button"
            aria-label="이전 추천곡"
            onClick={() => selectTrack(selectedTrackIndex - 1)}
          >
            ‹
          </button>
          <div className="location-recommendation-carousel__indicators" aria-label="추천곡 선택">
            {mediaTracks.map((item, index) => (
              <button
                className="location-recommendation-carousel__indicator"
                type="button"
                key={item.trackId}
                aria-label={`추천곡 ${index + 1}: ${item.title} 선택`}
                aria-pressed={index === selectedTrackIndex}
                onClick={() => selectTrack(index)}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </div>
          <span className="location-recommendation-carousel__count" aria-live="polite">
            {selectedTrackIndex + 1} / {mediaTracks.length}
          </span>
          <button
            className="location-recommendation-carousel__arrow"
            type="button"
            aria-label="다음 추천곡"
            onClick={() => selectTrack(selectedTrackIndex + 1)}
          >
            ›
          </button>
        </div>
      )}
      {preview.error && (
        <p className="location-recommendation-carousel__error" role="status">
          {preview.error}
        </p>
      )}
    </div>
  );
}
