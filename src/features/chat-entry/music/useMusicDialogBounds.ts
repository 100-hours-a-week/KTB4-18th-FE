import { useEffect, type RefObject } from 'react';

/** Native top-layer dialogs need explicit app and visual-viewport bounds, including keyboard pan. */
export function useMusicDialogBounds(ref: RefObject<HTMLDialogElement | null>, isOpen: boolean) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !isOpen) return;
    const app = dialog.closest('.chat-entry-shell');
    const viewport = window.visualViewport;
    const update = () => {
      const box = app?.getBoundingClientRect();
      const left = Math.max(viewport?.offsetLeft ?? 0, box?.width ? box.left : 0);
      const right = Math.min(
        (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth),
        box?.width ? box.right : window.innerWidth,
      );
      const top = Math.max(viewport?.offsetTop ?? 0, box?.height ? box.top : 0);
      const bottom = Math.min(
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
        box?.height ? box.bottom : window.innerHeight,
      );
      const width = Math.max(0, Math.min(600, right - left));
      const height = Math.max(0, Math.min(740, bottom - top - 8));
      dialog.style.setProperty('--music-left', `${left + (right - left - width) / 2}px`);
      dialog.style.setProperty('--music-top', `${bottom - height}px`);
      dialog.style.setProperty('--music-bottom', `${window.innerHeight - bottom}px`);
      dialog.style.setProperty('--music-width', `${width}px`);
      dialog.style.setProperty('--music-height', `${height}px`);
      dialog.classList.toggle('chat-music-compact', height < 300);
    };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (app) observer?.observe(app);
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  }, [ref, isOpen]);
}
