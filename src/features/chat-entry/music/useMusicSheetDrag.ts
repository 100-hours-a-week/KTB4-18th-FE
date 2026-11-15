import { useEffect, useRef, type PointerEvent, type RefObject } from 'react';

type Gesture = { pointerId: number; startY: number; target: HTMLDivElement };

function release(active: RefObject<Gesture | null>, dialog: HTMLDialogElement | null) {
  const gesture = active.current;
  active.current = null;
  dialog?.classList.remove('chat-music-dragging');
  if (gesture?.target.hasPointerCapture?.(gesture.pointerId))
    gesture.target.releasePointerCapture(gesture.pointerId);
}
type Closing = {
  element: HTMLDialogElement;
  end: EventListener;
  timer: ReturnType<typeof setTimeout> | null;
};
function clearClosing(pending: RefObject<Closing | null>) {
  const closing = pending.current;
  pending.current = null;
  if (!closing) return;
  if (closing.timer !== null) clearTimeout(closing.timer);
  closing.element.removeEventListener('transitionend', closing.end);
  closing.element.classList.remove('chat-music-drag-closing');
}
function reset(active: RefObject<Gesture | null>, dialog: HTMLDialogElement | null) {
  release(active, dialog);
  dialog?.style.setProperty('--music-drag-y', '0px');
}

export function useMusicSheetDrag(
  dialog: RefObject<HTMLDialogElement | null>,
  isOpen: boolean,
  onClose: () => void,
  viewKey?: string | null,
) {
  const active = useRef<Gesture | null>(null);
  const pending = useRef<Closing | null>(null);
  useEffect(() => {
    const element = dialog.current;
    const cleanup = () => {
      clearClosing(pending);
      reset(active, element);
    };
    cleanup();
    return cleanup;
  }, [dialog, isOpen, viewKey]);
  const requestClose = () => {
    const element = dialog.current;
    if (!isOpen || !element?.open || pending.current) return;
    release(active, element);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      onClose();
      return;
    }
    const offset = Number.parseFloat(element.style.getPropertyValue('--music-drag-y')) || 0;
    const viewport = window.visualViewport;
    const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
    const target = Math.max(offset, bottom - element.getBoundingClientRect().top + offset + 1);
    const entry: Closing = {
      element,
      timer: null,
      end: (event) => {
        if (event.target === element && (event as TransitionEvent).propertyName === 'translate')
          finish();
      },
    };
    function finish() {
      if (pending.current !== entry) return;
      clearClosing(pending);
      onClose();
    }
    pending.current = entry;
    element.addEventListener('transitionend', entry.end);
    entry.timer = setTimeout(finish, 220);
    element.classList.add('chat-music-drag-closing');
    element.style.setProperty('--music-drag-y', `${target}px`);
  };
  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    if (active.current?.pointerId === event.pointerId) reset(active, dialog.current);
  };
  const handleProps = {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (
        !isOpen ||
        active.current ||
        pending.current ||
        !event.isPrimary ||
        event.button !== 0 ||
        !Number.isFinite(event.clientY) ||
        typeof event.currentTarget.setPointerCapture !== 'function'
      )
        return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      active.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        target: event.currentTarget,
      };
      dialog.current?.style.setProperty('--music-drag-y', '0px');
      dialog.current?.classList.add('chat-music-dragging');
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const gesture = active.current;
      if (!gesture || gesture.pointerId !== event.pointerId || !Number.isFinite(event.clientY))
        return;
      event.preventDefault();
      dialog.current?.style.setProperty(
        '--music-drag-y',
        `${Math.max(0, event.clientY - gesture.startY)}px`,
      );
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      const gesture = active.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const distance = Math.max(0, event.clientY - gesture.startY);
      release(active, dialog.current);
      if (distance >= 8) requestClose();
      else reset(active, dialog.current);
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  };
  return { handleProps, requestClose };
}
