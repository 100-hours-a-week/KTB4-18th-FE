import { flushSync } from 'react-dom';

import { navigate, ROUTE_CHANGE_EVENT } from '../../../shared/navigation';
import type { MusicRecord } from '../api/musicRecordsApi';
import './musicRecordTransition.css';

type RecordPreview = Pick<MusicRecord, 'record_id' | 'music'>;
type ListPreview = {
  items: MusicRecord[];
  regions: { code: string; name: string }[];
  pageCount: number;
  hasNext: boolean;
};
type ListReturn = {
  href: string;
  scrollTop: number;
  preview: ListPreview;
};

const CARD_READY_TIMEOUT_MS = 300;

let isTransitioning = false;
let activeRecordPreview: RecordPreview | null = null;
let activeListPreview: ListReturn | null = null;
let activeListTransition: Promise<void> | undefined;
let lastList: ListReturn | null = null;

export function getMusicRecordTransitionPreview(recordId: number): RecordPreview | null {
  return activeRecordPreview?.record_id === recordId ? activeRecordPreview : null;
}

export function getMusicRecordListTransitionPreview(): ListPreview | null {
  return activeListPreview?.href === window.location.href ? activeListPreview.preview : null;
}

export function getMusicRecordListTransitionCompletion() {
  return activeListTransition;
}

function rememberList(list: ListReturn, detailHref: string) {
  lastList = list;
  const listeners = new AbortController();
  const clear = () => {
    if (window.location.href === detailHref) return;
    if (lastList === list) lastList = null;
    listeners.abort();
  };
  window.addEventListener(ROUTE_CHANGE_EVENT, clear, { signal: listeners.signal });
  window.addEventListener('popstate', clear, { signal: listeners.signal });
}

function recordCardSelector(page: string, recordId: number) {
  return `${page} [data-music-record-card="${recordId}"]`;
}

function waitForCard(selector: string): Promise<HTMLElement | null> {
  const existing = document.querySelector<HTMLElement>(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const card = document.querySelector<HTMLElement>(selector);
      if (card) finish(card);
    });
    const timeout = window.setTimeout(() => finish(null), CARD_READY_TIMEOUT_MS);

    function finish(card: HTMLElement | null) {
      observer.disconnect();
      window.clearTimeout(timeout);
      resolve(card);
    }

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

type CardTransition = {
  source: HTMLElement | null;
  open: (completion?: Promise<void>) => void;
  destination: string;
  mode?: 'detail' | 'list';
  beforeCapture?: (card: HTMLElement) => void;
};

function isCardInViewport(card: HTMLElement) {
  const bounds = card.getBoundingClientRect();
  const viewport = document.documentElement;
  const header = card.closest('.music-page')?.querySelector(':scope > .music-page-header');
  const visibleTop = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);

  return (
    bounds.bottom > visibleTop &&
    bounds.top < viewport.clientHeight &&
    bounds.right > 0 &&
    bounds.left < viewport.clientWidth
  );
}

function transitionCard({ source, open, destination, mode, beforeCapture }: CardTransition) {
  if (isTransitioning) return;
  if (
    !source ||
    typeof document.startViewTransition !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    open();
    return;
  }

  isTransitioning = true;
  const from = window.location.href;
  const root = document.documentElement;
  root.dataset.musicRecordTransition = mode ?? '';
  source.dataset.musicRecordTransitionCard = '';
  let target: HTMLElement | null = null;

  const cleanup = () => {
    isTransitioning = false;
    activeRecordPreview = null;
    activeListPreview = null;
    activeListTransition = undefined;
    delete root.dataset.musicRecordTransition;
    delete source.dataset.musicRecordTransitionCard;
    if (target) delete target.dataset.musicRecordTransitionCard;
  };

  const transition = document.startViewTransition(async () => {
    if (window.location.href !== from) {
      transition.skipTransition();
      return;
    }

    const isSourceVisible = mode !== 'list' || isCardInViewport(source);
    open(completion);
    target = await waitForCard(destination);
    if (!target) {
      transition.skipTransition();
      return;
    }
    beforeCapture?.(target);
    if (mode === 'list' && (!isSourceVisible || !isCardInViewport(target))) {
      transition.skipTransition();
      return;
    }
    target.dataset.musicRecordTransitionCard = '';
  });

  void transition.ready.catch(() => undefined);
  void transition.updateCallbackDone.catch(() => undefined);
  const completion = transition.finished.then(cleanup, cleanup);
  return completion;
}

export function openMusicRecordDetail(
  link: HTMLAnchorElement,
  record: RecordPreview,
  listPreview: ListPreview,
): void {
  const destination = link.href;
  const list = { href: window.location.href, scrollTop: window.scrollY, preview: listPreview };
  transitionCard({
    source: link,
    destination: recordCardSelector('.music-detail-page', record.record_id),
    mode: 'detail',
    open: () => {
      if (isTransitioning) {
        activeRecordPreview = { record_id: record.record_id, music: record.music };
        rememberList(list, destination);
      }
      navigate(destination);
      if (window.scrollY) window.scrollTo({ top: 0, behavior: 'instant' });
    },
  });
}

export function openMusicRecordList(path: string, recordId: number): void {
  const destination = new URL(path, window.location.origin).href;
  const list = lastList?.href === destination ? lastList : null;
  transitionCard({
    source: document.querySelector(recordCardSelector('.music-detail-page', recordId)),
    destination: recordCardSelector('.music-record-list-page', recordId),
    mode: 'list',
    open: (completion) => {
      if (completion) {
        activeListPreview = list;
        activeListTransition = completion;
      }
      navigate(path);
    },
    beforeCapture: (card) => {
      if (list) {
        if (window.scrollY !== list.scrollTop) {
          window.scrollTo({ top: list.scrollTop, behavior: 'instant' });
        }
      } else {
        card.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    },
  });
}

const SEARCH_SELECTION = '.music-search-page .music-result.selected';
const ENTRY_HERO = '.music-create-page .music-selected-content';

export function transitionMusicRecordEntry(
  step: 'search' | 'form',
  update: () => void,
  scrollTop: number,
) {
  const isEnteringForm = step === 'form';
  const open = () => {
    flushSync(update);
    if (window.scrollY !== scrollTop) window.scrollTo({ top: scrollTop, behavior: 'instant' });
  };
  if (isTransitioning) {
    open();
    return;
  }
  return transitionCard({
    source: document.querySelector(isEnteringForm ? SEARCH_SELECTION : ENTRY_HERO),
    destination: isEnteringForm ? ENTRY_HERO : SEARCH_SELECTION,
    open,
  });
}
