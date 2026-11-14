import { useEffect, useRef, type RefObject } from 'react';
import './chatMusicToast.css';

interface ChatMusicToastProps {
  dialog: RefObject<HTMLDialogElement | null>;
  isOpen: boolean;
  notice: string;
  isCoolingDown: boolean;
  isVideoCoolingDown: boolean;
}

function hideToast(element: HTMLDivElement | null) {
  if (!element) return;
  if (typeof element.hidePopover === 'function' && element.matches(':popover-open'))
    element.hidePopover();
  element.dataset.visible = 'false';
  element.textContent = '';
}

function positionToast(element: HTMLDivElement, modal: HTMLDialogElement) {
  const box = modal.getBoundingClientRect();
  element.style.setProperty('--toast-left', `${box.left + box.width / 2}px`);
  element.style.setProperty('--toast-width', `${Math.max(0, box.width - 32)}px`);
  element.style.setProperty('--toast-top', `${(window.visualViewport?.offsetTop ?? 0) + 16}px`);
  element.style.setProperty(
    '--toast-height',
    `${Math.max(80, (window.visualViewport?.height ?? window.innerHeight) - 32)}px`,
  );
}

export function ChatMusicToast({
  dialog,
  isOpen,
  notice,
  isVideoCoolingDown,
}: ChatMusicToastProps) {
  const toast = useRef<HTMLDivElement>(null);
  const previous = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const messages = [
      ...(isVideoCoolingDown ? ['영상 검색·신청은 잠시 후 다시 이용해 주세요.'] : []),
      ...(notice ? [notice] : []),
    ];
    const visibleMessages = messages.filter(
      (message) => message !== '잠시 후 다음 요청을 보낼 수 있어요.',
    );
    const fresh = visibleMessages.filter((message) => !previous.current.has(message));
    previous.current = new Set(visibleMessages);
    if (!isOpen) {
      generation.current++;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      hideToast(toast.current);
      return;
    }
    if (!fresh.length) return;
    const current = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    queueMicrotask(() => {
      const element = toast.current;
      const modal = dialog.current;
      if (!element || !modal?.open || current !== generation.current) return;
      positionToast(element, modal);
      element.textContent = fresh.join(' ');
      element.dataset.visible = 'true';
      if (typeof element.showPopover === 'function') element.showPopover();
      else {
        element.removeAttribute('popover');
        element.dataset.fallback = 'true';
      }
      timer.current = setTimeout(() => {
        hideToast(element);
        timer.current = null;
      }, 5000);
    });
  }, [dialog, isOpen, notice, isVideoCoolingDown]);

  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      const element = toast.current;
      const modal = dialog.current;
      if (element && modal) positionToast(element, modal);
    };
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [dialog, isOpen]);

  useEffect(
    () => () => {
      generation.current++;
      previous.current = new Set();
      if (timer.current) clearTimeout(timer.current);
      hideToast(toast.current);
    },
    [],
  );

  return (
    <div
      ref={toast}
      className="chat-music-toast"
      popover="manual"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-visible="false"
    />
  );
}
