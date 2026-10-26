import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { createPortal } from 'react-dom';

import {
  resizeRecommendationImage,
  ImageRecommendationTerminalError,
  submitImageRecommendation,
  waitForImageVerdict,
} from '../api/imageRecommendation';
import './chatImageRecommendation.css';

interface Props {
  conversationKey: string;
  disabled: boolean;
  onUsable: (recommendationId: number, imageUrl: string, confirmedAt: Date) => void;
}

export function ChatImageRecommendation({ conversationKey, disabled, onUsable }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const closeRef = useRef<() => void>(() => undefined);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const acceptedIdRef = useRef<number | null>(null);
  const [hasAcceptedId, setHasAcceptedId] = useState(false);
  const pageLocked = working || hasAcceptedId || uncertain;

  useEffect(() => {
    if (!pageLocked) return;
    window.history.pushState({ imageRecommendationPending: true }, '', window.location.href);
    const keepImageFlowOpen = () =>
      window.history.pushState({ imageRecommendationPending: true }, '', window.location.href);
    window.addEventListener('popstate', keepImageFlowOpen);
    return () => {
      window.removeEventListener('popstate', keepImageFlowOpen);
      window.history.back();
    };
  }, [pageLocked]);

  useEffect(() => {
    if (!open) return;
    const chatApp = document.querySelector<HTMLElement>('.chat-app');
    if (chatApp) chatApp.inert = true;
    pageRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (rejected) return;
      if (event.key === 'Escape' && !pageLocked) {
        event.preventDefault();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const controls = pageRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');
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
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (chatApp) chatApp.inert = false;
    };
  }, [open, rejected, pageLocked]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!rejected) return;
    const previous = document.activeElement;
    const first = sheetRef.current?.querySelector<HTMLElement>('button');
    first?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setRejected(false);
      } else if (event.key === 'Tab') {
        const controls = sheetRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');
        if (!controls?.length) return;
        const firstControl = controls[0];
        const lastControl = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === firstControl) {
          event.preventDefault();
          lastControl.focus();
        } else if (!event.shiftKey && document.activeElement === lastControl) {
          event.preventDefault();
          firstControl.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [rejected]);

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0];
    event.target.value = '';
    if (!next) return;
    if (!next.type.startsWith('image/')) {
      setError('이미지 파일을 선택해 주세요.');
      return;
    }
    controllerRef.current?.abort();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    setFile(next);
    const nextUrl = URL.createObjectURL(next);
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);
    setRejected(false);
    setError('');
    setUncertain(false);
    acceptedIdRef.current = null;
    setHasAcceptedId(false);
    setOpen(true);
  };

  const close = useCallback(() => {
    if (working) return;
    setOpen(false);
    setRejected(false);
    setFile(null);
    acceptedIdRef.current = null;
    setHasAcceptedId(false);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, [working]);

  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  const retake = () => {
    if (hasAcceptedId && !rejected && !error) return;
    if (rejected || error) {
      acceptedIdRef.current = null;
      setHasAcceptedId(false);
    }
    setRejected(false);
    requestAnimationFrame(() => inputRef.current?.click());
  };

  const confirm = async () => {
    if (!file || working) return;
    const confirmedAt = new Date();
    const controller = new AbortController();
    controllerRef.current = controller;
    setWorking(true);
    setError('');
    try {
      let recommendationId = acceptedIdRef.current;
      if (!recommendationId) {
        const resized = await resizeRecommendationImage(file, controller.signal);
        const accepted = await submitImageRecommendation(
          resized,
          conversationKey,
          controller.signal,
        );
        recommendationId = accepted.recommendation_id;
        acceptedIdRef.current = recommendationId;
        setHasAcceptedId(true);
      }
      const usable = await waitForImageVerdict(recommendationId, controller.signal);
      if (!usable) {
        setRejected(true);
        return;
      }
      if (previewUrlRef.current) onUsable(recommendationId, previewUrlRef.current, confirmedAt);
      previewUrlRef.current = null;
      acceptedIdRef.current = null;
      setHasAcceptedId(false);
      setOpen(false);
      setFile(null);
      setPreviewUrl(null);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : '이미지 추천을 완료하지 못했습니다.');
        if (caught instanceof ImageRecommendationTerminalError) {
          acceptedIdRef.current = null;
          setHasAcceptedId(false);
        }
        if (caught && typeof caught === 'object' && 'uncertain' in caught) setUncertain(true);
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setWorking(false);
    }
  };

  return (
    <>
      {createPortal(
        <input
          ref={inputRef}
          className="chat-image-file-input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={chooseFile}
          tabIndex={-1}
          aria-label="장소 사진 촬영 또는 선택"
        />,
        document.body,
      )}
      <button
        ref={triggerRef}
        className="chat-image-entry"
        type="button"
        disabled={disabled}
        aria-label="사진으로 음악 찾기"
        onClick={() => setOpen(true)}
      >
        <img src="/icons/chatbot/image-button.svg" alt="" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={pageRef}
            className="chat-image-page"
            role="dialog"
            aria-modal="true"
            aria-label="사진으로 음악 찾기"
            tabIndex={-1}
          >
            <header className="chat-image-page-header" inert={rejected}>
              <button
                type="button"
                aria-label="사진으로 음악 찾기 닫기"
                disabled={pageLocked}
                onClick={close}
              >
                <img src="/icons/chatbot/Arrow-reft.svg" alt="" />
              </button>
              <h2>사진으로 음악 찾기</h2>
              <span />
            </header>
            <main className="chat-image-page-content" inert={rejected}>
              {previewUrl ? (
                <>
                  <img
                    className="chat-image-review"
                    src={previewUrl}
                    alt="추천에 사용할 주변 사진 미리보기"
                  />
                  <h3 className="chat-image-review-title">이 분위기에 맞는 음악을 찾아볼까요?</h3>
                  <p className="chat-image-review-description">
                    사진 속 풍경을 보고 지금 듣기 좋은 곡을 추천해드려요.
                  </p>
                </>
              ) : (
                <div className="chat-image-empty-state">
                  <div className="chat-image-placeholder">
                    <img src="/icons/chatbot/image.svg" alt="" aria-hidden="true" />
                  </div>
                  <h3>지금 주변을 찍어주세요</h3>
                  <p>눈앞의 풍경에 어울리는 음악을 찾아드릴게요.</p>
                </div>
              )}
              {working && (
                <p className="chat-image-helper" role="status">
                  사진을 확인하고 있어요…
                </p>
              )}
              {error && (
                <p className="chat-image-error" role="alert">
                  {error}
                </p>
              )}
            </main>
            <footer className="chat-image-page-actions" inert={rejected}>
              <div className="chat-image-capture-group">
                {previewUrl ? (
                  <button
                    type="button"
                    className="chat-image-secondary"
                    disabled={working || (hasAcceptedId && !rejected && !error)}
                    onClick={retake}
                  >
                    <img src="/icons/chatbot/Camera.svg" alt="" aria-hidden="true" />
                    다시 촬영하기
                  </button>
                ) : (
                  <button
                    type="button"
                    className="chat-image-capture"
                    disabled={working}
                    onClick={() => inputRef.current?.click()}
                  >
                    <img src="/icons/chatbot/Camera.svg" alt="" aria-hidden="true" />
                    사진 촬영하기
                  </button>
                )}
                <p className="chat-image-footer-helper">
                  {previewUrl
                    ? '이 사진으로 음악 찾기를 누르면 추천을 시작해요.'
                    : '카메라로 지금 주변의 풍경을 담아주세요.'}
                </p>
              </div>
              <button
                type="button"
                className="chat-image-primary"
                disabled={working || !file || uncertain}
                onClick={() => void confirm()}
              >
                {working
                  ? '분석 중…'
                  : hasAcceptedId
                    ? '분석 결과 다시 확인'
                    : previewUrl
                      ? '이 사진으로 음악 찾기'
                      : '주변을 촬영한 뒤 음악을 찾아보세요'}
              </button>
            </footer>
            {rejected && (
              <div className="chat-image-sheet-backdrop">
                <section
                  ref={sheetRef}
                  className="chat-image-retake-sheet"
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="chat-image-rejected-title"
                  aria-describedby="chat-image-rejected-description"
                >
                  <button
                    className="chat-image-sheet-close"
                    type="button"
                    aria-label="팝업 닫기"
                    onClick={() => setRejected(false)}
                  >
                    ×
                  </button>
                  <img src="/icons/chatbot/image_warning.svg" alt="" aria-hidden="true" />
                  <h3 id="chat-image-rejected-title">이미지 속 장면을 확인하기 어려워요</h3>
                  <p id="chat-image-rejected-description">장면이 잘 보이도록 다시 촬영해 주세요.</p>
                  <button className="chat-image-primary" type="button" onClick={retake}>
                    다시 촬영하기
                  </button>
                </section>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
