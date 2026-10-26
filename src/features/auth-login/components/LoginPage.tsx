import { ActionButton } from '@seed-design/react';
import { useCallback, useRef, useState } from 'react';

import type { LoginSuccessResponse } from '../api/loginTypes';
import { LoginQueueDialog } from './LoginQueueDialog';
import { useLoginQueueFlow } from '../hooks/useLoginQueueFlow';
import { validate } from '../hooks/loginQueueFlowUtils';
import { EMAIL_NOT_REGISTERED_ERROR } from '../hooks/loginQueueFlowUtils';
import type { FieldErrors } from '../hooks/loginQueueFlowUtils';
import './LoginPage.css';

type RequestToast = { message: string; sequence: number };

type LoginPageProps = {
  authCapabilityMessage?: string;
  authRestoreError?: string;
  onRetryAuthRestore?: () => void;
  logoutCleanupPending?: boolean;
  logoutCleanupError?: string;
  logoutCleanupRetrying?: boolean;
  onRetryLogoutCleanup?: () => void;
  skipInitialQueueRestore?: boolean;
  onLoginSuccess?: (response: LoginSuccessResponse) => void;
  onLoginStart?: () => void;
  onLoginFailure?: () => void;
  passwordChangedNotice?: boolean;
  onPasswordChangedNoticeDismiss?: () => void;
};

export function LoginPage({
  authCapabilityMessage,
  authRestoreError,
  onRetryAuthRestore,
  logoutCleanupPending = false,
  logoutCleanupError,
  logoutCleanupRetrying = false,
  onRetryLogoutCleanup,
  skipInitialQueueRestore,
  onLoginSuccess,
  onLoginStart,
  onLoginFailure,
  passwordChangedNotice,
  onPasswordChangedNoticeDismiss,
}: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [requestError, setRequestError] = useState('');
  const [requestToast, setRequestToast] = useState<RequestToast | null>(null);
  const requestToastSequence = useRef(0);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [isLoginSuccessful, setIsLoginSuccessful] = useState(false);
  const isFormValid = Object.keys(validate(email, password)).length === 0;
  const showRequestToast = useCallback((message: string) => {
    setRequestToast({ message, sequence: ++requestToastSequence.current });
  }, []);
  const clearRequestToast = useCallback(() => setRequestToast(null), []);

  const flow = useLoginQueueFlow({
    email,
    password,
    setEmail,
    setPassword,
    setFieldErrors,
    setRequestError,
    showRequestToast,
    clearRequestToast,
    setIsSubmitting,
    isSubmitting,
    isSubmittingRef,
    setIsLoginSuccessful,
    authCapabilityMessage: authRestoreError ?? authCapabilityMessage,
    skipInitialQueueRestore: skipInitialQueueRestore || logoutCleanupPending,
    onLoginSuccess,
    onLoginStart,
    onLoginFailure,
  });
  const {
    queueTicket,
    isQueueOpen,
    capacityWait,
    queueMessage,
    ambiguousLogin,
    isCanceling,
    queueDialogRef,
    emailInputRef,
    isAuthSupported,
    updateEmail,
    updatePassword,
    handleSubmit,
    retryCapacityWait,
    reconcileExhaustedQueue,
    handleCancelQueue,
  } = flow;

  return (
    <main className="login-screen">
      <section className="login-content" aria-labelledby="login-title">
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
        <div className="login-layout" inert={isQueueOpen}>
          <header className="login-brand">
            <span className="login-symbol-grid" aria-hidden="true">
              <span className="login-symbol-frame">
                <img className="login-symbol" src="/icons/auth/Logo.svg" alt="" />
              </span>
            </span>
            <div className="login-brand-copy">
              <h1 id="login-title" className="login-wordmark">
                머문음
              </h1>
              <p className="brand-tagline">머문 자리에, 음악이 남는다.</p>
            </div>
          </header>

          <div className="login-body">
            <div className="diary-login-intro">
              <h2>오늘도, 한 곡 남겨볼까요?</h2>
            </div>
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
                <button
                  type="button"
                  onClick={onRetryLogoutCleanup}
                  disabled={logoutCleanupRetrying}
                >
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
            <div className="login-divider" aria-hidden="true">
              <span>로그인/회원가입</span>
            </div>

            <form className="login-form" onSubmit={handleSubmit} noValidate>
              <div className="login-field">
                <label className="login-label" htmlFor="email">
                  이메일
                </label>
                <div className={'login-input-wrap' + (fieldErrors.email ? ' has-error' : '')}>
                  <input
                    id="email"
                    ref={emailInputRef}
                    className="login-input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="이메일을 입력해주세요"
                    value={email}
                    onInput={(event) => updateEmail(event.currentTarget.value)}
                    onChange={(event) => updateEmail(event.currentTarget.value)}
                    onCompositionUpdate={(event) => updateEmail(event.currentTarget.value)}
                    onCompositionEnd={(event) => updateEmail(event.currentTarget.value)}
                    onBlur={(event) => updateEmail(event.currentTarget.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                    disabled={
                      isSubmitting ||
                      Boolean(capacityWait) ||
                      !isAuthSupported ||
                      logoutCleanupPending
                    }
                  />
                </div>
                {fieldErrors.email && (
                  <p id="email-error" className="login-error" role="alert">
                    {fieldErrors.emailNeedsSignup ? (
                      <>
                        {EMAIL_NOT_REGISTERED_ERROR}{' '}
                        <a className="login-inline-signup-link" href="/signup">
                          회원가입
                        </a>
                        을 진행해 주세요.
                      </>
                    ) : (
                      fieldErrors.email
                    )}
                  </p>
                )}
              </div>

              <div className="login-field">
                <label className="login-label" htmlFor="password">
                  비밀번호
                </label>
                <div className={'login-input-wrap' + (fieldErrors.password ? ' has-error' : '')}>
                  <input
                    id="password"
                    className="login-input"
                    type={isPasswordVisible ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="비밀번호를 입력해주세요"
                    value={password}
                    onChange={(event) => updatePassword(event.target.value)}
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                    disabled={
                      isSubmitting ||
                      Boolean(capacityWait) ||
                      !isAuthSupported ||
                      logoutCleanupPending
                    }
                  />
                  <button
                    className="password-toggle"
                    type="button"
                    onClick={() => setIsPasswordVisible((visible) => !visible)}
                    aria-label={isPasswordVisible ? '비밀번호 숨기기' : '비밀번호 표시'}
                    disabled={isSubmitting || !isAuthSupported || logoutCleanupPending}
                  >
                    <img
                      src={
                        isPasswordVisible ? '/icons/auth/View-on.svg' : '/icons/auth/View-off.svg'
                      }
                      alt=""
                    />
                  </button>
                </div>
                {fieldErrors.password && (
                  <p id="password-error" className="login-error" role="alert">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              {requestError && (
                <p className="login-notice" role="alert">
                  {requestError}
                </p>
              )}
              {capacityWait && (
                <section className="login-capacity-wait" aria-labelledby="login-capacity-title">
                  <h2 id="login-capacity-title">
                    {capacityWait.mode === 'paused'
                      ? '대기 요청을 확인해 주세요'
                      : '접속 대기 중이에요'}
                  </h2>
                  <p role="status" aria-live="polite" aria-atomic="true">
                    {capacityWait.message}
                    {capacityWait.mode === 'waiting' &&
                      ' 다음 시도 시간에 같은 요청으로 다시 확인할게요.'}
                  </p>
                  <div className="login-capacity-actions">
                    {capacityWait.mode === 'paused' && capacityWait.reason !== 'EXHAUSTED' && (
                      <button
                        type="button"
                        onClick={() =>
                          void (capacityWait.message.includes('취소 결과')
                            ? handleCancelQueue()
                            : retryCapacityWait())
                        }
                        disabled={isSubmitting}
                      >
                        {capacityWait.message.includes('취소 결과')
                          ? '취소 결과 다시 확인'
                          : '다시 확인'}
                      </button>
                    )}
                    {capacityWait.reason === 'EXHAUSTED' && (
                      <button
                        type="button"
                        onClick={() => void reconcileExhaustedQueue()}
                        disabled={isSubmitting}
                      >
                        상태 확인
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleCancelQueue()}
                      disabled={isCanceling}
                    >
                      {isCanceling ? '취소 중…' : '대기 취소'}
                    </button>
                  </div>
                </section>
              )}
              {isLoginSuccessful && (
                <p className="login-success" role="status">
                  로그인에 성공했어요.
                </p>
              )}
              {ambiguousLogin && (
                <div className="login-ambiguity" role="status" aria-live="polite">
                  로그인 결과를 확인하지 못했어요. 다시 로그인하려면 비밀번호를 입력하고 로그인
                  버튼을 눌러 주세요.
                </div>
              )}

              <ActionButton
                className="login-submit"
                type="submit"
                variant="brandSolid"
                size="large"
                disabled={
                  !isFormValid ||
                  isSubmitting ||
                  Boolean(capacityWait) ||
                  !isAuthSupported ||
                  logoutCleanupPending
                }
                loading={isSubmitting}
                aria-label="로그인"
              >
                로그인
              </ActionButton>
            </form>

            <a className="login-signup-link" href="/signup">
              회원가입 하기
            </a>
          </div>
        </div>
      </section>
      {isQueueOpen && queueTicket && !logoutCleanupPending && (
        <LoginQueueDialog
          ticket={queueTicket}
          message={queueMessage}
          isCanceling={isCanceling}
          dialogRef={queueDialogRef}
          onCancel={() => void handleCancelQueue()}
        />
      )}
    </main>
  );
}
