import { useEffect, useRef, useState } from 'react';

import { navigate } from '../../../shared/navigation';
import {
  deleteMusicRecord,
  getMusicRecord,
  MusicApiError,
  updateMusicRecord,
  type MusicRecordChanges,
  type MusicRecordDetail,
} from '../api/musicRecordsApi';
import { formatMusicRecordTime } from '../model/formatMusicRecordTime';
import { invalidateMapDotsCache } from '../../mainMap/mapApi';
import { MusicRecordDeleteDialog } from './MusicRecordDeleteDialog';

type MusicRecordDetailPageProps = { recordId: number };

export function MusicRecordDetailPage({ recordId }: MusicRecordDetailPageProps) {
  const [record, setRecord] = useState<MusicRecordDetail | null>(null);
  const [place, setPlace] = useState('');
  const [memo, setMemo] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const isMutationPending = useRef(false);
  const activeRecordId = useRef<number | null>(recordId);

  useEffect(() => {
    activeRecordId.current = recordId;
    let active = true;
    void getMusicRecord(recordId)
      .then((detail) => {
        if (!active) return;
        setRecord(detail);
        setPlace(detail.custom_place_name ?? '');
        setMemo(detail.emotion_memo ?? '');
      })
      .catch((caught: unknown) => {
        if (active)
          setError(caught instanceof Error ? caught.message : '기록을 불러오지 못했습니다.');
      });
    return () => {
      active = false;
      activeRecordId.current = null;
    };
  }, [recordId]);

  const changes: MusicRecordChanges = {};
  if (record) {
    if ((place.trim() || null) !== record.custom_place_name) {
      changes.custom_place_name = place.trim() || null;
    }
    if ((memo.trim() || null) !== record.emotion_memo) {
      changes.emotion_memo = memo.trim() || null;
    }
  }
  const hasChanges = Object.keys(changes).length > 0;

  const save = async () => {
    if (!record || !hasChanges || isMutationPending.current || isDeleteOpen) return;
    isMutationPending.current = true;
    setIsSaving(true);
    setError('');
    try {
      await updateMusicRecord(recordId, changes, AbortSignal.timeout(10_000));
      sessionStorage.setItem('music_record_updated', '1');
      navigate('/music-records');
    } catch (caught) {
      setError(
        caught instanceof Error && caught.name === 'TimeoutError'
          ? '저장 시간이 초과됐어요. 다시 시도해 주세요.'
          : '저장하지 못했어요. 다시 시도해 주세요.',
      );
    } finally {
      isMutationPending.current = false;
      setIsSaving(false);
    }
  };

  const remove = async () => {
    if (!record || record.record_id !== recordId || isMutationPending.current) return;
    isMutationPending.current = true;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await deleteMusicRecord(recordId, AbortSignal.timeout(10_000));
      if (activeRecordId.current !== recordId) return;
      sessionStorage.setItem('music_record_deleted', '1');
      setIsDeleteOpen(false);
      navigate('/music-records');
    } catch (caught) {
      if (activeRecordId.current !== recordId) return;
      if (caught instanceof MusicApiError && caught.status === 404) {
        invalidateMapDotsCache();
        sessionStorage.setItem('music_record_missing', '1');
        setIsDeleteOpen(false);
        navigate('/music-records');
        return;
      }
      setDeleteError(
        caught instanceof MusicApiError && caught.status === 401
          ? '로그인이 만료되었어요. 다시 로그인해 주세요.'
          : caught instanceof MusicApiError && caught.status === 403
            ? '본인이 작성한 기록만 삭제할 수 있어요.'
            : (caught instanceof Error || caught instanceof DOMException) &&
                caught.name === 'TimeoutError'
              ? '삭제 응답 시간이 초과됐어요. 다시 시도해 주세요.'
              : '기록을 삭제하지 못했어요. 다시 시도해 주세요.',
      );
    } finally {
      isMutationPending.current = false;
      if (activeRecordId.current === recordId) setIsDeleting(false);
    }
  };

  return (
    <main className="music-page music-detail-page">
      <header className="music-page-header">
        <a
          href="/music-records"
          aria-label="음악 기록 목록으로 돌아가기"
          onClick={(event) => {
            event.preventDefault();
            if (isDeleting) return;
            navigate('/music-records');
          }}
          aria-disabled={isDeleting}
        >
          ‹
        </a>
        <h1 className="text-title2-bold">기록 상세</h1>
        <span aria-hidden="true" />
      </header>
      {error && (
        <p role="alert" className="music-error">
          {error}
        </p>
      )}
      {!record ? (
        !error && (
          <p role="status" className="music-empty">
            기록을 불러오는 중…
          </p>
        )
      ) : (
        <section className="music-form" aria-label="음악 기록 상세 및 수정">
          <div className="music-detail-label-row">
            <span>곡</span>
          </div>
          <article className="music-selected-content">
            {record.music.album_cover_url ? (
              <img src={record.music.album_cover_url} alt="" />
            ) : (
              <span className="music-cover-placeholder" aria-hidden="true" />
            )}
            <div>
              <strong>{record.music.title}</strong>
              <span>{record.music.artist_name}</span>
            </div>
          </article>
          <label>
            저장 장소
            <input
              value={`${record.region.sido.name} ${record.region.sigungu.name}`}
              readOnly
              aria-readonly="true"
            />
          </label>
          <label>
            장소 이름
            <input
              value={place}
              disabled={isSaving || isDeleting}
              maxLength={100}
              onChange={(event) => setPlace(event.target.value)}
              placeholder="장소 이름 (선택)"
            />
          </label>
          <label>
            저장 날짜
            <input value={formatMusicRecordTime(record.created_at)} readOnly aria-readonly="true" />
          </label>
          <label>
            지금 느끼는 것 기록
            <textarea
              value={memo}
              disabled={isSaving || isDeleting}
              maxLength={500}
              onChange={(event) => setMemo(event.target.value)}
              placeholder="지금의 감정을 기록해 주세요"
            />
          </label>
          <button
            type="button"
            className="music-primary-button"
            disabled={!hasChanges || isSaving || isDeleteOpen || isDeleting}
            onClick={() => void save()}
          >
            {isSaving ? '저장 중…' : '저장'}
          </button>
          <button
            type="button"
            className="music-delete-button"
            disabled={isSaving || isDeleting || record.record_id !== recordId}
            onClick={() => {
              setDeleteError('');
              setIsDeleteOpen(true);
            }}
          >
            기록 삭제
          </button>
          {isDeleteOpen && (
            <MusicRecordDeleteDialog
              title={record.music.title}
              isDeleting={isDeleting}
              error={deleteError}
              onCancel={() => setIsDeleteOpen(false)}
              onConfirm={() => void remove()}
            />
          )}
        </section>
      )}
    </main>
  );
}
