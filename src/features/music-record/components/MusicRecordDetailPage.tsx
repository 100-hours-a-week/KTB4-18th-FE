import { useEffect, useState } from 'react';

import { navigate } from '../../../shared/navigation';
import {
  getMusicRecord,
  updateMusicRecord,
  type MusicRecordChanges,
  type MusicRecordDetail,
} from '../api/musicRecordsApi';
import { formatMusicRecordTime } from '../model/formatMusicRecordTime';

type MusicRecordDetailPageProps = { recordId: number };

export function MusicRecordDetailPage({ recordId }: MusicRecordDetailPageProps) {
  const [record, setRecord] = useState<MusicRecordDetail | null>(null);
  const [place, setPlace] = useState('');
  const [memo, setMemo] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

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
        <a
          href="/music-records"
          aria-label="음악 기록 목록으로 돌아가기"
          onClick={(event) => {
            event.preventDefault();
            navigate('/music-records');
          }}
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
              maxLength={500}
              onChange={(event) => setMemo(event.target.value)}
              placeholder="지금의 감정을 기록해 주세요"
            />
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
    </main>
  );
}
