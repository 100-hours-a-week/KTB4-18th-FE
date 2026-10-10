import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ROUTE_CHANGE_EVENT } from '../../../shared/navigation';
import { getAllMusicRecords, MusicApiError, type MusicRecord } from '../api/musicRecordsApi';

import { musicRecordFilterPath, readMusicRecordSidoCode } from '../model/musicRecordFilterPath';

const REGION_LABELS: Record<string, string> = {
  서울특별시: '서울',
  부산광역시: '부산',
  대구광역시: '대구',
  인천광역시: '인천',
  광주광역시: '광주',
  대전광역시: '대전',
  울산광역시: '울산',
  세종특별자치시: '세종',
  경기도: '경기',
  강원도: '강원',
  강원특별자치도: '강원',
  충청북도: '충북',
  충청남도: '충남',
  전라북도: '전북',
  전북특별자치도: '전북',
  전라남도: '전남',
  경상북도: '경북',
  경상남도: '경남',
  제주도: '제주',
  제주특별자치도: '제주',
};

export function useMusicRecordRegionFilter() {
  const [snapshot, setSnapshot] = useState<MusicRecord[]>([]);
  const [isSnapshotLoading, setIsSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState('');
  const [selectedSidoCode, setSelectedSidoCode] = useState<string | null>(readMusicRecordSidoCode);
  const snapshotRef = useRef<MusicRecord[]>([]);
  const generation = useRef(0);
  const active = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const next = musicRecordFilterPath(current, selectedSidoCode);
    if (current !== next) {
      window.history.replaceState(window.history.state, '', next);
      window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
    }
  }, [selectedSidoCode]);

  const invalidate = useCallback(() => {
    generation.current += 1;
    if (retryTimer.current !== null) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    return generation.current;
  }, []);

  const refreshSnapshot = useCallback(() => {
    const requestGeneration = invalidate();
    const isCurrent = () => active.current && generation.current === requestGeneration;
    if (!isCurrent()) return;
    setIsSnapshotLoading(true);
    setSnapshotError('');
    const attempt = async (retryCount: number) => {
      if (!isCurrent()) return;
      try {
        const records = await getAllMusicRecords();
        if (!isCurrent()) return;
        snapshotRef.current = records;
        setSnapshot(records);
        setSelectedSidoCode((code) =>
          records.some((record) => record.region.sido.code === code) ? code : null,
        );
        setIsSnapshotLoading(false);
      } catch (caught) {
        if (!isCurrent()) return;
        const isAuthorizationError =
          caught instanceof MusicApiError && (caught.status === 401 || caught.status === 403);
        if (!isAuthorizationError && retryCount < 3) {
          retryTimer.current = setTimeout(
            () => {
              retryTimer.current = null;
              if (isCurrent()) void attempt(retryCount + 1);
            },
            (retryCount + 1) * 1_000,
          );
          return;
        }
        setSnapshotError('지역 필터를 불러오지 못했어요.');
        setIsSnapshotLoading(false);
      }
    };
    void attempt(0);
  }, [invalidate]);

  useEffect(() => {
    active.current = true;
    let isActive = true;
    queueMicrotask(() => {
      if (isActive) refreshSnapshot();
    });
    return () => {
      isActive = false;
      active.current = false;
      invalidate();
    };
  }, [invalidate, refreshSnapshot]);

  const removeFromSnapshot = useCallback(
    (ids: number[]) => {
      const records = snapshotRef.current.filter((record) => !ids.includes(record.record_id));
      snapshotRef.current = records;
      setSnapshot(records);
      setSelectedSidoCode((code) =>
        records.some((record) => record.region.sido.code === code) ? code : null,
      );
      refreshSnapshot();
    },
    [refreshSnapshot],
  );

  const regions = useMemo(() => {
    const names = new Map<string, string>();
    for (const record of snapshot) {
      const { code, name } = record.region.sido;
      if (!names.has(code)) names.set(code, REGION_LABELS[name] ?? name);
    }
    return [...names]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, name]) => ({ code, name }));
  }, [snapshot]);

  return {
    regions,
    selectedSidoCode,
    setSelectedSidoCode,
    isSnapshotLoading,
    snapshotError,
    filteredSnapshot: snapshot.filter((record) => record.region.sido.code === selectedSidoCode),
    refreshSnapshot,
    removeFromSnapshot,
  };
}
