type LoginPageToastProps = {
  requestToast: { message: string; sequence: number } | null;
  clearRequestToast: () => void;
};

export function LoginPageToast({ requestToast, clearRequestToast }: LoginPageToastProps) {
  return (
    <>
      {requestToast && (
        <div
          key={requestToast.sequence}
          className="login-request-toast"
          role="alert"
          aria-atomic="true"
        >
          <span>{requestToast.message}</span>
          <button type="button" aria-label="알림 닫기" onClick={clearRequestToast}>
            닫기
          </button>
        </div>
      )}
    </>
  );
}

type LoginPageNoticesProps = {
  authCapabilityMessage?: string;
  authRestoreError?: string;
  onRetryAuthRestore?: () => void;
  passwordChangedNotice?: boolean;
  onPasswordChangedNoticeDismiss?: () => void;
};

export function LoginPageNotices({
  authCapabilityMessage,
  authRestoreError,
  onRetryAuthRestore,
  passwordChangedNotice,
  onPasswordChangedNoticeDismiss,
}: LoginPageNoticesProps) {
  return (
    <>
      {authCapabilityMessage && (
        <p className="login-notice" role="alert">
          {authCapabilityMessage}
        </p>
      )}
      {authRestoreError && (
        <p className="login-notice" role="alert">
          {authRestoreError}{' '}
          <button type="button" onClick={onRetryAuthRestore}>
            다시 시도
          </button>
        </p>
      )}
      {passwordChangedNotice && (
        <p role="status">
          비밀번호가 변경되었어요. 새 비밀번호로 다시 로그인해 주세요.{' '}
          <button type="button" onClick={onPasswordChangedNoticeDismiss}>
            확인
          </button>
        </p>
      )}
    </>
  );
}
