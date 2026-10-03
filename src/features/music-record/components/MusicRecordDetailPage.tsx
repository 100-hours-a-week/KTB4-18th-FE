import { useEffect, useRef, useState } from 'react';

import { navigate } from '../../../shared/navigation';
import {
  deleteMusicRecord,
  getMusicRecord,
  MusicApiError,
  updateMusicRecord,
  type Music,
  type MusicRecordChanges,
  type MusicRecordDetail,
} from '../api/musicRecordsApi';
import { formatMusicRecordDate } from '../model/formatMusicRecordDate';
import { invalidateMapDotsCache } from '../../mainMap/mapApi';
import { MusicRecordDeleteDialog } from './MusicRecordDeleteDialog';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';

type MusicRecordDetailPageProps = { recordId: number };
const replacementDraftKey = (recordId: number) => `music-record-replacement-draft:${recordId}`;

type MusicReplacementDraft = {
  recordId: number;
  baselineUpdatedAt: string | null;
  baselineMusicId: number | null;
  place: string;
  memo: string;
  music: Music | null;
  status: 'pending' | 'consumed';
};

function parseReplacementDraft(value: unknown): MusicReplacementDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as Partial<MusicReplacementDraft>;
  const music = draft.music;
  const validMusic =
    music === null ||
    (!!music &&
      typeof music === 'object' &&
      music.provider === 'ITUNES' &&
      typeof music.external_music_id === 'string' &&
      (typeof music.music_id === 'number' || music.music_id === null) &&
      typeof music.title === 'string' &&
      typeof music.artist_name === 'string' &&
      (typeof music.album_cover_url === 'string' || music.album_cover_url === null) &&
      (typeof music.preview_url === 'string' || music.preview_url === null) &&
      (typeof music.youtube_video_id === 'string' || music.youtube_video_id === null) &&
      typeof music.is_queueable === 'boolean');
  if (
    !Number.isSafeInteger(draft.recordId) ||
    (typeof draft.baselineUpdatedAt !== 'string' && draft.baselineUpdatedAt !== null) ||
    (typeof draft.baselineMusicId !== 'number' && draft.baselineMusicId !== null) ||
    typeof draft.place !== 'string' ||
    typeof draft.memo !== 'string' ||
    !validMusic ||
    (draft.status !== 'pending' && draft.status !== 'consumed')
  )
    return null;
  return draft as MusicReplacementDraft;
}

export function MusicRecordDetailPage({ recordId }: MusicRecordDetailPageProps) {
  const [record, setRecord] = useState<MusicRecordDetail | null>(null);
  const [selectedMusic, setSelectedMusic] = useState<Music | null>(null);
  const [place, setPlace] = useState('');
  const [memo, setMemo] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [showExitWarning, setShowExitWarning] = useState(false);
  const backButton = useRef<HTMLButtonElement>(null);
  const exitIntent = useRef<{ destination: string; trigger: HTMLButtonElement | null }>({
    destination: '/music-records',
    trigger: null,
  });
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
        setSelectedMusic(null);
        setError('');
        if (detail.record_id !== recordId) return;
        try {
          const serializedDraft = window.sessionStorage.getItem(replacementDraftKey(recordId));
          if (serializedDraft === null) return;
          const draft = parseReplacementDraft(JSON.parse(serializedDraft));
          if (!draft || draft.recordId !== recordId) {
            setError('임시 입력 내용을 읽지 못했습니다. 저장된 내용을 확인해 주세요.');
            return;
          }
          if (
            draft.status === 'consumed' ||
            draft.baselineUpdatedAt !== detail.updated_at ||
            draft.baselineMusicId !== detail.music.music_id
          ) {
            try {
              window.sessionStorage.removeItem(replacementDraftKey(recordId));
            } catch {
              setError('오래된 임시 입력 내용을 정리하지 못했습니다. 저장된 내용은 유지됩니다.');
            }
            return;
          }
          window.sessionStorage.setItem(
            replacementDraftKey(recordId),
            JSON.stringify({ ...draft, status: 'consumed' }),
          );
          setPlace(draft.place);
          setMemo(draft.memo);
          setSelectedMusic(draft.music);
          try {
            window.sessionStorage.removeItem(replacementDraftKey(recordId));
          } catch {
            setError(
              '입력 내용은 복원했지만 임시 저장을 정리하지 못했습니다. 다시 불러오면 정리됩니다.',
            );
          }
        } catch {
          setError('임시 입력 내용을 복원하지 못했습니다. 현재 저장된 내용은 유지됩니다.');
        }
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

  const hasMusicChanges =
    !!record &&
    !!selectedMusic &&
    (selectedMusic.music_id === null ||
      record.music.music_id === null ||
      selectedMusic.music_id !== record.music.music_id);
  const hasChanges =
    !!record &&
    (hasMusicChanges ||
      place !== (record.custom_place_name ?? '') ||
      memo !== (record.emotion_memo ?? ''));

  const requestExit = (destination: string, trigger: HTMLButtonElement | null) => {
    if (isSaving || isDeleting || isDeleteOpen) return;
    if (!hasChanges) {
      navigate(destination);
      return;
    }
    exitIntent.current = { destination, trigger };
    setShowExitWarning(true);
  };

  const openMusicSearch = () => {
    if (!record || record.record_id !== recordId || isSaving || isDeleting || isDeleteOpen) return;
    try {
      const draft: MusicReplacementDraft = {
        recordId,
        baselineUpdatedAt: record.updated_at,
        baselineMusicId: record.music.music_id,
        place,
        memo,
        music: selectedMusic,
        status: 'pending',
      };
      const serializedDraft = JSON.stringify(draft);
      window.sessionStorage.setItem(replacementDraftKey(recordId), serializedDraft);
    } catch {
      setError('작성 중인 내용을 임시 저장하지 못했습니다. 현재 화면에서 다시 시도해 주세요.');
      return;
    }
    navigate(`/music-records/new?replaceRecordId=${recordId}`);
  };

  const changes: MusicRecordChanges = {};
  if (record && place !== (record.custom_place_name ?? ''))
    changes.custom_place_name = place.trim() || null;
  if (record && memo !== (record.emotion_memo ?? '')) changes.emotion_memo = memo.trim() || null;
  if (record && hasMusicChanges && selectedMusic)
    changes.music = {
      provider: selectedMusic.provider,
      external_music_id: selectedMusic.external_music_id,
    };

  useEffect(() => {
    if (!hasChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasChanges]);

  const clearDraftBeforeExit = () => {
    try {
      const key = replacementDraftKey(recordId);
      const serializedDraft = window.sessionStorage.getItem(key);
      if (serializedDraft !== null) {
        let draft: MusicReplacementDraft | null = null;
        try {
          draft = parseReplacementDraft(JSON.parse(serializedDraft));
        } catch {
          draft = null;
        }
        if (draft) {
          try {
            window.sessionStorage.setItem(key, JSON.stringify({ ...draft, status: 'consumed' }));
          } catch {
            try {
              window.sessionStorage.removeItem(key);
            } catch {
              return false;
            }
          }
          try {
            window.sessionStorage.removeItem(key);
          } catch {
            // The consumed marker prevents a stale draft from being restored.
          }
        } else {
          window.sessionStorage.removeItem(key);
        }
      }
      return true;
    } catch {
      return false;
    }
  };

  const confirmExit = () => {
    if (!clearDraftBeforeExit()) {
      setShowExitWarning(false);
      setError('임시 입력 내용을 안전하게 정리하지 못했습니다. 현재 화면에서 다시 시도해 주세요.');
      return;
    }
    navigate(exitIntent.current.destination);
  };

  const save = async () => {
    if (!record || !hasChanges || isMutationPending.current || isDeleteOpen) return;
    isMutationPending.current = true;
    setIsSaving(true);
    setError('');
    try {
      await updateMusicRecord(recordId, changes, AbortSignal.timeout(10_000));
      try {
        const key = replacementDraftKey(recordId);
        const serializedDraft = window.sessionStorage.getItem(key);
        if (serializedDraft !== null) {
          const draft = parseReplacementDraft(JSON.parse(serializedDraft));
          if (draft?.status === 'pending') {
            try {
              window.sessionStorage.setItem(key, JSON.stringify({ ...draft, status: 'consumed' }));
            } catch {
              try {
                window.sessionStorage.removeItem(key);
              } catch {
                // The saved server baseline still rejects a stale pending draft.
              }
            }
          }
          window.sessionStorage.removeItem(key);
        }
      } catch {
        // A consumed draft or its server-version baseline prevents stale restoration.
      }
      try {
        sessionStorage.setItem('music_record_updated', '1');
      } catch {
        // The saved record is still available from the list even without the notice flag.
      }
      navigate('/music-records');
    } catch (caught) {
      setError(
        caught instanceof MusicApiError && caught.status === 401
          ? '로그인이 만료되었어요. 다시 로그인해 주세요.'
          : caught instanceof MusicApiError && caught.status === 403
            ? '본인이 작성한 기록만 수정할 수 있어요.'
            : caught instanceof MusicApiError && caught.status === 404
              ? '기록을 찾지 못했습니다. 목록을 새로고침해 주세요.'
              : caught instanceof Error && caught.name === 'TimeoutError'
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
        <button
          ref={backButton}
          type="button"
          className="music-back"
          aria-label="음악 기록 목록으로 돌아가기"
          onClick={() => {
            requestExit('/music-records', backButton.current);
          }}
          aria-disabled={isDeleting}
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
            {(selectedMusic?.album_cover_url ?? record.music.album_cover_url) ? (
              <img
                src={selectedMusic?.album_cover_url ?? record.music.album_cover_url ?? ''}
                alt=""
              />
            ) : (
              <span className="music-cover-placeholder" aria-hidden="true" />
            )}
            <div>
              <strong>{selectedMusic?.title ?? record.music.title}</strong>
              <span>{selectedMusic?.artist_name ?? record.music.artist_name}</span>
            </div>
            <button
              type="button"
              className="music-change-button"
              disabled={isSaving || isDeleting || isDeleteOpen}
              onClick={openMusicSearch}
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
              disabled={isSaving || isDeleting}
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
              disabled={isSaving || isDeleting}
              maxLength={500}
              onChange={(event) => setMemo(event.target.value.slice(0, 500))}
              placeholder="지금의 감정을 기록해 주세요"
            />
            <span id="detail-memo-count" className="music-memo-count" aria-live="polite">
              {memo.length}/500
            </span>
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
      <UnsavedChangesDialog
        open={showExitWarning}
        onCancel={() => {
          setShowExitWarning(false);
          requestAnimationFrame(() => exitIntent.current.trigger?.focus());
        }}
        onConfirm={confirmExit}
      />
    </main>
  );
}
