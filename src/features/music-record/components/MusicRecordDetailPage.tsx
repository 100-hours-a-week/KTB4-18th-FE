import { useEffect, useRef, useState } from 'react';

import { navigate } from '../../../shared/navigation';
import {
  getMusicRecord,
  updateMusicRecord,
  type MusicRecordChanges,
  type MusicRecordDetail,
} from '../api/musicRecordsApi';
import { formatMusicRecordDate } from '../model/formatMusicRecordDate';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';

type MusicRecordDetailPageProps = { recordId: number };

export function MusicRecordDetailPage({ recordId }: MusicRecordDetailPageProps) {
  const [record, setRecord] = useState<MusicRecordDetail | null>(null);
  const [place, setPlace] = useState('');
  const [memo, setMemo] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [showExitWarning, setShowExitWarning] = useState(false);
  const backButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
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
    };
  }, [recordId]);

  const hasChanges =
    !!record &&
    (place !== (record.custom_place_name ?? '') || memo !== (record.emotion_memo ?? ''));

  const changes: MusicRecordChanges = {};
  if (record && place !== (record.custom_place_name ?? ''))
    changes.custom_place_name = place.trim() || null;
  if (record && memo !== (record.emotion_memo ?? '')) changes.emotion_memo = memo.trim() || null;

  const save = async () => {
    if (!record || !hasChanges || isSaving) return;
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
      setIsSaving(false);
    }
  };

  return (
    <main className="music-page music-detail-page">
      <header className="music-page-header">
        <button
          ref={backButton}
          type="button"
          className="music-back"
          aria-label="음악 기록 목록으로 돌아가기"
          onClick={() => {
            if (hasChanges) setShowExitWarning(true);
            else navigate('/music-records');
          }}
        >
          <img src="/icons/chatbot/Arrow-reft.svg" alt="" aria-hidden="true" />
        </button>
        <h1 className="text-title2-bold">음악 기록</h1>
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
            <button
              type="button"
              className="music-change-button"
              disabled
              title="현재 음악 변경은 지원하지 않습니다"
            >
              음악 변경
            </button>
          </article>
          <label>
            저장 날짜
            <input value={formatMusicRecordDate(record.created_at)} readOnly aria-readonly="true" />
          </label>
          <label>
            저장 장소
            <input
              value={
                record.region?.sido?.name && record.region?.sigungu?.name
                  ? `${record.region.sido.name} ${record.region.sigungu.name}`
                  : '—'
              }
              readOnly
              aria-readonly="true"
            />
          </label>
          <label>
            장소 이름
            <input
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
              aria-describedby="detail-memo-count"
              value={memo}
              maxLength={200}
              onChange={(event) => setMemo(event.target.value.slice(0, 200))}
              placeholder="지금의 감정을 기록해 주세요"
            />
            <span id="detail-memo-count" className="music-memo-count" aria-live="polite">
              {memo.length}/200
            </span>
          </label>
          <button
            type="button"
            className="music-primary-button"
            disabled={!hasChanges || isSaving}
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
        onConfirm={() => navigate('/music-records')}
      />
    </main>
  );
}
