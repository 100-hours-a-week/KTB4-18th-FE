import { useCallback, useEffect, useRef, useState } from 'react';

import { navigate } from '../../../shared/navigation';
import { getHighResolutionArtworkUrl } from '../../../shared/albumArtwork';
import {
  createMusicRecord,
  deleteMusicRecords,
  getMusicRecords,
  MusicApiError,
  searchMusic,
  type Music,
  type MusicRecord,
} from '../api/musicRecordsApi';
import { useLocation } from '../hooks/useLocation';
import { useMusicRecordRegionFilter } from '../hooks/useMusicRecordRegionFilter';
import { MusicRecordRegionFilter } from './MusicRecordRegionFilter';
import { useMusicPreview } from '../hooks/useMusicPreview';
import { formatMusicRecordDate } from '../model/formatMusicRecordDate';
import { musicRecordFilterPath, readMusicRecordSidoCode } from '../model/musicRecordFilterPath';
import { formatMusicRecordTime } from '../model/formatMusicRecordTime';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';
import { MusicRecordDeleteDialog } from './MusicRecordDeleteDialog';

const replacementDraftKey = (recordId: number) => `music-record-replacement-draft:${recordId}`;

export function MusicRecordListPage() {
  const [items, setItems] = useState<MusicRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const regionFilter = useMusicRecordRegionFilter();
  const visibleItems =
    regionFilter.selectedSidoCode === null ? items : regionFilter.filteredSnapshot;
  const isFilterDisabled = isSelecting || isDeleting || isLoading || regionFilter.isSnapshotLoading;
  const mutationPending = useRef(false);
  const requestGeneration = useRef(0);
  const active = useRef(true);
  const [completionFlags] = useState(() => ({
    updated: sessionStorage.getItem('music_record_updated') === '1',
    deleted: sessionStorage.getItem('music_record_deleted') === '1',
  }));
  const [missingNotice] = useState(() =>
    sessionStorage.getItem('music_record_missing') === '1'
      ? '이미 삭제되었거나 없는 기록이에요'
      : '',
  );
  const toastSequence = useRef(0);
  const [toast, setToast] = useState<{ message: string; sequence: number } | null>(null);
  const showToast = useCallback((message: string) => {
    toastSequence.current += 1;
    setToast({ message, sequence: toastSequence.current });
  }, []);

  useEffect(() => {
    sessionStorage.removeItem('music_record_updated');
    sessionStorage.removeItem('music_record_deleted');
    sessionStorage.removeItem('music_record_missing');
    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      if (completionFlags.deleted) showToast('기록이 삭제되었어요');
      else if (completionFlags.updated) showToast('기록이 수정되었어요');
    });
    return () => {
      isActive = false;
    };
  }, [completionFlags, showToast]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const load = useCallback(async (next?: string | null) => {
    const generation = ++requestGeneration.current;
    setIsLoading(true);
    setError('');
    try {
      const page = await getMusicRecords(next);
      if (!active.current || generation !== requestGeneration.current) return;
      if (!next) setSelectedIds([]);
      setItems((old) => (next ? [...old, ...page.items] : page.items));
      setCursor(page.next_cursor);
      setHasNext(page.has_next);
    } catch (caught) {
      if (active.current && generation === requestGeneration.current)
        setError(caught instanceof Error ? caught.message : '기록을 불러오지 못했습니다.');
    } finally {
      if (active.current && generation === requestGeneration.current) setIsLoading(false);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    queueMicrotask(() => {
      if (active.current) void load();
    });
    return () => {
      active.current = false;
      requestGeneration.current += 1;
    };
  }, [load]);

  const removeSelected = async () => {
    if (!selectedIds.length || mutationPending.current) return;
    const idsToDelete = [...selectedIds];
    mutationPending.current = true;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await deleteMusicRecords(idsToDelete, AbortSignal.timeout(10_000));
      if (!active.current) return;
      regionFilter.removeFromSnapshot(idsToDelete);
      showToast(`${idsToDelete.length}개의 기록이 삭제되었어요`);
      setIsDeleteOpen(false);
      setIsSelecting(false);
      setItems((old) => old.filter((record) => !idsToDelete.includes(record.record_id)));
      setCursor(null);
      setHasNext(false);
      setSelectedIds([]);
      await load();
    } catch (caught) {
      if (!active.current) return;
      setDeleteError(
        caught instanceof MusicApiError && caught.status === 401
          ? '로그인이 만료되었어요. 다시 로그인해 주세요.'
          : caught instanceof MusicApiError && caught.status === 403
            ? '본인이 작성한 기록만 삭제할 수 있어요. 삭제는 완료되지 않았어요.'
            : caught instanceof MusicApiError && caught.status === 404
              ? '이미 삭제되었거나 없는 기록이 포함되어 있어요. 취소 후 목록을 새로고침해 주세요.'
              : (caught instanceof Error || caught instanceof DOMException) &&
                  caught.name === 'TimeoutError'
                ? '삭제 응답 시간이 초과됐어요. 취소 후 목록을 새로고침해 결과를 확인해 주세요.'
                : '기록을 삭제하지 못했어요. 다시 시도해 주세요.',
      );
    } finally {
      mutationPending.current = false;
      if (active.current) setIsDeleting(false);
    }
  };

  const handleTrashClick = () => {
    if (isLoading || isDeleting || (!isSelecting && !items.length)) return;
    setDeleteError('');
    if (!isSelecting) {
      setIsSelecting(true);
      setSelectedIds([]);
    } else if (selectedIds.length) {
      setIsDeleteOpen(true);
    } else {
      setIsSelecting(false);
    }
  };

  return (
    <main className="music-page music-record-list-page">
      <header className="music-page-header">
        <a
          href="/"
          className="music-list-back"
          aria-label="메인으로 돌아가기"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          <img src="/icons/chatbot/Arrow-reft.svg" alt="" />
        </a>
        <h1 className="text-title2-bold">음악 기록</h1>
        <button
          type="button"
          className={`music-list-trash${isSelecting ? ' is-selecting' : ''}`}
          aria-label={
            isSelecting
              ? selectedIds.length
                ? '선택한 기록 삭제 확인'
                : '삭제 선택 종료'
              : '삭제할 기록 선택'
          }
          disabled={isLoading || isDeleting || (!isSelecting && !items.length)}
          onClick={handleTrashClick}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 7h16M10 11v6m4-6v6M5.5 7l1 13h11l1-13M9 7V4h6v3"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>
      <div className="music-list-content">
        {missingNotice && (
          <p role="status" className="music-success">
            {missingNotice}
          </p>
        )}
        {error && (
          <p role="alert" className="music-error">
            {error}
          </p>
        )}
        {isSelecting && (
          <p className="record-delete-count" role="status">
            삭제할 음악 기록 {selectedIds.length}곡
          </p>
        )}
        {isSelecting && deleteError && (
          <button
            type="button"
            className="music-secondary-button"
            disabled={isLoading || isDeleting}
            onClick={() => {
              setDeleteError('');
              void load();
              regionFilter.refreshSnapshot();
            }}
          >
            목록 새로고침
          </button>
        )}
        <MusicRecordRegionFilter
          regions={regionFilter.regions}
          selectedSidoCode={regionFilter.selectedSidoCode}
          isDisabled={isFilterDisabled}
          isLoading={regionFilter.isSnapshotLoading}
          error={regionFilter.snapshotError}
          onSelect={(code) => {
            if (!isFilterDisabled) regionFilter.setSelectedSidoCode(code);
          }}
        />
        {!isSelecting && !isLoading && visibleItems.length > 0 && (
          <div className="record-list-count">검색 결과 {visibleItems.length}곡</div>
        )}
        {isLoading && !items.length && <p role="status">기록을 불러오는 중…</p>}
        <section
          className={`record-list${isSelecting ? ' selecting' : ''}`}
          aria-label="음악 기록 목록"
        >
          {visibleItems.map((record) => {
            const selected = selectedIds.includes(record.record_id);
            const placeName =
              record.custom_place_name?.trim() ||
              `${record.region.sido.name} ${record.region.sigungu.name}`;
            const content = (
              <>
                {record.music.album_cover_url ? (
                  <img
                    className="record-cover"
                    src={getHighResolutionArtworkUrl(record.music.album_cover_url) ?? ''}
                    alt=""
                  />
                ) : (
                  <span className="record-cover-placeholder" aria-hidden="true" />
                )}
                <div className="record-card-copy">
                  <h2>{record.music.title}</h2>
                  <p className="record-artist">{record.music.artist_name}</p>
                  <p className="record-location">{placeName}</p>
                  <div className="record-card-meta-row">
                    <time dateTime={record.created_at}>
                      {formatMusicRecordTime(record.created_at)}
                    </time>
                    {isSelecting && <span className="record-select-indicator" aria-hidden="true" />}
                  </div>
                </div>
              </>
            );
            if (isSelecting) {
              return (
                <button
                  type="button"
                  key={record.record_id}
                  className={`record-card${selected ? ' selected' : ''}`}
                  aria-pressed={selected}
                  aria-label={`${record.music.title} 기록 선택`}
                  disabled={isDeleting || (!selected && selectedIds.length >= 100)}
                  onClick={() =>
                    setSelectedIds((ids) =>
                      ids.includes(record.record_id)
                        ? ids.filter((id) => id !== record.record_id)
                        : [...ids, record.record_id],
                    )
                  }
                >
                  {content}
                </button>
              );
            }
            return (
              <a
                className="record-card"
                key={record.record_id}
                href={musicRecordFilterPath(
                  `/music-records/${record.record_id}`,
                  regionFilter.selectedSidoCode,
                )}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(
                    musicRecordFilterPath(
                      `/music-records/${record.record_id}`,
                      regionFilter.selectedSidoCode,
                    ),
                  );
                }}
                aria-label={`${record.music.title} 기록 상세 보기`}
              >
                {content}
              </a>
            );
          })}
        </section>
        {isDeleteOpen && (
          <MusicRecordDeleteDialog
            count={selectedIds.length}
            isDeleting={isDeleting}
            error={deleteError}
            onCancel={() => setIsDeleteOpen(false)}
            onConfirm={() => void removeSelected()}
          />
        )}
        {regionFilter.selectedSidoCode === null && hasNext && (
          <button
            className="music-secondary-button"
            disabled={isLoading}
            onClick={() => void load(cursor)}
          >
            더 불러오기
          </button>
        )}
        {!items.length && !error && !isLoading && (
          <p className="music-empty">아직 기록한 음악이 없어요.</p>
        )}
      </div>
      <div
        className="music-record-toast"
        role={toast ? 'status' : undefined}
        aria-live="polite"
        aria-atomic="true"
      >
        {toast && <span key={toast.sequence}>{toast.message}</span>}
      </div>
    </main>
  );
}

export function MusicRecordCreatePage() {
  const selectedSidoCode = readMusicRecordSidoCode();
  const listPath = musicRecordFilterPath('/music-records', selectedSidoCode);
  const replacementParams = new URLSearchParams(window.location.search).getAll('replaceRecordId');
  const hasReplacementParam = replacementParams.length > 0;
  const replacementRecordId = (() => {
    if (replacementParams.length !== 1 || !/^[0-9]+$/.test(replacementParams[0])) return null;
    const parsed = Number(replacementParams[0]);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  })();
  const hasInvalidReplacementParam = hasReplacementParam && replacementRecordId === null;
  const preview = useMusicPreview();
  const stopPreview = preview.stop;
  const [step, setStep] = useState<'search' | 'form'>('search');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Music[]>([]);
  const [selected, setSelected] = useState<Music | null>(null);
  const [place, setPlace] = useState('');
  const [memo, setMemo] = useState('');
  const [formEnteredAt, setFormEnteredAt] = useState<Date>(() => new Date());
  const [showExitWarning, setShowExitWarning] = useState(false);
  const [saveResultUnclear, setSaveResultUnclear] = useState(false);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [lastPageSize, setLastPageSize] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchRequestId = useRef(0);
  const replacementPending = useRef(false);
  const isLoadingPage = useRef(false);
  const usedCursors = useRef(new Set<string>());
  const hasRecoveredCursor = useRef(false);
  const lastPageLoadScroll = useRef<number | null>(null);
  const hasSentinelLeft = useRef(false);
  const hasScrolledSinceLoad = useRef(false);
  const isSentinelVisible = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const placeInput = useRef<HTMLInputElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  useEffect(() => {
    const normalized = query.trim();
    const requestId = ++searchRequestId.current;
    if (normalized.length < 2 || hasInvalidReplacementParam) return;
    const timer = window.setTimeout(() => {
      setIsSearching(true);
      void searchMusic(normalized)
        .then((page) => {
          if (requestId !== searchRequestId.current) return;
          setItems(page.items);
          setCursor(page.next_cursor);
          setHasNext(page.has_next);
          setLastPageSize(page.items.length);
          setHasSearched(true);
          setError('');
        })
        .catch((caught: unknown) => {
          if (requestId !== searchRequestId.current) return;
          setError(
            caught instanceof MusicApiError && caught.status === 400
              ? '두 글자 이상의 검색어를 입력해 주세요.'
              : caught instanceof MusicApiError && caught.status === 502
                ? '음악 검색 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
                : '음악을 찾지 못했습니다. 다시 시도해 주세요.',
          );
        })
        .finally(() => {
          if (requestId === searchRequestId.current) setIsSearching(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, hasInvalidReplacementParam]);

  const handleQueryChange = (value: string) => {
    stopPreview();
    searchRequestId.current += 1;
    usedCursors.current.clear();
    hasRecoveredCursor.current = false;
    isLoadingPage.current = false;
    lastPageLoadScroll.current = null;
    hasSentinelLeft.current = false;
    hasScrolledSinceLoad.current = false;
    isSentinelVisible.current = false;
    setQuery(value);
    setItems([]);
    setSelected(null);
    setCursor(null);
    setHasNext(false);
    setHasSearched(false);
    setLastPageSize(0);
    setError('');
    setIsSearching(false);
  };

  const loadNextPage = useCallback(async () => {
    if (!cursor || !hasNext || isLoadingPage.current || usedCursors.current.has(cursor)) return;
    if (
      lastPageLoadScroll.current !== null &&
      window.scrollY <= lastPageLoadScroll.current &&
      !(hasSentinelLeft.current && hasScrolledSinceLoad.current)
    )
      return;
    isLoadingPage.current = true;
    usedCursors.current.add(cursor);
    lastPageLoadScroll.current = window.scrollY;
    hasSentinelLeft.current = false;
    hasScrolledSinceLoad.current = false;
    const requestId = searchRequestId.current;
    setIsSearching(true);
    try {
      const page = await searchMusic(query.trim(), cursor);
      if (requestId !== searchRequestId.current) return;
      setItems((old) => [...old, ...page.items]);
      setCursor(page.next_cursor);
      setHasNext(page.has_next);
      setLastPageSize(page.items.length);
    } catch (caught) {
      if (requestId !== searchRequestId.current) return;
      if (caught instanceof MusicApiError && caught.status === 400) {
        if (hasRecoveredCursor.current) {
          setHasNext(false);
          setError('검색을 계속할 수 없습니다. 검색어를 다시 입력해 주세요.');
          return;
        }
        hasRecoveredCursor.current = true;
        usedCursors.current.clear();
        stopPreview();
        setItems([]);
        setCursor(null);
        setHasNext(false);
        setLastPageSize(0);
        try {
          const page = await searchMusic(query.trim());
          if (requestId !== searchRequestId.current) return;
          setItems(page.items);
          setCursor(page.next_cursor);
          setHasNext(page.has_next);
          setLastPageSize(page.items.length);
        } catch {
          if (requestId === searchRequestId.current)
            setError('검색을 다시 시작하지 못했습니다. 검색어를 다시 입력해 주세요.');
        }
      } else setError('음악을 더 불러오지 못했습니다. 다시 검색해 주세요.');
    } finally {
      if (requestId === searchRequestId.current) {
        isLoadingPage.current = false;
        setIsSearching(false);
      }
    }
  }, [cursor, hasNext, query, stopPreview]);

  useEffect(() => {
    if (
      step !== 'search' ||
      !hasNext ||
      !cursor ||
      !sentinel.current ||
      typeof IntersectionObserver === 'undefined'
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        isSentinelVisible.current = entry.isIntersecting;
        if (!entry.isIntersecting) hasSentinelLeft.current = true;
        else void loadNextPage();
      },
      { rootMargin: '180px' },
    );
    observer.observe(sentinel.current);
    const onScroll = () => {
      if (lastPageLoadScroll.current !== null && window.scrollY !== lastPageLoadScroll.current) {
        hasScrolledSinceLoad.current = true;
      }
      if (isSentinelVisible.current) void loadNextPage();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      isSentinelVisible.current = false;
    };
  }, [step, cursor, hasNext, items.length, loadNextPage]);

  useEffect(() => {
    if (step === 'form') placeInput.current?.focus();
    else queryInput.current?.focus();
  }, [step]);

  const save = async () => {
    if (!selected || isSaving) return;
    setIsSaving(true);
    setSaveResultUnclear(false);
    setError('');
    let createRequestStarted = false;
    try {
      if (location.location && location.isExpired()) {
        throw new Error('위치 확인 시간이 만료됐어요. 현재 위치 확인 버튼으로 다시 시도해 주세요.');
      }
      const resolved = location.location ?? (await location.acquire());
      createRequestStarted = true;
      await createMusicRecord(selected, resolved.location_resolution_token, place, memo);
      navigate(listPath);
    } catch (caught) {
      if (
        createRequestStarted &&
        caught instanceof MusicApiError &&
        caught.status === null &&
        caught.requestWasSent
      ) {
        setSaveResultUnclear(true);
        setError('저장 결과를 확인하지 못했습니다. 음악 기록 목록에서 저장 여부를 확인해 주세요.');
        return;
      }
      setError(
        caught instanceof MusicApiError && caught.status === 401
          ? '로그인한 뒤 다시 시도해 주세요.'
          : caught instanceof MusicApiError && caught.status === 404
            ? '위치를 다시 확인해 주세요.'
            : caught instanceof MusicApiError && caught.status === 400
              ? '입력 내용 또는 위치 확인 시간이 유효한지 확인해 주세요.'
              : caught instanceof MusicApiError &&
                  caught.status === 502 &&
                  caught.message === 'music metadata invalid'
                ? '선택한 곡의 음악 정보를 저장할 수 없습니다. 다른 곡을 선택해 주세요.'
                : caught instanceof MusicApiError && caught.status === 500
                  ? '서버에서 기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'
                  : caught instanceof Error
                    ? caught.message
                    : '기록을 저장하지 못했습니다.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const replaceSelectedMusic = () => {
    if (!selected || replacementRecordId === null || replacementPending.current) return;
    replacementPending.current = true;
    setIsReplacing(true);
    setError('');
    stopPreview();
    try {
      const key = replacementDraftKey(replacementRecordId);
      const serializedDraft = window.sessionStorage.getItem(key);
      const draft: unknown = serializedDraft === null ? null : JSON.parse(serializedDraft);
      if (
        !draft ||
        typeof draft !== 'object' ||
        !('recordId' in draft) ||
        draft.recordId !== replacementRecordId ||
        !('status' in draft) ||
        draft.status !== 'pending' ||
        !('place' in draft) ||
        typeof draft.place !== 'string' ||
        !('memo' in draft) ||
        typeof draft.memo !== 'string' ||
        !('baselineUpdatedAt' in draft) ||
        (typeof draft.baselineUpdatedAt !== 'string' && draft.baselineUpdatedAt !== null) ||
        !('baselineMusicId' in draft) ||
        (typeof draft.baselineMusicId !== 'number' && draft.baselineMusicId !== null)
      ) {
        throw new Error(
          '임시 입력 내용을 확인할 수 없습니다. 상세 화면으로 돌아가 다시 시도해 주세요.',
        );
      }
      window.sessionStorage.setItem(
        key,
        JSON.stringify({ ...draft, music: selected, status: 'pending' }),
      );
      navigate(musicRecordFilterPath(`/music-records/${replacementRecordId}`, selectedSidoCode));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '선택한 곡을 임시 저장하지 못했습니다.');
      replacementPending.current = false;
      setIsReplacing(false);
    }
  };

  const sentinelIndex = items.length - lastPageSize + Math.min(10, lastPageSize) - 1;
  const entryDate = formatMusicRecordDate(formEnteredAt);
  const hasCreateChanges = place !== '' || memo !== '';
  return (
    <main className={`music-page ${step === 'search' ? 'music-search-page' : 'music-create-page'}`}>
      <header className="music-page-header">
        <button
          ref={backButton}
          type="button"
          className="music-back"
          aria-label={
            hasInvalidReplacementParam
              ? '음악 기록 목록으로 돌아가기'
              : replacementRecordId !== null
                ? '음악 기록 상세로 돌아가기'
                : '뒤로가기'
          }
          disabled={isSaving || isReplacing}
          onClick={() => {
            if (replacementRecordId !== null) {
              stopPreview();
              navigate(
                musicRecordFilterPath(`/music-records/${replacementRecordId}`, selectedSidoCode),
              );
              return;
            }
            if (hasInvalidReplacementParam) {
              navigate(listPath);
              return;
            }
            if (step === 'form' && hasCreateChanges) setShowExitWarning(true);
            else navigate('/');
          }}
        >
          <img src="/icons/chatbot/Arrow-reft.svg" alt="" aria-hidden="true" />
        </button>
        <h1 className="text-title2-bold">{step === 'search' ? '음악 검색' : '음악 기록'}</h1>
        <span aria-hidden="true" />
      </header>
      {hasInvalidReplacementParam ? (
        <section className="music-form" aria-label="잘못된 음악 변경 요청">
          <p role="alert" className="music-error">
            음악 변경 기록 번호가 올바르지 않습니다. 상세 화면에서 다시 시도해 주세요.
          </p>
          <button
            type="button"
            className="music-secondary-button"
            onClick={() => navigate(listPath)}
          >
            음악 기록 목록으로 이동
          </button>
        </section>
      ) : step === 'search' || replacementRecordId !== null ? (
        <>
          <form className="music-search" onSubmit={(event) => event.preventDefault()}>
            <label className="sr-only" htmlFor="music-query">
              음악 검색
            </label>
            <span className="music-search-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" focusable="false">
                <circle cx="6.75" cy="6.75" r="4.75" />
                <path d="m10.25 10.25 3.25 3.25" />
              </svg>
            </span>
            <input
              ref={queryInput}
              id="music-query"
              autoComplete="off"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              placeholder="곡 제목, 아티스트 검색"
            />
          </form>
          {query.trim().length === 1 && (
            <p className="music-search-count">두 글자 이상 입력해 주세요.</p>
          )}
          {hasSearched && <p className="music-search-count">검색 결과 {items.length}곡</p>}
          {error && (
            <p role="alert" className="music-error">
              {error}
            </p>
          )}
          <section className="search-results" aria-label="음악 검색 결과">
            {items.map((music, index) => (
              <div key={`${music.provider}-${music.external_music_id}`}>
                <div className="music-result-row">
                  <div
                    className={`music-result${selected?.external_music_id === music.external_music_id ? ' selected' : ''}`}
                    role="group"
                    aria-label={`${music.title} ${music.artist_name}`}
                  >
                    <button
                      type="button"
                      aria-pressed={selected?.external_music_id === music.external_music_id}
                      className="music-result-select"
                      disabled={isReplacing}
                      onClick={() => {
                        setSelected(music);
                        setError('');
                      }}
                    >
                      {music.album_cover_url ? (
                        <img
                          src={getHighResolutionArtworkUrl(music.album_cover_url) ?? ''}
                          alt=""
                        />
                      ) : (
                        <span className="music-cover-placeholder" aria-hidden="true" />
                      )}
                      <span>
                        <strong>{music.title}</strong>
                        <small>{music.artist_name}</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="music-preview-button"
                      disabled={!music.preview_url}
                      aria-label={`${music.title} ${music.artist_name} ${
                        !music.preview_url
                          ? '미리 듣기 불가'
                          : preview.activeTrack === music.external_music_id &&
                              (preview.isPlaying || preview.isLoading)
                            ? '미리 듣기 일시정지'
                            : '미리 듣기 재생'
                      }`}
                      aria-pressed={
                        preview.activeTrack === music.external_music_id && preview.isPlaying
                      }
                      onClick={() => {
                        if (music.preview_url)
                          void preview.toggle(music.external_music_id, music.preview_url);
                      }}
                    >
                      <img
                        src={
                          preview.activeTrack === music.external_music_id && preview.isPlaying
                            ? '/icons/chatbot/Play-stop.svg'
                            : '/icons/chatbot/Playbutton.svg'
                        }
                        alt=""
                        aria-hidden="true"
                      />
                      <span className="sr-only">
                        {!music.preview_url
                          ? '미리 듣기 불가'
                          : preview.activeTrack === music.external_music_id && preview.isLoading
                            ? '로딩 취소'
                            : preview.activeTrack === music.external_music_id && preview.isPlaying
                              ? '미리 듣기 일시정지'
                              : '미리 듣기 재생'}
                      </span>
                    </button>
                  </div>
                </div>
                {hasNext && index === sentinelIndex && (
                  <div ref={sentinel} data-testid="music-page-sentinel" />
                )}
              </div>
            ))}
          </section>
          {preview.error && (
            <p role="alert" className="music-error">
              {preview.error}
            </p>
          )}
          {preview.isLoading && <p role="status">미리 듣기 음원을 불러오는 중…</p>}
          {isSearching && (
            <p role="status" className="music-search-count">
              검색 중…
            </p>
          )}
          <div className="music-search-footer">
            <button
              type="button"
              className="music-primary-button"
              disabled={!selected || isReplacing}
              onClick={() => {
                stopPreview();
                if (replacementRecordId !== null) {
                  void replaceSelectedMusic();
                  return;
                }
                setFormEnteredAt(new Date());
                setStep('form');
              }}
            >
              {isReplacing
                ? '음악 변경 중…'
                : replacementRecordId !== null
                  ? '이 곡으로 변경'
                  : '선택하기'}
            </button>
          </div>
        </>
      ) : (
        <section className="music-form" aria-label="음악 기록 입력">
          <article className="music-selected-content">
            {selected?.album_cover_url ? (
              <img src={getHighResolutionArtworkUrl(selected.album_cover_url) ?? ''} alt="" />
            ) : (
              <span className="music-cover-placeholder" aria-hidden="true" />
            )}
            <div className="music-track-info">
              <strong>{selected?.title}</strong>
              <span>{selected?.artist_name}</span>
            </div>
            <button
              type="button"
              className="music-change-button"
              onClick={() => {
                stopPreview();
                setStep('search');
              }}
            >
              음악 변경
            </button>
          </article>
          <label>
            저장 날짜
            <input value={entryDate} readOnly aria-readonly="true" />
          </label>
          <label>
            저장 장소
            <input
              readOnly
              aria-readonly="true"
              value={
                location.location
                  ? `${location.location.region.sido.name} ${location.location.region.sigungu.name}`
                  : ''
              }
              placeholder="현재 위치를 확인해 주세요"
            />
          </label>
          <label>
            장소 이름
            <input
              ref={placeInput}
              value={place}
              maxLength={100}
              onChange={(event) => setPlace(event.target.value)}
              placeholder="장소 이름 (선택)"
            />
          </label>
          <label>
            지금 느끼는 것 기록
            <textarea
              aria-label="지금 느끼는 것 기록"
              aria-describedby="create-memo-count"
              value={memo}
              maxLength={500}
              onChange={(event) => setMemo(event.target.value.slice(0, 500))}
              placeholder="내용을 입력해 주세요."
            />
            <span className="music-memo-count" id="create-memo-count" aria-live="polite">
              {memo.length}/500
            </span>
          </label>
          {(!location.location || location.isExpired()) && (
            <button
              type="button"
              className="music-secondary-button"
              disabled={location.isLocating}
              onClick={() => void location.acquire().catch(() => undefined)}
            >
              {location.isLocating ? '현재 위치 확인 중…' : '현재 위치 확인'}
            </button>
          )}
          {(location.error || error) && (
            <div role="alert" className="music-error">
              <p>{location.error || error}</p>
              {saveResultUnclear && (
                <button type="button" onClick={() => navigate(listPath)}>
                  음악 기록 목록에서 확인
                </button>
              )}
            </div>
          )}
          <button
            type="button"
            className="music-primary-button"
            disabled={isSaving || location.isLocating}
            onClick={() => void save()}
          >
            {isSaving ? '저장 중…' : '저장'}
          </button>
        </section>
      )}
      <UnsavedChangesDialog
        open={showExitWarning}
        onCancel={() => {
          setShowExitWarning(false);
          requestAnimationFrame(() => backButton.current?.focus());
        }}
        onConfirm={() => navigate('/')}
      />
    </main>
  );
}
