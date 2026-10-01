import { useEffect, useRef } from 'react';

type MusicRecordDeleteDialogProps = {
  title: string;
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

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
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
      <h2 id="music-delete-title">음악 기록을 삭제할까요?</h2>
      <p id="music-delete-description">
        {count === undefined ? `${title} 기록` : `선택한 ${count}개의 기록`}이 삭제되며 복구할 수
        없어요.
      </p>
      {error && (
        <p role="alert" className="music-error">
          {error}
        </p>
      )}
      {isDeleting && <p role="status">기록을 삭제하는 중…</p>}
      <div className="music-delete-actions">
        <button
          type="button"
          className="music-secondary-button"
          disabled={isDeleting}
          onClick={onCancel}
        >
          취소
        </button>
        <button
          type="button"
          className="music-delete-button"
          disabled={isDeleting}
          onClick={onConfirm}
        >
          {isDeleting ? '삭제 중…' : '삭제 확인'}
        </button>
      </div>
    </dialog>
  );
}
