import type { KeyboardEvent, RefObject } from 'react';

import type { LoginQueueTicket } from '../api/loginQueueApi';

type LoginQueueDialogProps = {
  ticket: LoginQueueTicket;
  message: string;
  isCanceling: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onCancel: () => void;
};

function getAheadLabel(usersAhead: number | null): string {
  return typeof usersAhead === 'number' ? `약 ${Math.max(0, usersAhead)}명` : '확인 중';
}

export function LoginQueueDialog({
  ticket,
  message,
  isCanceling,
  dialogRef,
  onCancel,
}: LoginQueueDialogProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (ticket.status !== 'VERIFYING' && !isCanceling) onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getAttribute('aria-hidden') !== 'true');
    if (focusable.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="login-queue-backdrop">
      <section
        className="login-queue-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="login-queue-title"
        aria-describedby="login-queue-description"
        onKeyDown={handleKeyDown}
      >
        <span className="login-queue-icon" aria-hidden="true">
          <img className="login-queue-ring" src="/icons/auth/login-queue-notice.svg" alt="" />
          <img className="login-queue-stem" src="/icons/auth/login-queue-notice-stem.svg" alt="" />
          <img className="login-queue-dot" src="/icons/auth/login-queue-notice-dot.svg" alt="" />
        </span>
        <h2 id="login-queue-title">접속 대기 중이에요</h2>
        <p id="login-queue-description">
          현재 이용자가 많아 순서대로 안내하고 있어요. 차례가 되면 자동으로 연결되니, 이 화면을
          유지해 주세요.
        </p>
        <div className="login-queue-count">
          <span>내 앞 대기 인원</span>
          <strong>{getAheadLabel(ticket.usersAhead)}</strong>
        </div>
        <p className="login-queue-live" role="status" aria-live="polite" aria-atomic="true">
          {ticket.status === 'READY'
            ? '차례가 되었어요. 로그인을 진행할게요.'
            : ticket.status === 'VERIFYING'
              ? '로그인을 확인하고 있어요.'
              : ticket.usersAhead === null
                ? '대기 순서를 확인하고 있어요.'
                : `내 앞에 ${getAheadLabel(ticket.usersAhead)} 대기 중`}
          {message && <span className="login-queue-message"> {message}</span>}
        </p>
        <div className="login-queue-footer">
          <button
            className="login-queue-cancel"
            type="button"
            onClick={onCancel}
            disabled={isCanceling || ticket.status === 'VERIFYING'}
          >
            {isCanceling ? '취소 중…' : '대기 취소'}
          </button>
        </div>
      </section>
    </div>
  );
}
