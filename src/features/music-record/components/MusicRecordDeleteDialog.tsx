import { useEffect, useRef } from 'react';

type MusicRecordDeleteDialogProps = {
  title?: string;
  count?: number;
  isDeleting: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function MusicRecordDeleteDialog({
  title,
  count,
  isDeleting,
  error,
  onCancel,
  onConfirm,
}: MusicRecordDeleteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="music-delete-dialog"
      aria-labelledby="music-delete-title"
      aria-describedby="music-delete-description"
      aria-busy={isDeleting}
      onCancel={(event) => {
        event.preventDefault();
        if (!isDeleting) onCancel();
      }}
    >
      <div className="music-delete-icon" aria-hidden="true">
        <svg viewBox="0 0 100 100" fill="none">
          <path
            d="M10 25h80M35 25V11h30v14m-44 0 5 67h48l5-67M39 42v34m22-34v34"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 id="music-delete-title">
        {count === undefined ? '음악 기록을 삭제할까요?' : `선택한 ${count}개의 기록을 삭제할까요?`}
      </h2>
      <p id="music-delete-description">
        {title
          ? `${title} 기록이 삭제되며 복구할 수 없어요.`
          : '삭제하면 지도에서 사라지고 되돌릴 수 없습니다.'}
      </p>
      {error && (
        <p role="alert" className="music-delete-error">
          {error}
        </p>
      )}
      {isDeleting && <p role="status">기록을 삭제하는 중…</p>}
      <div className="music-delete-actions">
        <button ref={cancelRef} type="button" disabled={isDeleting} onClick={onCancel}>
          취소
        </button>
        <button type="button" disabled={isDeleting} onClick={onConfirm}>
          {isDeleting ? '삭제 중…' : count === undefined ? '삭제 확인' : '확인'}
        </button>
      </div>
    </dialog>
  );
}
