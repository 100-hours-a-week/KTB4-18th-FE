import type { LoginPageProps } from '../LoginPage';

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

type LoginPageNoticesProps = Pick<
  LoginPageProps,
  | 'authCapabilityMessage'
  | 'authRestoreError'
  | 'onRetryAuthRestore'
  | 'logoutCleanupPending'
  | 'logoutCleanupError'
  | 'logoutCleanupRetrying'
  | 'onRetryLogoutCleanup'
  | 'passwordChangedNotice'
  | 'onPasswordChangedNoticeDismiss'
>;

export function LoginPageNotices({
  authCapabilityMessage,
  authRestoreError,
  onRetryAuthRestore,
  logoutCleanupPending,
  logoutCleanupError,
  logoutCleanupRetrying,
  onRetryLogoutCleanup,
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
      {logoutCleanupPending && (
        <section className="login-notice" aria-label="로그아웃 정리 대기" role="alert">
          <p>로그인 준비를 마무리하고 있어요. 완료될 때까지 다시 로그인할 수 없어요.</p>
          {logoutCleanupError && <p>{logoutCleanupError}</p>}
          <button type="button" onClick={onRetryLogoutCleanup} disabled={logoutCleanupRetrying}>
            {logoutCleanupRetrying ? '로그인 준비 중…' : '로그인 준비 다시 시도'}
          </button>
        </section>
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
