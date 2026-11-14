import { useEffect, type RefObject } from 'react';

export function useMusicSheetHeight(
  ref: RefObject<HTMLDialogElement | null>,
  isOpen: boolean,
  enabled: boolean,
) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !isOpen || !enabled) return;
    const sheet = dialog.querySelector<HTMLElement>('.chat-music-sheet');
    const player = dialog.querySelector<HTMLElement>('.chat-room-player');
    const pane = player?.parentElement;
    if (!sheet || !player || !pane) return;
    let active = true;
    let frame = 0;
    const chrome = [...sheet.children].filter((element) =>
      element.matches('.chat-music-drag-handle, header, nav, .chat-music-footer'),
    );
    const pixels = (value: string) => Number.parseFloat(value) || 0;
    const heightWithMargins = (element: Element) => {
      const style = getComputedStyle(element);
      return (
        element.getBoundingClientRect().height +
        pixels(style.marginTop) +
        pixels(style.marginBottom)
      );
    };
    const measure = () => {
      if (!active || !dialog.open) return;
      let height: number;
      const display = pane.style.getPropertyValue('display');
      const priority = pane.style.getPropertyPriority('display');
      dialog.dataset.musicMeasuringAlbum = '';
      pane.style.setProperty('display', 'block', 'important');
      try {
        height = player.getBoundingClientRect().height;
      } finally {
        if (display) pane.style.setProperty('display', display, priority);
        else pane.style.removeProperty('display');
        delete dialog.dataset.musicMeasuringAlbum;
      }
      if (!Number.isFinite(height) || height <= 0) return;
      const sheetStyle = getComputedStyle(sheet);
      const dialogStyle = getComputedStyle(dialog);
      height +=
        chrome.reduce((sum, element) => sum + heightWithMargins(element), 0) +
        pixels(sheetStyle.paddingTop) +
        pixels(sheetStyle.paddingBottom) +
        pixels(dialogStyle.borderTopWidth) +
        pixels(dialogStyle.borderBottomWidth);
      const value = `${Math.round(height * 64) / 64}px`;
      if (dialog.style.getPropertyValue('--music-album-height') !== value)
        dialog.style.setProperty('--music-album-height', value);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    dialog.dataset.musicAlbumHeight = '';
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    for (const element of [dialog, player, ...chrome]) observer?.observe(element);
    const mutations = new MutationObserver((records) => {
      if (
        records.some(
          ({ target }) =>
            !(target instanceof Element ? target : target.parentElement)?.closest(
              '.chat-room-timeline',
            ),
        )
      )
        schedule();
    });
    mutations.observe(player, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    document.fonts?.addEventListener('loadingdone', schedule);
    void document.fonts?.ready.then(() => {
      if (active) schedule();
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      document.fonts?.removeEventListener('loadingdone', schedule);
      delete dialog.dataset.musicMeasuringAlbum;
      delete dialog.dataset.musicAlbumHeight;
      dialog.style.removeProperty('--music-album-height');
    };
  }, [ref, isOpen, enabled]);
}
