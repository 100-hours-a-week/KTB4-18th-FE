import { ActionButton } from '@seed-design/react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { changeMyPassword, verifyMyCurrentPassword, MyPageRequestError } from '../../api/mypageApi';
import { MyPageHeader } from './MyPageHeader';
import { message } from './useMyPageOverview';

export function PasswordPage({
  back,
  onPasswordChanged,
}: {
  back: () => void;
  onPasswordChanged?: () => void;
}) {
  type PasswordField = 'current' | 'next' | 'confirmation';
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [currentVerified, setCurrentVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [currentError, setCurrentError] = useState('');
  const [focusedField, setFocusedField] = useState<PasswordField | null>(null);
  const [confirmationBlurred, setConfirmationBlurred] = useState(false);
  const verifyGeneration = useRef(0);
  const passwordPolicyError =
    next === ''
      ? '비밀번호를 입력해 주세요.'
      : next.length < 8
        ? '비밀번호는 8자 이상 입력해 주세요.'
        : next.length > 64
          ? '비밀번호는 64자 이하로 입력해 주세요.'
          : !/^[A-Za-z0-9!@#$%^&*_+=-]+$/.test(next)
            ? '영문, 숫자와 허용된 특수문자만 사용할 수 있어요.'
            : !/[0-9]/.test(next)
              ? '비밀번호에 숫자를 1개 이상 입력해 주세요.'
              : !/[!@#$%^&*_+=-]/.test(next)
                ? '비밀번호에 특수문자를 1개 이상 입력해 주세요.'
                : '';
  async function verifyCurrent() {
    const generation = ++verifyGeneration.current;
    setCurrentVerified(false);
    if (!current) {
      setCurrentError('현재 비밀번호를 입력해 주세요.');
      return;
    }
    setVerifying(true);
    setCurrentError('');
    try {
      const result = await verifyMyCurrentPassword(current);
      if (generation !== verifyGeneration.current) return;
      setCurrentVerified(result.valid);
      if (!result.valid) setCurrentError('현재 비밀번호가 틀립니다.');
    } catch (error) {
      if (generation !== verifyGeneration.current) return;
      const status = error instanceof MyPageRequestError ? error.status : null;
      setCurrentError(
        status === 401
          ? '로그인이 만료되었어요. 다시 로그인해 주세요.'
          : status === 400
            ? '현재 비밀번호를 확인해 주세요.'
            : status === 429
              ? '요청이 많아요. 잠시 후 다시 확인해 주세요.'
              : status === 403
                ? '요청 출처를 확인할 수 없어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.'
                : '비밀번호를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      if (generation === verifyGeneration.current) setVerifying(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || saving) return;
    setNotice('');
    setSaving(true);
    try {
      await changeMyPassword(current, next);
      setCurrent('');
      setNext('');
      setConfirmation('');
      onPasswordChanged?.();
    } catch (error) {
      setNotice(message(error, '비밀번호를 변경하지 못했어요.'));
    } finally {
      setSaving(false);
    }
  }
  const canSubmit =
    currentVerified &&
    !verifying &&
    !passwordPolicyError &&
    next !== current &&
    confirmation !== '' &&
    confirmation === next &&
    !saving;
  return (
    <>
      <MyPageHeader title="비밀번호 재설정" onBack={back} />
      <section className="mypage-page-content mypage-password-page">
        <form className="mypage-form" onSubmit={submit}>
          <label>
            <span>
              비밀번호 <b aria-hidden="true">*</b>
            </span>
            <div className="mypage-password-input-wrap">
              <input
                aria-label="현재 비밀번호"
                type={showCurrent ? 'text' : 'password'}
                placeholder="8자 이상 입력해주세요"
                autoComplete="current-password"
                value={current}
                onChange={(event) => {
                  setCurrent(event.target.value);
                  setCurrentVerified(false);
                  verifyGeneration.current++;
                  setVerifying(false);
                  setCurrentError('');
                }}
                onFocus={() => setFocusedField('current')}
                onBlur={() => {
                  setFocusedField(null);
                  void verifyCurrent();
                }}
                aria-invalid={Boolean(currentError)}
                aria-describedby={
                  currentError
                    ? 'current-password-error'
                    : focusedField === 'current'
                      ? 'current-password-help'
                      : undefined
                }
              />
              <button
                className="mypage-password-visibility"
                type="button"
                aria-label={showCurrent ? '현재 비밀번호 숨기기' : '현재 비밀번호 표시'}
                aria-pressed={showCurrent}
                onClick={() => setShowCurrent((visible) => !visible)}
              >
                <img src={`/icons/mypage/view-${showCurrent ? 'on' : 'off'}.svg`} alt="" />
              </button>
            </div>
          </label>
          {focusedField === 'current' && !currentError && (
            <p id="current-password-help" className="mypage-notice">
              현재 사용 중인 비밀번호를 입력해 주세요.
            </p>
          )}
          {currentError && (
            <p id="current-password-error" className="mypage-notice" role="alert">
              {currentError}
            </p>
          )}
          <label>
            <span>
              새 비밀번호 <b aria-hidden="true">*</b>
            </span>
            <div className="mypage-password-input-wrap">
              <input
                aria-label="새 비밀번호"
                type={showNext ? 'text' : 'password'}
                placeholder="8자 이상 입력해주세요"
                autoComplete="new-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                onFocus={() => setFocusedField('next')}
                onBlur={() => setFocusedField(null)}
                aria-invalid={Boolean(next && (passwordPolicyError || next === current))}
                aria-describedby="new-password-help"
              />
              <button
                className="mypage-password-visibility"
                type="button"
                aria-label={showNext ? '새 비밀번호 숨기기' : '새 비밀번호 표시'}
                aria-pressed={showNext}
                onClick={() => setShowNext((visible) => !visible)}
              >
                <img src={`/icons/mypage/view-${showNext ? 'on' : 'off'}.svg`} alt="" />
              </button>
            </div>
          </label>
          <p id="new-password-help" className="mypage-notice" role="status">
            {next === current && next
              ? '현재 비밀번호와 같은 비밀번호입니다.'
              : next && passwordPolicyError
                ? passwordPolicyError
                : '새 비밀번호는 8~64자이며, 숫자와 특수문자를 각각 1개 이상 포함해야 합니다.'}
          </p>
          <label>
            <span>
              새 비밀번호 재입력 <b aria-hidden="true">*</b>
            </span>
            <div className="mypage-password-input-wrap">
              <input
                aria-label="새 비밀번호 확인"
                type={showConfirmation ? 'text' : 'password'}
                placeholder="8자 이상 입력해주세요"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                onFocus={() => setFocusedField('confirmation')}
                onBlur={() => {
                  setFocusedField(null);
                  setConfirmationBlurred(true);
                }}
                aria-invalid={Boolean(confirmationBlurred && confirmation !== next)}
                aria-describedby={
                  confirmationBlurred && (!confirmation || confirmation !== next)
                    ? 'confirmation-password-help'
                    : undefined
                }
              />
              <button
                className="mypage-password-visibility"
                type="button"
                aria-label={showConfirmation ? '비밀번호 확인 숨기기' : '비밀번호 확인 표시'}
                aria-pressed={showConfirmation}
                onClick={() => setShowConfirmation((visible) => !visible)}
              >
                <img src={`/icons/mypage/view-${showConfirmation ? 'on' : 'off'}.svg`} alt="" />
              </button>
            </div>
          </label>
          {confirmationBlurred && (!confirmation || confirmation !== next) && (
            <p id="confirmation-password-help" className="mypage-notice" role="status">
              새 비밀번호와 같은 값을 입력해 주세요.
            </p>
          )}
          {notice && (
            <p className="mypage-notice" role="alert">
              {notice}
            </p>
          )}
          <div className="mypage-action-dock">
            <ActionButton
              type="submit"
              variant="brandSolid"
              size="medium"
              loading={saving}
              disabled={!canSubmit}
            >
              변경하기
            </ActionButton>
          </div>
        </form>
      </section>
    </>
  );
}
