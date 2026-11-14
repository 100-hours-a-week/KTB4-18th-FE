import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMusicPreview } from '../../music-record/hooks/useMusicPreview';
import { LocationRecommendationTrackCarousel } from './LocationRecommendationTrackCarousel';
import { navigate } from '../../../shared/navigation';
import type { Music } from '../../music-record/api/musicRecordsApi';
import type {
  LocationRecommendationCandidate,
  LocationRecommendationTrack,
} from '../locationRecommendationTypes';
import './locationRecommendationDialog.css';

const STATUS_RETRY_DELAY_MS = 500;

type LocationRecommendationDialogProps = {
  candidate: LocationRecommendationCandidate;
  verifyStatus: (
    candidate: LocationRecommendationCandidate,
    verifyContext?: boolean,
  ) => Promise<boolean>;
  onCancel: () => void;
  onDismiss: () => void;
  onRefresh?: () => void;
};

export function LocationRecommendationDialog({
  candidate,
  verifyStatus,
  onCancel,
  onDismiss,
  onRefresh,
}: LocationRecommendationDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const portalTarget = document.querySelector<HTMLElement>('.location-recommendation-portal-root');
  const preview = useMusicPreview();
  const [isStatusVerified, setIsStatusVerified] = useState(true);
  const [hasVerificationFailed, setHasVerificationFailed] = useState(false);
  const [escapeNotice, setEscapeNotice] = useState(false);
  const stopPreview = preview.stop;

  const recordTrack = (track: LocationRecommendationTrack) => {
    const initialMusic: Music = {
      music_id: null,
      provider: 'ITUNES',
      external_music_id: track.trackId,
      title: track.title,
      artist_name: track.artist,
      album_cover_url: track.artworkUrl,
      preview_url: track.previewUrl,
      youtube_video_id: null,
      is_queueable: false,
    };
    stopPreview();
    onDismiss();
    navigate('/music-records/new', { initialMusic });
  };

  useEffect(() => {
    if (!portalTarget) return;
    const previousFocus = document.activeElement;
    const inertSiblings: { element: HTMLElement; wasInert: boolean }[] = [];
    let branch: HTMLElement | null = portalTarget;
    while (branch?.parentElement) {
      const parent: HTMLElement = branch.parentElement;
      Array.from(parent.children).forEach((sibling) => {
        if (sibling === branch || !(sibling instanceof HTMLElement)) return;
        inertSiblings.push({ element: sibling, wasInert: sibling.inert });
        sibling.inert = true;
      });
      if (parent.id === 'root') break;
      branch = parent;
    }
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setEscapeNotice(true);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href]',
      );
      if (!controls?.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      inertSiblings.forEach(({ element, wasInert }) => {
        element.inert = wasInert;
      });
      stopPreview();
      if (previousFocus instanceof HTMLElement) requestAnimationFrame(() => previousFocus.focus());
    };
  }, [candidate.requestId, portalTarget, stopPreview]);

  useEffect(() => {
    const handleCrossTabCancel = (event: Event) => {
      const marker = (event as CustomEvent<{ authEpoch?: string; targetRequestId?: string }>)
        .detail;
      if (marker && marker.authEpoch !== candidate.authEpoch) {
        return;
      }
      if (
        marker?.targetRequestId &&
        marker.targetRequestId !== candidate.requestId &&
        marker.targetRequestId !== candidate.operationUUID
      ) {
        return;
      }
      stopPreview();
      onDismiss();
    };
    window.addEventListener('meomuneum:location-recommendation:cancel', handleCrossTabCancel);
    return () =>
      window.removeEventListener('meomuneum:location-recommendation:cancel', handleCrossTabCancel);
  }, [candidate, onDismiss, stopPreview]);

  useEffect(() => {
    let isCurrent = true;
    let isChecking = false;
    let checkGeneration = 0;
    let lastStartedGeneration = -1;
    let retryTimer: number | undefined;
    const checkStatus = async (isRetry = false) => {
      if (
        isChecking ||
        document.visibilityState !== 'visible' ||
        (!isRetry && lastStartedGeneration === checkGeneration)
      ) {
        return;
      }
      isChecking = true;
      const generation = checkGeneration;
      lastStartedGeneration = generation;
      setHasVerificationFailed(false);
      setIsStatusVerified(false);
      let isValid: boolean;
      try {
        isValid = await verifyStatus(candidate, true);
      } catch {
        isValid = false;
      }
      isChecking = false;
      if (!isCurrent || document.visibilityState !== 'visible') return;
      if (generation !== checkGeneration) {
        void checkStatus();
        return;
      }
      if (isValid) {
        setIsStatusVerified(true);
        return;
      }
      stopPreview();
      if (!isRetry) {
        retryTimer = window.setTimeout(() => {
          retryTimer = undefined;
          void checkStatus(true);
        }, STATUS_RETRY_DELAY_MS);
      } else {
        setHasVerificationFailed(true);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        checkGeneration += 1;
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
        stopPreview();
        setIsStatusVerified(false);
      } else {
        void checkStatus();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      isCurrent = false;
      window.clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [candidate, stopPreview, verifyStatus]);

  if (!portalTarget) return null;

  return createPortal(
    <div className="location-recommendation-backdrop">
      <section
        ref={dialogRef}
        className="location-recommendation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-recommendation-title"
        aria-describedby="location-recommendation-region"
        tabIndex={-1}
      >
        <header className="location-recommendation-dialog__header">
          <div className="location-recommendation-dialog__heading">
            <p
              id="location-recommendation-region"
              className="location-recommendation-dialog__eyebrow"
            >
              {candidate.region.sidoName} {candidate.region.name}
            </p>
            <h2 id="location-recommendation-title">새로운 지역에서 음악을 발견했어요!</h2>
          </div>
          <button
            ref={closeRef}
            className="location-recommendation-dialog__close"
            type="button"
            aria-label="추천 닫기"
            onClick={onCancel}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        {escapeNotice && (
          <p
            className="location-recommendation-dialog__escape-notice"
            role="status"
            aria-live="polite"
          >
            추천을 닫으려면 닫기 버튼을 눌러 주세요.
          </p>
        )}
        <LocationRecommendationTrackCarousel
          key={candidate.requestId}
          tracks={candidate.tracks}
          isPreviewAllowed={isStatusVerified}
          onRefresh={hasVerificationFailed ? onRefresh : undefined}
          onRecordTrack={recordTrack}
          preview={preview}
        />
        <p className="location-recommendation-dialog__message">
          {candidate.recommendationMessage ||
            '지역에 어울리는 추천곡을 준비했어요. 곡을 넘겨보고 미리 들어보세요.'}
        </p>
      </section>
    </div>,
    portalTarget,
  );
}
