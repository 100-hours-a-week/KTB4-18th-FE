import { ActionButton } from '@seed-design/react';
import { useCallback, useRef, useState } from 'react';

import type { LoginSuccessResponse } from '../api/loginTypes';
import { useLoginQueueFlow } from '../hooks/useLoginQueueFlow';
import { validate } from '../hooks/loginQueueFlowUtils';
import type { FieldErrors } from '../hooks/loginQueueFlowUtils';
import { LoginPageBrand } from './loginPage/LoginPageBrand';
import { LoginCredentialsForm } from './loginPage/LoginCredentialsForm';
import { LoginPageNotices, LoginPageToast } from './loginPage/LoginPageStatus';
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
    capacityWait,
    ambiguousLogin,
    isCanceling,
    emailInputRef,
    isAuthSupported,
    updateEmail,
    updatePassword,
    handleSubmit,
    retryCapacityWait,
    reconcileExhaustedQueue,
    handleCancelQueue,
  } = flow;
  const isQueuePending = queueTicket?.status === 'WAITING' || queueTicket?.status === 'VERIFYING';
  const isLoginPending =
    isSubmitting || capacityWait?.mode === 'waiting' || (!capacityWait && isQueuePending);
  const isLoginLocked = isSubmitting || Boolean(capacityWait) || isQueuePending;

  return (
    <main className="login-screen">
      <section className="login-content" aria-labelledby="login-title">
        <LoginPageToast requestToast={requestToast} clearRequestToast={clearRequestToast} />

        <div className="login-layout">
          <LoginPageBrand />

          <div className="login-body">
            <div className="diary-login-intro">
              <h2>오늘도, 한 곡 남겨볼까요?</h2>
            </div>
            <LoginPageNotices
              authCapabilityMessage={authCapabilityMessage}
              authRestoreError={authRestoreError}
              onRetryAuthRestore={onRetryAuthRestore}
              logoutCleanupPending={logoutCleanupPending}
              logoutCleanupError={logoutCleanupError}
              logoutCleanupRetrying={logoutCleanupRetrying}
              onRetryLogoutCleanup={onRetryLogoutCleanup}
              passwordChangedNotice={passwordChangedNotice}
              onPasswordChangedNoticeDismiss={onPasswordChangedNoticeDismiss}
            />
            <div className="login-divider" aria-hidden="true">
              <span>로그인/회원가입</span>
            </div>

            <form className="login-form" onSubmit={handleSubmit} noValidate>
              <LoginCredentialsForm
                email={email}
                password={password}
                fieldErrors={fieldErrors}
                emailInputRef={emailInputRef}
                updateEmail={updateEmail}
                updatePassword={updatePassword}
                isPasswordVisible={isPasswordVisible}
                setIsPasswordVisible={setIsPasswordVisible}
                isLoginLocked={isLoginLocked}
                isAuthSupported={isAuthSupported}
                logoutCleanupPending={logoutCleanupPending}
              />

              {requestError && (
                <p className="login-notice" role="alert">
                  {requestError}
                </p>
              )}
              {capacityWait?.mode === 'paused' && (
                <section className="login-capacity-wait" aria-labelledby="login-capacity-title">
                  <h2 id="login-capacity-title">로그인 요청을 확인해 주세요</h2>
                  <p role="status" aria-live="polite" aria-atomic="true">
                    {capacityWait.reason === 'EXHAUSTED'
                      ? '로그인 결과를 확인할 수 없어요. 상태를 다시 확인하거나 요청을 취소해 주세요.'
                      : capacityWait.reason === 'TRANSPORT'
                        ? '로그인 요청 결과를 확인하지 못했어요. 같은 요청 상태를 다시 확인해 주세요.'
                        : capacityWait.message}
                  </p>
                  <div className="login-capacity-actions">
                    {capacityWait.reason !== 'EXHAUSTED' && (
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
                      {isCanceling ? '취소 중…' : '로그인 취소'}
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
                className={isLoginPending ? 'login-submit is-pending' : 'login-submit'}
                type="submit"
                variant="brandSolid"
                size="large"
                disabled={!isFormValid || isLoginLocked || !isAuthSupported || logoutCleanupPending}
                loading={false}
                aria-label={isLoginPending ? '로그인 진행 중' : '로그인'}
                aria-busy={isLoginPending}
              >
                {isLoginPending ? (
                  <img
                    className="login-submit-spinner"
                    src="/icons/auth/login-loading.svg"
                    alt=""
                  />
                ) : (
                  '로그인'
                )}
              </ActionButton>
            </form>

            <a className="login-signup-link" href="/signup">
              회원가입 하기
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
