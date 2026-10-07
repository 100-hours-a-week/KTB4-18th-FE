import { ActionButton } from '@seed-design/react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { login, LoginRequestError, type LoginSuccessResponse } from '../api/loginApi';
import './LoginPage.css';

type FieldErrors = {
  email?: string;
  password?: string;
};

type LoginPageProps = {
  onLoginSuccess?: (response: LoginSuccessResponse) => void;
  onLoginStart?: () => void;
  onLoginFailure?: () => void;
  passwordChangedNotice?: boolean;
  onPasswordChangedNoticeDismiss?: () => void;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVALID_EMAIL_CHARACTER_PATTERN = /[^\p{Script=Hangul}A-Za-z0-9._+@-]/gu;

function normalizeEmail(value: string) {
  return value.replace(INVALID_EMAIL_CHARACTER_PATTERN, '').toLowerCase();
}

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) errors.email = '이메일을 입력해 주세요.';
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = '이메일 형식을 확인해 주세요.';
  if (!password.trim()) errors.password = '비밀번호를 입력해 주세요.';
  return errors;
}

function getRequestErrorMessage(error: LoginRequestError): string {
  if (error.status === 400) return '입력값을 확인해 주세요.';
  if (error.status === 401) return '이메일 또는 비밀번호를 확인해 주세요.';
  if (error.status === null) return '네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
  return '잠시 후 다시 시도해 주세요.';
}

export function LoginPage({
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
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [isLoginSuccessful, setIsLoginSuccessful] = useState(false);
  const isFormValid = Object.keys(validate(email, password)).length === 0;

  function updateEmail(value: string) {
    const nextEmail = normalizeEmail(value);
    setEmail(nextEmail);
    setFieldErrors((current) => ({
      ...current,
      email: validate(nextEmail, password).email,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    const normalizedEmail = normalizeEmail(email.trim());
    setEmail(normalizedEmail);
    const nextFieldErrors = validate(normalizedEmail, password);
    setFieldErrors(nextFieldErrors);
    setRequestError('');
    setIsLoginSuccessful(false);
    if (Object.keys(nextFieldErrors).length > 0) return;

    setIsSubmitting(true);
    isSubmittingRef.current = true;
    onLoginStart?.();
    try {
      const response = await login({ email: normalizedEmail, password });
      if (onLoginSuccess) {
        onLoginSuccess(response);
        return;
      }
      setIsLoginSuccessful(true);
    } catch (error) {
      onLoginFailure?.();
      setRequestError(
        error instanceof LoginRequestError
          ? getRequestErrorMessage(error)
          : '잠시 후 다시 시도해 주세요.',
      );
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-content" aria-labelledby="login-title">
        <div className="login-layout">
          <header className="login-brand">
            <span className="login-symbol-grid" aria-hidden="true">
              <span className="login-symbol-frame">
                <img className="login-symbol" src="/icons/auth/Logo.svg" alt="" />
              </span>
            </span>
            <h1 id="login-title" className="login-wordmark" aria-label="머문음">
              MEOMUNEUM
            </h1>
          </header>

          <div className="login-body">
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
                    disabled={isSubmitting}
                  />
                </div>
                {fieldErrors.email && (
                  <p id="email-error" className="login-error" role="alert">
                    {fieldErrors.email}
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
                    onChange={(event) => setPassword(event.target.value)}
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                    disabled={isSubmitting}
                  />
                  <button
                    className="password-toggle"
                    type="button"
                    onClick={() => setIsPasswordVisible((visible) => !visible)}
                    aria-label={isPasswordVisible ? '비밀번호 숨기기' : '비밀번호 표시'}
                    disabled={isSubmitting}
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
              {isLoginSuccessful && (
                <p className="login-success" role="status">
                  로그인에 성공했어요.
                </p>
              )}

              <ActionButton
                className="login-submit"
                type="submit"
                variant="brandSolid"
                size="large"
                disabled={!isFormValid || isSubmitting}
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
    </main>
  );
}
