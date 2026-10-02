import { useEffect, useRef } from 'react';

type UnsavedChangesDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function UnsavedChangesDialog({ open, onCancel, onConfirm }: UnsavedChangesDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      cancelButton.current?.focus();
    } else if (!open && element.open) element.close();
  }, [open]);

  const cancel = () => {
    if (dialog.current?.open) dialog.current.close();
    onCancel();
  };

  const confirm = () => {
    if (dialog.current?.open) dialog.current.close();
    onConfirm();
  };

  return (
    <dialog
      ref={dialog}
      className="music-exit-dialog"
      aria-labelledby="music-exit-title"
      aria-describedby="music-exit-description"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <div className="music-exit-content">
        <span className="music-exit-icon" aria-hidden="true">
          <svg viewBox="0 0 100 100" fill="none" focusable="false">
            <path
              d="M50 8.5 91.5 50 50 91.5 8.5 50 50 8.5Z"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path d="M50 30v25" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <circle cx="50" cy="68" r="1.8" fill="currentColor" />
          </svg>
        </span>
        <h2 id="music-exit-title">작성 중인 기록이 사라집니다. 돌아가시겠어요?</h2>
        <p id="music-exit-description">현재 페이지에서 나가면 작성 중인 기록이 사라집니다</p>
        <div className="music-exit-actions">
          <button ref={cancelButton} type="button" className="music-exit-cancel" onClick={cancel}>
            취소
          </button>
          <button type="button" className="music-exit-confirm" onClick={confirm}>
            확인
          </button>
        </div>
      </div>
    </dialog>
  );
}
