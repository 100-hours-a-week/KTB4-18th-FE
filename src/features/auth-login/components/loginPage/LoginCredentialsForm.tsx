import type { SetStateAction } from 'react';

import { EMAIL_NOT_REGISTERED_ERROR } from '../../hooks/loginQueueFlowUtils';
import type { FieldErrors } from '../../hooks/loginQueueFlowUtils';
import type { useLoginQueueFlow } from '../../hooks/useLoginQueueFlow';

type LoginFlowFields = Pick<
  ReturnType<typeof useLoginQueueFlow>,
  'emailInputRef' | 'updateEmail' | 'updatePassword'
>;

type LoginCredentialsFormProps = LoginFlowFields & {
  email: string;
  password: string;
  fieldErrors: FieldErrors;
  isPasswordVisible: boolean;
  setIsPasswordVisible: (value: SetStateAction<boolean>) => void;
  isLoginLocked: boolean;
  isAuthSupported: boolean;
  logoutCleanupPending: boolean;
};

export function LoginCredentialsForm({
  email,
  password,
  fieldErrors,
  emailInputRef,
  updateEmail,
  updatePassword,
  isPasswordVisible,
  setIsPasswordVisible,
  isLoginLocked,
  isAuthSupported,
  logoutCleanupPending,
}: LoginCredentialsFormProps) {
  return (
    <>
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
            disabled={isLoginLocked || !isAuthSupported || logoutCleanupPending}
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
            disabled={isLoginLocked || !isAuthSupported || logoutCleanupPending}
          />
          <button
            className="password-toggle"
            type="button"
            onClick={() => setIsPasswordVisible((visible) => !visible)}
            aria-label={isPasswordVisible ? '비밀번호 숨기기' : '비밀번호 표시'}
            disabled={isLoginLocked || !isAuthSupported || logoutCleanupPending}
          >
            <img
              src={isPasswordVisible ? '/icons/auth/View-on.svg' : '/icons/auth/View-off.svg'}
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
    </>
  );
}
