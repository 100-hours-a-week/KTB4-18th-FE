import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMusicPreview } from '../../music-record/hooks/useMusicPreview';
import { LocationRecommendationTrackCarousel } from './LocationRecommendationTrackCarousel';
import type { LocationRecommendationCandidate } from '../locationRecommendationTypes';
import './locationRecommendationDialog.css';

type LocationRecommendationDialogProps = {
  candidate: LocationRecommendationCandidate;
  verifyStatus: (
    candidate: LocationRecommendationCandidate,
    verifyContext?: boolean,
  ) => Promise<boolean>;
  onCancel: () => void;
  onDismiss: () => void;
};

export function LocationRecommendationDialog({
  candidate,
  verifyStatus,
  onCancel,
  onDismiss,
}: LocationRecommendationDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const portalTarget = document.querySelector<HTMLElement>('.location-recommendation-portal-root');
  const preview = useMusicPreview();
  const [isStatusVerified, setIsStatusVerified] = useState(true);
  const [escapeNotice, setEscapeNotice] = useState(false);
  const stopPreview = preview.stop;

  useEffect(() => {
    if (!portalTarget) return;
    const previousFocus = document.activeElement;
    const inertSiblings: { element: HTMLElement; wasInert: boolean }[] = [];
    let branch: HTMLElement | null = portalTarget;
    while (branch?.parentElement) {
      const parent = branch.parentElement;
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
    let shouldCheckContextOnVisible = false;
    const checkStatus = async (verifyContext = false) => {
      if (document.visibilityState !== 'visible') return;
      if (isChecking) {
        if (verifyContext) shouldCheckContextOnVisible = true;
        return;
      }
      isChecking = true;
      const generation = ++checkGeneration;
      const isValid = await verifyStatus(candidate, verifyContext).catch(() => false);
      isChecking = false;
      if (!isCurrent) return;
      if (generation !== checkGeneration || document.visibilityState !== 'visible') {
        if (document.visibilityState === 'visible' && shouldCheckContextOnVisible) {
          shouldCheckContextOnVisible = false;
          void checkStatus(true);
        }
        return;
      }
      if (!isValid) {
        stopPreview();
        setIsStatusVerified(false);
        return;
      }
      setIsStatusVerified(true);
      if (shouldCheckContextOnVisible) {
        shouldCheckContextOnVisible = false;
        setIsStatusVerified(false);
        void checkStatus(true);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        checkGeneration += 1;
        shouldCheckContextOnVisible = true;
        stopPreview();
        setIsStatusVerified(false);
      } else {
        shouldCheckContextOnVisible = true;
        void checkStatus(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      isCurrent = false;
      checkGeneration += 1;
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
          preview={preview}
        />
        <p className="location-recommendation-dialog__message">
          지역에 어울리는 추천곡을 준비했어요. 곡을 넘겨보고 미리 들어보세요.
        </p>
        <p className="location-recommendation-dialog__footnote">
          미리 듣기는 직접 누르면 최대 30초 동안 재생돼요. 추천은 음악 기록에 자동 저장되지 않아요.
          미리 듣기·앨범 아트 제공: iTunes.
        </p>
      </section>
    </div>,
    portalTarget,
  );
}
