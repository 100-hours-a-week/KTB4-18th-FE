import {
  isDirectRebootstrapVerified,
  isDirectSourceRecoveryVerified,
} from '../api/authProtocolMode';
import { getDirectAuthCapabilities } from '../api/authCapabilities';
import { ActionButton } from '@seed-design/react';
import type { LoginSuccessResponse } from '../api/loginTypes';
import { useDirectLoginFlow } from '../hooks/useDirectLoginFlow';
import { LoginPageBrand } from './loginPage/LoginPageBrand';
import { LoginCredentialsForm } from './loginPage/LoginCredentialsForm';
import { LoginPageNotices } from './loginPage/LoginPageStatus';
import './LoginPage.css';

type DirectLoginPageProps = {
  authCapabilityMessage?: string;
  authRestoreError?: string;
  onRetryAuthRestore?: () => void;
  onLoginStart?: () => void;
  onLoginFailure?: () => void;
  onLoginSuccess?: (response: LoginSuccessResponse) => void;
  passwordChangedNotice?: boolean;
  onPasswordChangedNoticeDismiss?: () => void;
  protocolEnabled?: boolean;
};

export function DirectLoginPage(props: DirectLoginPageProps) {
  const flow = useDirectLoginFlow({
    onRetryAuthRestore: props.onRetryAuthRestore,
    onLoginStart: props.onLoginStart,
    onLoginFailure: props.onLoginFailure,
    onLoginSuccess: props.onLoginSuccess,
  });
  const supported = getDirectAuthCapabilities().ready && props.protocolEnabled !== false;
  const pending = flow.isPending || flow.recovery.isRecovering;
  return (
    <main className="login-screen">
      <section className="login-content" aria-labelledby="login-title">
        <div className="login-layout">
          <LoginPageBrand />
          <div className="login-body">
            <div className="diary-login-intro">
              <h2>오늘도, 한 곡 남겨볼까요?</h2>
            </div>
            <LoginPageNotices {...props} />
            {!supported && (
              <p className="login-notice" role="alert">
                {props.protocolEnabled === false
                  ? '현재 로그인 기능을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.'
                  : '브라우저의 보안 및 쿠키 설정을 확인한 뒤 다시 로그인해 주세요.'}
              </p>
            )}
            <div className="login-divider" aria-hidden="true">
              <span>로그인/회원가입</span>
            </div>
            <form
              className="login-form"
              onSubmit={(event) => void flow.handleSubmit(event)}
              noValidate
            >
              <LoginCredentialsForm
                {...flow}
                isLoginLocked={flow.isLocked || pending}
                isAuthSupported={supported}
              />
              {flow.message && (
                <p className="login-notice" role="status" aria-live="polite">
                  {flow.message}
                </p>
              )}
              {(flow.isLocked ||
                isDirectRebootstrapVerified() ||
                isDirectSourceRecoveryVerified()) && (
                <button type="button" onClick={() => void flow.checkStatus()} disabled={pending}>
                  상태 확인
                </button>
              )}
              {flow.hasPendingLogout && flow.canRetryPendingLogout && (
                <button
                  type="button"
                  onClick={() => void flow.retryPendingLogout()}
                  disabled={pending}
                >
                  로그아웃 다시 시도
                </button>
              )}
              {flow.recovery.canRecoverSource && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void flow.recovery.recoverSource()}
                >
                  세션 복구
                </button>
              )}
              {flow.recovery.canRebootstrap && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void flow.recovery.rebootstrap()}
                >
                  인증 상태 다시 준비
                </button>
              )}
              <ActionButton
                className={pending ? 'login-submit is-pending' : 'login-submit'}
                type="submit"
                variant="brandSolid"
                size="large"
                loading={false}
                disabled={!flow.isFormValid || flow.isLocked || pending || !supported}
                aria-label={pending ? '로그인 진행 중' : '로그인'}
                aria-busy={pending}
              >
                {pending ? (
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
