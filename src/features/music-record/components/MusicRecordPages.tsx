import { useCallback, useEffect, useRef, useState } from 'react';

import { navigate } from '../../../shared/navigation';
import {
  createMusicRecord, getMusicRecords, MusicApiError, searchMusic,
  type Music, type MusicRecord,
} from '../api/musicRecordsApi';
import { useLocation } from '../hooks/useLocation';
import { formatMusicRecordTime } from '../model/formatMusicRecordTime';

const regionName = (record: MusicRecord) =>
  `${record.region.sido.name} ${record.region.sigungu.name}`;

export function MusicRecordListPage() {
  const [items, setItems] = useState<MusicRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isUpdated] = useState(() => {
    const updated = sessionStorage.getItem('music_record_updated') === '1';
    sessionStorage.removeItem('music_record_updated');
    return updated;
  });

  const load = useCallback(async (next?: string | null) => {
    setIsLoading(true);
    setError('');
    try {
      const page = await getMusicRecords(next);
      setItems((old) => next ? [...old, ...page.items] : page.items);
      setCursor(page.next_cursor);
      setHasNext(page.has_next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '기록을 불러오지 못했습니다.');
    } finally { setIsLoading(false); }
  }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  return <main className="music-page">
    <header className="music-page-header">
      <a href="/" onClick={(event) => { event.preventDefault(); navigate('/'); }}>‹</a>
      <h1 className="text-title2-bold">음악 기록</h1>
      <a href="/music-records/new" className="music-add text-body2-normal-semibold"
        onClick={(event) => { event.preventDefault(); navigate('/music-records/new'); }}>기록하기</a>
    </header>
    {isUpdated && <p role="status" className="music-success">기록이 수정되었어요</p>}
    {error && <p role="alert" className="music-error">{error}</p>}
    <section className="record-list">{items.map((record) => <a className="record-card"
      key={record.record_id} href={`/music-records/${record.record_id}`}
      onClick={(event) => { event.preventDefault(); navigate(`/music-records/${record.record_id}`); }}
      aria-label={`${record.music.title} 기록 상세 보기`}>
      {record.music.album_cover_url && <img src={record.music.album_cover_url} alt="" />}
      <div><h2 className="text-heading1-semibold">{record.music.title}</h2>
        <p>{record.music.artist_name}</p>
        <p>{record.custom_place_name || regionName(record)}</p>
        <time dateTime={record.created_at}>{formatMusicRecordTime(record.created_at)}</time></div>
    </a>)}</section>
    {hasNext && <button className="music-secondary-button" disabled={isLoading}
      onClick={() => void load(cursor)}>더 불러오기</button>}
    {!items.length && !error && !isLoading && <p className="music-empty">아직 기록한 음악이 없어요.</p>}
  </main>;
}

export function MusicRecordCreatePage() {
  const [step, setStep] = useState<'search' | 'form'>('search');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Music[]>([]);
  const [selected, setSelected] = useState<Music | null>(null);
  const [place, setPlace] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [lastPageSize, setLastPageSize] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchRequestId = useRef(0);
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
  const location = useLocation();

  useEffect(() => {
    const normalized = query.trim();
    const requestId = ++searchRequestId.current;
    if (normalized.length < 2) return;
    const timer = window.setTimeout(() => {
      setIsSearching(true);
      void searchMusic(normalized).then((page) => {
        if (requestId !== searchRequestId.current) return;
        setItems(page.items);
        setCursor(page.next_cursor);
        setHasNext(page.has_next);
        setLastPageSize(page.items.length);
        setHasSearched(true);
        setError('');
      }).catch((caught: unknown) => {
        if (requestId !== searchRequestId.current) return;
        setError(caught instanceof MusicApiError && caught.status === 400
          ? '두 글자 이상의 검색어를 입력해 주세요.'
          : caught instanceof MusicApiError && caught.status === 502
            ? '음악 검색 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
            : '음악을 찾지 못했습니다. 다시 시도해 주세요.');
      }).finally(() => {
        if (requestId === searchRequestId.current) setIsSearching(false);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const handleQueryChange = (value: string) => {
    searchRequestId.current += 1;
    usedCursors.current.clear();
    hasRecoveredCursor.current = false;
    isLoadingPage.current = false;
    lastPageLoadScroll.current = null;
    hasSentinelLeft.current = false;
    hasScrolledSinceLoad.current = false;
    isSentinelVisible.current = false;
    setQuery(value); setItems([]); setSelected(null); setCursor(null);
    setHasNext(false); setHasSearched(false); setLastPageSize(0); setError(''); setIsSearching(false);
  };

  const loadNextPage = useCallback(async () => {
    if (!cursor || !hasNext || isLoadingPage.current || usedCursors.current.has(cursor)) return;
    if (lastPageLoadScroll.current !== null && window.scrollY <= lastPageLoadScroll.current &&
      !(hasSentinelLeft.current && hasScrolledSinceLoad.current)) return;
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
      setCursor(page.next_cursor); setHasNext(page.has_next); setLastPageSize(page.items.length);
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
        setItems([]); setCursor(null); setHasNext(false); setLastPageSize(0);
        try {
          const page = await searchMusic(query.trim());
          if (requestId !== searchRequestId.current) return;
          setItems(page.items); setCursor(page.next_cursor);
          setHasNext(page.has_next); setLastPageSize(page.items.length);
        } catch {
          if (requestId === searchRequestId.current) setError('검색을 다시 시작하지 못했습니다. 검색어를 다시 입력해 주세요.');
        }
      } else setError('음악을 더 불러오지 못했습니다. 다시 검색해 주세요.');
    } finally {
      if (requestId === searchRequestId.current) { isLoadingPage.current = false; setIsSearching(false); }
    }
  }, [cursor, hasNext, query]);

  useEffect(() => {
    if (step !== 'search' || !hasNext || !cursor || !sentinel.current ||
      typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      isSentinelVisible.current = entry.isIntersecting;
      if (!entry.isIntersecting) hasSentinelLeft.current = true;
      else void loadNextPage();
    }, { rootMargin: '180px' });
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
    setIsSaving(true); setError('');
    try {
      if (location.location && location.isExpired()) {
        throw new Error('위치 확인 시간이 만료됐어요. 현재 위치 확인 버튼으로 다시 시도해 주세요.');
      }
      const resolved = location.location ?? await location.acquire();
      await createMusicRecord(selected, resolved.location_resolution_token, place, memo);
      navigate('/music-records');
    } catch (caught) {
      setError(caught instanceof MusicApiError && caught.status === 401
        ? '로그인한 뒤 다시 시도해 주세요.'
        : caught instanceof MusicApiError && caught.status === 404
          ? '위치를 다시 확인해 주세요.'
          : caught instanceof MusicApiError && caught.status === 400
            ? '입력 내용 또는 위치 확인 시간이 유효한지 확인해 주세요.'
            : caught instanceof MusicApiError && caught.status === 500
              ? '서버에서 기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'
          : caught instanceof Error ? caught.message : '기록을 저장하지 못했습니다.');
    } finally { setIsSaving(false); }
  };

  const sentinelIndex = items.length - lastPageSize + Math.min(10, lastPageSize) - 1;
  return <main className={`music-page ${step === 'search' ? 'music-search-page' : ''}`}>
    <header className="music-page-header">
      <button type="button" className="music-back" aria-label="뒤로가기" onClick={() => {
        if (step === 'form') setStep('search'); else navigate('/music-records');
      }}>‹</button>
      <h1 className="text-title2-bold">{step === 'search' ? '음악 검색' : '음악 기록'}</h1>
      <span aria-hidden="true" />
    </header>
    {step === 'search' ? <>
      <form className="music-search" onSubmit={(event) => event.preventDefault()}>
        <label className="sr-only" htmlFor="music-query">음악 검색</label>
        <input ref={queryInput} id="music-query" value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="곡 제목, 아티스트 검색" />
      </form>
      {query.trim().length === 1 && <p className="music-search-count">두 글자 이상 입력해 주세요.</p>}
      {hasSearched && <p className="music-search-count">검색 결과 {items.length}곡</p>}
      {error && <p role="alert" className="music-error">{error}</p>}
      <section className="search-results" aria-label="음악 검색 결과">
        {items.map((music, index) => <div key={`${music.provider}-${music.external_music_id}`}>
          <button type="button" aria-pressed={selected?.external_music_id === music.external_music_id}
            className={selected?.external_music_id === music.external_music_id ? 'music-result selected' : 'music-result'}
            onClick={() => { setSelected(music); setError(''); }}>
            {music.album_cover_url ? <img src={music.album_cover_url} alt="" />
              : <span className="music-cover-placeholder" aria-hidden="true" />}
            <span><strong>{music.title}</strong><small>{music.artist_name}</small></span>
          </button>
          {hasNext && index === sentinelIndex && <div ref={sentinel} data-testid="music-page-sentinel" />}
        </div>)}
      </section>
      {isSearching && <p role="status" className="music-search-count">검색 중…</p>}
      <div className="music-search-footer"><button type="button" className="music-primary-button"
        disabled={!selected} onClick={() => setStep('form')}>다음</button></div>
    </> : <section className="music-form" aria-label="음악 기록 입력">
      <article className="music-selected-content">
        {selected?.album_cover_url ? <img src={selected.album_cover_url} alt="" />
          : <span className="music-cover-placeholder" aria-hidden="true" />}
        <div><p>선택한 음악</p><strong>{selected?.title}</strong><span>{selected?.artist_name}</span></div>
      </article>
      <label>저장 장소<input readOnly aria-readonly="true"
        value={location.location ? `${location.location.region.sido.name} ${location.location.region.sigungu.name}` : ''}
        placeholder="현재 위치를 확인해 주세요" /></label>
      <label>장소 이름<input ref={placeInput} value={place} maxLength={100}
        onChange={(event) => setPlace(event.target.value)} placeholder="장소 이름 (선택)" /></label>
      <label>지금 느끼는 것 기록<textarea value={memo} maxLength={500}
        onChange={(event) => setMemo(event.target.value)} /></label>
      <button type="button" className="music-secondary-button" disabled={location.isLocating}
        onClick={() => void location.acquire().catch(() => undefined)}>
        {location.isLocating ? '현재 위치 확인 중…' : '현재 위치 확인'}
      </button>
      {(location.error || error) && <p role="alert" className="music-error">{location.error || error}</p>}
      <button type="button" className="music-primary-button" disabled={isSaving}
        onClick={() => void save()}>{isSaving ? '저장 중…' : '음악 기록 저장'}</button>
    </section>}
  </main>;
}
