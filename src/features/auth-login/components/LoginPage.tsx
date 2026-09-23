import { ActionButton } from '@seed-design/react';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { login, LoginRequestError } from '../api/loginApi';

type FieldErrors = {
  email?: string;
  password?: string;
};

type LoginPageProps = {
  onLoginSuccess?: () => void;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};

  if (!email.trim()) {
    errors.email = '이메일을 입력해 주세요.';
  } else if (!EMAIL_PATTERN.test(email.trim())) {
    errors.email = '이메일 형식을 확인해 주세요.';
  }

  if (!password.trim()) {
    errors.password = '비밀번호를 입력해 주세요.';
  }

  return errors;
}

function getRequestErrorMessage(error: LoginRequestError): string {
  if (error.status === 400) {
    return '입력값을 확인해 주세요.';
  }

  if (error.status === 401) {
    return '이메일 또는 비밀번호를 확인해 주세요.';
  }

  if (error.status === null) {
    return '네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
  }

  return '잠시 후 다시 시도해 주세요.';
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [requestError, setRequestError] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoginSuccessful, setIsLoginSuccessful] = useState(false);

  const isFormValid = Object.keys(validate(email, password)).length === 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    const nextFieldErrors = validate(email, password);
    setFieldErrors(nextFieldErrors);
    setRequestError('');
    setIsLoginSuccessful(false);

    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      await login({ email: email.trim().toLowerCase(), password });
      if (onLoginSuccess) {
        onLoginSuccess();
        return;
      }
      setIsLoginSuccessful(true);
    } catch (error) {
      setRequestError(
        error instanceof LoginRequestError
          ? getRequestErrorMessage(error)
          : '잠시 후 다시 시도해 주세요.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-content" aria-labelledby="login-title">
        <header>
          <h1 id="login-title" className="login-heading text-title1-bold">
            다시 만나서 반가워요
          </h1>
          <p className="login-description text-body1-normal-regular">나의 음악 지도로 이어가요</p>
        </header>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label className="login-label text-body2-normal-semibold" htmlFor="email">
              이메일
            </label>
            <div className={`login-input-wrap ${fieldErrors.email ? 'has-error' : ''}`}>
              <input
                id="email"
                className="login-input text-body1-normal-regular"
                type="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value.toLowerCase())}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                disabled={isSubmitting}
              />
            </div>
            {fieldErrors.email && (
              <p id="email-error" className="login-error text-label1-normal-regular" role="alert">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div className="login-field">
            <label className="login-label text-body2-normal-semibold" htmlFor="password">
              비밀번호
            </label>
            <div className={`login-input-wrap ${fieldErrors.password ? 'has-error' : ''}`}>
              <input
                id="password"
                className="login-input text-body1-normal-regular"
                type={isPasswordVisible ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                disabled={isSubmitting}
              />
              <button
                className="password-toggle text-label1-normal-semibold"
                type="button"
                onClick={() => setIsPasswordVisible((visible) => !visible)}
                aria-label={isPasswordVisible ? '비밀번호 숨기기' : '비밀번호 보기'}
                disabled={isSubmitting}
              >
                {isPasswordVisible ? '숨기기' : '보기'}
              </button>
            </div>
            {fieldErrors.password && (
              <p id="password-error" className="login-error text-label1-normal-regular" role="alert">
                {fieldErrors.password}
              </p>
            )}
          </div>

          {requestError && (
            <p className="login-notice text-body2-normal-regular" role="alert">
              {requestError}
            </p>
          )}
          {isLoginSuccessful && (
            <p className="login-success text-body2-normal-regular" role="status">
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
          >
            로그인
          </ActionButton>
        </form>

        <nav className="login-links text-body2-normal-medium" aria-label="계정 도움말">
          <a className="login-link" href="/signup">
            회원가입
          </a>
          <a className="login-link" href="#password-reset">
            비밀번호 재설정
          </a>
        </nav>
      </section>
    </main>
  );
}
