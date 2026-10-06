import { ActionButton, BottomSheet } from '@seed-design/react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { convertHangulToKeyboardInput } from '../../../shared/convertHangulToKeyboardInput';
import { signup } from '../api/signupApi';
import { checkUserAvailability } from '../api/userAvailabilityApi';
import type { AvailabilityField } from '../api/userAvailabilityApi';
import { getCurrentTerms, getTermDetail } from '../api/termsApi';
import type { CurrentTerm, TermDetail } from '../api/termsApi';
import './SignupPage.css';

type Gender = '' | 'MALE' | 'FEMALE';
type InputField = 'nickname' | 'email' | 'password' | 'birthYear';
type DuplicateField = 'nickname' | 'email';

type SignupPageProps = {
  onSignupSuccess?: () => void;
};

const maxLengthByField = {
  nickname: 12,
  email: 40,
  password: 64,
} as const;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nicknameCharacterPattern = /^[가-힣A-Za-z0-9]*$/;
const passwordPattern = /^[A-Za-z0-9!@#$%^&*_+=-]+$/;
const EMAIL_PART_CHARACTER_PATTERN = /[^\p{Script=Hangul}A-Za-z0-9._+@\-\s]/gu;
const PASSWORD_GUIDANCE = '8~64자 / 사용 가능 특수문자: ! @ # $ % ^ & * _ - + =';
const PASSWORD_CHARACTER_ERROR = `사용할 수 없는 특수 문자가 포함되어 있어요. ${PASSWORD_GUIDANCE}`;
const MIN_BIRTH_YEAR = 1900;
const CURRENT_YEAR = new Date().getFullYear();

const errorMessages: Record<string, string> = {
  'invalid request': '입력 내용을 다시 확인해 주세요.',
  'email already exists': '이미 가입된 이메일이에요.',
  'internal server error': '회원가입을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.',
};

function normalizeEmailPart(value: string) {
  return value.replace(EMAIL_PART_CHARACTER_PATTERN, '').toLowerCase();
}

function getInputError(field: InputField, value: string) {
  if (field === 'nickname') {
    const normalizedNickname = value.trim();
    if (normalizedNickname === '') return '닉네임을 입력해 주세요.';
    if (normalizedNickname.length < 2 || normalizedNickname.length > maxLengthByField.nickname) {
      return '닉네임은 2자 이상 12자 이하로 입력해 주세요.';
    }
    if (!nicknameCharacterPattern.test(normalizedNickname))
      return '한글, 영문, 숫자만 사용할 수 있어요.';
    return undefined;
  }

  if (field === 'email') {
    const trimmedEmail = value.trim();
    if (trimmedEmail === '') return '이메일을 입력해 주세요.';
    if (value.length > maxLengthByField.email) return '최대 입력 길이인 40자를 넘겼습니다.';
    return emailPattern.test(trimmedEmail) ? undefined : '올바른 이메일 형식으로 입력해 주세요.';
  }

  if (field === 'password') {
    if (value === '') return '비밀번호를 입력해 주세요.';
    if (value.length < 8) return '비밀번호는 8자 이상 입력해 주세요.';
    if (value.length > maxLengthByField.password) return '비밀번호는 64자 이하로 입력해 주세요.';
    if (!passwordPattern.test(value)) return PASSWORD_CHARACTER_ERROR;
    const hasNumber = /[0-9]/.test(value);
    const hasSpecialCharacter = /[!@#$%^&*_+=-]/.test(value);
    if (!hasNumber && !hasSpecialCharacter)
      return '비밀번호에 숫자와 특수문자를 각각 1개 이상 입력해 주세요.';
    if (!hasNumber) return '비밀번호에 숫자를 1개 이상 입력해 주세요.';
    if (!hasSpecialCharacter) return '비밀번호에 특수문자를 1개 이상 입력해 주세요.';
    return undefined;
  }

  if (value === '') return undefined;
  const year = Number(value);
  if (!Number.isInteger(year) || year < MIN_BIRTH_YEAR || year > CURRENT_YEAR) {
    return `출생연도는 ${MIN_BIRTH_YEAR}년부터 ${CURRENT_YEAR}년 사이로 입력해 주세요.`;
  }
  return undefined;
}

export function SignupPage({ onSignupSuccess }: SignupPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [nickname, setNickname] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState<Gender>('');
  const [agreedTermIds, setAgreedTermIds] = useState<number[]>([]);
  const [currentTerms, setCurrentTerms] = useState<CurrentTerm[]>([]);
  const [termsError, setTermsError] = useState('');
  const [isTermsLoading, setIsTermsLoading] = useState(true);
  const selectAllTermsRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<InputField, string>>>({});
  const [duplicateValues, setDuplicateValues] = useState<Partial<Record<DuplicateField, string>>>(
    {},
  );
  const [availabilityDuplicateValues, setAvailabilityDuplicateValues] = useState<
    Partial<Record<DuplicateField, string>>
  >({});
  const [availabilityErrors, setAvailabilityErrors] = useState<
    Partial<Record<DuplicateField, { value: string; message: string }>>
  >({});
  const availabilityRequestGeneration = useRef<Record<DuplicateField, number>>({
    nickname: 0,
    email: 0,
  });
  const [touchedFields, setTouchedFields] = useState<Partial<Record<InputField, boolean>>>({});
  const [selectedTerm, setSelectedTerm] = useState<TermDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    getCurrentTerms(controller.signal)
      .then((items) => {
        setCurrentTerms(items);
        setTermsError('');
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setTermsError('약관을 불러오지 못했어요. 다시 시도해 주세요.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsTermsLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function reloadTerms() {
    setIsTermsLoading(true);
    try {
      const items = await getCurrentTerms();
      setCurrentTerms(items);
      setAgreedTermIds((previous) =>
        previous.filter((id) => items.some((item) => item.terms_id === id)),
      );
      setTermsError('');
      return items;
    } catch {
      setCurrentTerms([]);
      setAgreedTermIds([]);
      setTermsError('약관을 불러오지 못했어요. 다시 시도해 주세요.');
      return null;
    } finally {
      setIsTermsLoading(false);
    }
  }

  async function showTermDetail(term: CurrentTerm) {
    try {
      setSelectedTerm(await getTermDetail(term));
      setTermsError('');
    } catch {
      setSelectedTerm(null);
      setTermsError('약관 내용을 불러오지 못했어요. 다시 시도해 주세요.');
    }
  }

  const requiredTermIds = currentTerms
    .filter((term) => term.is_required)
    .map((term) => term.terms_id);
  const selectedCurrentTermCount = currentTerms.filter((term) =>
    agreedTermIds.includes(term.terms_id),
  ).length;
  const areAllTermsSelected =
    currentTerms.length > 0 && selectedCurrentTermCount === currentTerms.length;
  const areSomeTermsSelected = selectedCurrentTermCount > 0 && !areAllTermsSelected;

  useEffect(() => {
    if (selectAllTermsRef.current) {
      selectAllTermsRef.current.indeterminate = areSomeTermsSelected;
    }
  }, [areSomeTermsSelected]);

  const formValid =
    !getFieldValidationError('email', email) &&
    !getInputError('password', password) &&
    !getFieldValidationError('nickname', nickname) &&
    !getInputError('birthYear', birthYear) &&
    currentTerms.length === 6 &&
    !termsError &&
    !isTermsLoading &&
    requiredTermIds.every((id) => agreedTermIds.includes(id));

  function toggleTerm(id: number, checked: boolean) {
    setAgreedTermIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((termId) => termId !== id),
    );
  }

  function toggleAllTerms(checked: boolean) {
    setAgreedTermIds(checked ? currentTerms.map((term) => term.terms_id) : []);
  }

  function normalizeDuplicateValue(field: DuplicateField, value: string) {
    return field === 'nickname' ? value.trim() : value.trim().toLowerCase();
  }

  function getFieldValidationError(field: InputField, value: string) {
    const inputError = getInputError(field, value);
    if (inputError) return inputError;
    if (
      (field === 'nickname' || field === 'email') &&
      (duplicateValues[field] === normalizeDuplicateValue(field, value) ||
        availabilityDuplicateValues[field] === normalizeDuplicateValue(field, value))
    ) {
      return field === 'nickname' ? '이미 사용 중인 닉네임이에요.' : '이미 가입된 이메일이에요.';
    }
    return undefined;
  }

  function clearChangedDuplicate(field: DuplicateField, value: string) {
    setDuplicateValues((current) =>
      current[field] && current[field] !== normalizeDuplicateValue(field, value)
        ? { ...current, [field]: undefined }
        : current,
    );
  }

  function invalidateAvailabilityRequest(field: DuplicateField) {
    availabilityRequestGeneration.current[field] += 1;
    setAvailabilityErrors((current) =>
      current[field] ? { ...current, [field]: undefined } : current,
    );
  }

  function clearChangedAvailabilityDuplicate(field: DuplicateField, value: string) {
    const normalizedValue = normalizeDuplicateValue(field, value);
    setAvailabilityDuplicateValues((current) =>
      current[field] && current[field] !== normalizedValue
        ? { ...current, [field]: undefined }
        : current,
    );
    setAvailabilityErrors((current) =>
      current[field] && current[field]?.value !== normalizedValue
        ? { ...current, [field]: undefined }
        : current,
    );
  }

  async function checkAvailability(field: AvailabilityField, value: string) {
    if (getInputError(field, value)) return;

    const normalizedValue = normalizeDuplicateValue(field, value);
    invalidateAvailabilityRequest(field);
    const generation = availabilityRequestGeneration.current[field];
    try {
      const available = await checkUserAvailability(field, normalizedValue);
      if (availabilityRequestGeneration.current[field] !== generation) return;
      setAvailabilityErrors((current) => ({ ...current, [field]: undefined }));
      if (available) {
        setAvailabilityDuplicateValues((current) => ({ ...current, [field]: undefined }));
        setFieldError(
          field,
          duplicateValues[field] === normalizedValue
            ? field === 'nickname'
              ? '이미 사용 중인 닉네임이에요.'
              : '이미 가입된 이메일이에요.'
            : getInputError(field, value),
        );
        return;
      }

      setAvailabilityDuplicateValues((current) => ({ ...current, [field]: normalizedValue }));
      setFieldError(
        field,
        field === 'nickname' ? '이미 사용 중인 닉네임이에요.' : '이미 가입된 이메일이에요.',
      );
    } catch (error) {
      if (availabilityRequestGeneration.current[field] !== generation) return;
      setAvailabilityErrors((current) => ({
        ...current,
        [field]: {
          value: normalizedValue,
          message:
            error instanceof Error && error.message === 'too many requests'
              ? '요청이 많아 잠시 후 다시 확인해 주세요.'
              : '중복 여부를 확인하지 못했어요. 다시 확인해 주세요.',
        },
      }));
    }
  }

  function setFieldError(field: InputField, message?: string) {
    setFieldErrors((current) => {
      if (current[field] === message) return current;
      return { ...current, [field]: message };
    });
  }

  function getMaxLengthError(field: keyof typeof maxLengthByField) {
    if (field === 'password') return '비밀번호는 64자 이하로 입력해 주세요.';
    return '최대 입력 길이인 ' + maxLengthByField[field] + '자를 넘겼습니다.';
  }

  function updateEmail(value: string) {
    invalidateAvailabilityRequest('email');
    const normalized = normalizeEmailPart(value);
    const exceedsMaxLength = normalized.length > maxLengthByField.email;
    const limitedValue = normalized.slice(0, maxLengthByField.email);
    setEmail(limitedValue);
    clearChangedDuplicate('email', limitedValue);
    clearChangedAvailabilityDuplicate('email', limitedValue);
    setFieldError(
      'email',
      exceedsMaxLength
        ? getMaxLengthError('email')
        : getFieldValidationError('email', limitedValue),
    );
  }

  function updateTextField(
    field: 'nickname' | 'password',
    value: string,
    setValue: (nextValue: string) => void,
    isComposing = false,
  ) {
    if (field === 'nickname') {
      invalidateAvailabilityRequest('nickname');
      setValue(value);
      clearChangedDuplicate('nickname', value);
      clearChangedAvailabilityDuplicate('nickname', value);
      setFieldError(
        'nickname',
        isComposing ? undefined : getFieldValidationError('nickname', value),
      );
      return;
    }

    const convertedValue = convertHangulToKeyboardInput(value);
    const exceedsMaxLength = convertedValue.length > maxLengthByField.password;
    const limitedValue = convertedValue.slice(0, maxLengthByField.password);
    setValue(limitedValue);
    setFieldError(
      'password',
      exceedsMaxLength ? getMaxLengthError('password') : getInputError('password', limitedValue),
    );
  }

  function preventOverLengthInput(
    event: FormEvent<HTMLInputElement>,
    field: keyof typeof maxLengthByField,
    currentValue: string,
  ) {
    const nativeEvent = event.nativeEvent as InputEvent;
    if (nativeEvent.isComposing) return;
    const insertedValue = nativeEvent.data;
    if (!insertedValue || nativeEvent.inputType?.startsWith('delete')) return;
    const { selectionEnd, selectionStart } = event.currentTarget;
    const selectedLength = (selectionEnd ?? 0) - (selectionStart ?? 0);
    if (currentValue.length - selectedLength + insertedValue.length <= maxLengthByField[field])
      return;
    event.preventDefault();
    setFieldError(field, getMaxLengthError(field));
  }

  function validateOnBlur(field: InputField, value: string) {
    setTouchedFields((current) => ({ ...current, [field]: true }));
    setFieldError(field, getFieldValidationError(field, value));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formValid || submitting) return;
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const result = await signup({
        email: email.trim().toLowerCase(),
        password,
        nickname: nickname.trim(),
        ...(birthYear === '' ? {} : { birth_year: Number(birthYear) }),
        ...(gender === '' ? {} : { gender }),
        terms_ids: agreedTermIds,
      });
      if (onSignupSuccess) {
        onSignupSuccess();
        return;
      }
      setSuccess('회원가입이 완료되었어요. 회원 번호: ' + result.data.user_id);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'internal server error';
      if (message === 'invalid request') {
        const refreshed = await reloadTerms();
        const changed =
          refreshed &&
          refreshed.some(
            (term) =>
              !currentTerms.some(
                (previous) => previous.type === term.type && previous.terms_id === term.terms_id,
              ),
          );
        setError(
          changed
            ? '약관이 변경되었어요. 현재 약관을 확인하고 다시 동의해 주세요.'
            : errorMessages[message],
        );
      } else if (message === 'nickname already exists' || message === 'email already exists') {
        const field = message === 'nickname already exists' ? 'nickname' : 'email';
        const value = field === 'nickname' ? nickname : email;
        invalidateAvailabilityRequest(field);
        setAvailabilityDuplicateValues((current) => ({ ...current, [field]: undefined }));
        setDuplicateValues((current) => ({
          ...current,
          [field]: normalizeDuplicateValue(field, value),
        }));
        setFieldError(
          field,
          field === 'nickname' ? '이미 사용 중인 닉네임이에요.' : '이미 가입된 이메일이에요.',
        );
      } else {
        setError(errorMessages[message] ?? errorMessages['internal server error']);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="signup-page">
      <section className="signup-shell" aria-labelledby="signup-title">
        <header className="signup-appbar">
          <button
            className="signup-back"
            type="button"
            aria-label="이전 화면으로 돌아가기"
            onClick={() => history.back()}
          >
            <img src="/icons/chatbot/Arrow-reft.svg" alt="" aria-hidden="true" />
          </button>
          <h1 id="signup-title">회원가입</h1>
          <span className="signup-appbar-spacer" aria-hidden="true" />
        </header>

        <form className="signup-form" onSubmit={handleSubmit} noValidate>
          <div className="signup-form-fields">
            <div className="signup-field">
              <div
                className={
                  'signup-input-wrap' +
                  (fieldErrors.nickname ||
                  (availabilityErrors.nickname?.value ===
                    normalizeDuplicateValue('nickname', nickname) &&
                    !fieldErrors.nickname)
                    ? ' has-error'
                    : '')
                }
              >
                <label className="signup-label" htmlFor="signup-nickname">
                  닉네임 <span>*</span>
                </label>
                <input
                  id="signup-nickname"
                  className="signup-input"
                  value={nickname}
                  onChange={(event) =>
                    updateTextField(
                      'nickname',
                      event.target.value,
                      setNickname,
                      (event.nativeEvent as InputEvent).isComposing,
                    )
                  }
                  onCompositionEnd={(event) =>
                    updateTextField('nickname', event.currentTarget.value, setNickname)
                  }
                  onBlur={() => {
                    const normalizedNickname = nickname.trim();
                    setNickname(normalizedNickname);
                    validateOnBlur('nickname', normalizedNickname);
                    void checkAvailability('nickname', normalizedNickname);
                  }}
                  placeholder="닉네임을 입력해주세요"
                  autoComplete="nickname"
                  aria-invalid={Boolean(
                    fieldErrors.nickname ||
                    availabilityErrors.nickname?.value ===
                      normalizeDuplicateValue('nickname', nickname),
                  )}
                  aria-describedby={
                    fieldErrors.nickname ||
                    availabilityErrors.nickname?.value ===
                      normalizeDuplicateValue('nickname', nickname)
                      ? 'nickname-error'
                      : undefined
                  }
                  disabled={submitting}
                />
              </div>
              {(fieldErrors.nickname ||
                (availabilityErrors.nickname?.value ===
                  normalizeDuplicateValue('nickname', nickname) &&
                  availabilityErrors.nickname.message)) && (
                <span id="nickname-error" className="signup-field-error">
                  {fieldErrors.nickname || availabilityErrors.nickname?.message}
                </span>
              )}
            </div>

            <div className="signup-field">
              <div
                className={
                  'signup-input-wrap' +
                  (fieldErrors.email ||
                  availabilityErrors.email?.value === normalizeDuplicateValue('email', email)
                    ? ' has-error'
                    : '')
                }
              >
                <label className="signup-label" htmlFor="signup-email">
                  이메일 <span>*</span>
                </label>
                <input
                  id="signup-email"
                  className="signup-input"
                  type="email"
                  maxLength={maxLengthByField.email}
                  value={email}
                  onBeforeInput={(event) => preventOverLengthInput(event, 'email', email)}
                  onInput={(event) => updateEmail(event.currentTarget.value)}
                  onChange={(event) => updateEmail(event.currentTarget.value)}
                  onCompositionUpdate={(event) => updateEmail(event.currentTarget.value)}
                  onCompositionEnd={(event) => updateEmail(event.currentTarget.value)}
                  onBlur={() => {
                    const normalizedEmail = email.trim().toLowerCase();
                    setEmail(normalizedEmail);
                    validateOnBlur('email', normalizedEmail);
                    void checkAvailability('email', normalizedEmail);
                  }}
                  placeholder="example@example.com"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={Boolean(
                    fieldErrors.email ||
                    availabilityErrors.email?.value === normalizeDuplicateValue('email', email),
                  )}
                  aria-describedby={
                    fieldErrors.email ||
                    availabilityErrors.email?.value === normalizeDuplicateValue('email', email)
                      ? 'email-error'
                      : undefined
                  }
                  disabled={submitting}
                />
              </div>
              {(fieldErrors.email ||
                (availabilityErrors.email?.value === normalizeDuplicateValue('email', email) &&
                  availabilityErrors.email.message)) && (
                <span id="email-error" className="signup-field-error">
                  {fieldErrors.email || availabilityErrors.email?.message}
                </span>
              )}
            </div>

            <div className="signup-field">
              <div
                className={
                  'signup-input-wrap signup-password-wrap' +
                  (fieldErrors.password ? ' has-error' : '')
                }
              >
                <label className="signup-label" htmlFor="signup-password">
                  비밀번호 <span>*</span>
                </label>
                <input
                  id="signup-password"
                  className="signup-input"
                  type={isPasswordVisible ? 'text' : 'password'}
                  value={password}
                  onBeforeInput={(event) => preventOverLengthInput(event, 'password', password)}
                  onChange={(event) =>
                    updateTextField(
                      'password',
                      event.target.value,
                      setPassword,
                      (event.nativeEvent as InputEvent).isComposing,
                    )
                  }
                  onCompositionEnd={(event) =>
                    updateTextField('password', event.currentTarget.value, setPassword)
                  }
                  onFocus={() => setIsPasswordFocused(true)}
                  onBlur={() => {
                    setIsPasswordFocused(false);
                    validateOnBlur('password', password);
                  }}
                  minLength={8}
                  placeholder="8자 이상 입력해주세요"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  lang="en"
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                  disabled={submitting}
                />
                <button
                  className="signup-password-visibility"
                  type="button"
                  aria-label={isPasswordVisible ? '비밀번호 숨기기' : '비밀번호 표시'}
                  onClick={() => setIsPasswordVisible((current) => !current)}
                  disabled={submitting}
                >
                  <img
                    src={
                      isPasswordVisible
                        ? '/icons/auth/View-on.svg'
                        : '/icons/auth/View-off.svg'
                    }
                    alt=""
                  />
                </button>
              </div>
              {fieldErrors.password && (
                <span id="password-error" className="signup-field-error">
                  {fieldErrors.password}
                </span>
              )}
              {!fieldErrors.password && isPasswordFocused && (
                <span className="signup-field-hint">{PASSWORD_GUIDANCE}</span>
              )}
            </div>

            <div className="signup-field">
              <div className={'signup-input-wrap' + (fieldErrors.birthYear ? ' has-error' : '')}>
                <label className="signup-label" htmlFor="signup-birth-year">
                  출생연도 <em>(선택)</em>
                </label>
                <input
                  id="signup-birth-year"
                  className="signup-input"
                  type="number"
                  value={birthYear}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setBirthYear(nextValue);
                    if (touchedFields.birthYear)
                      setFieldError('birthYear', getInputError('birthYear', nextValue));
                  }}
                  onBlur={() => validateOnBlur('birthYear', birthYear)}
                  min={MIN_BIRTH_YEAR}
                  max={CURRENT_YEAR}
                  inputMode="numeric"
                  placeholder="출생연도를 입력해주세요"
                  aria-invalid={Boolean(fieldErrors.birthYear)}
                  aria-describedby={fieldErrors.birthYear ? 'birth-year-error' : undefined}
                  disabled={submitting}
                />
              </div>
              {fieldErrors.birthYear && (
                <span id="birth-year-error" className="signup-field-error">
                  {fieldErrors.birthYear}
                </span>
              )}
            </div>

            <div
              className="signup-field signup-input-wrap signup-gender"
              role="group"
              aria-labelledby="gender-title"
            >
              <span id="gender-title" className="signup-label">
                성별 <em>(선택)</em>
              </span>
              <div className="signup-gender-options" role="group" aria-describedby="gender-hint">
                {(['FEMALE', 'MALE'] as const).map((value) => {
                  const label = value === 'FEMALE' ? '여성' : '남성';
                  const checked = gender === value;
                  return (
                    <label className="signup-gender-option" key={value}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setGender((current) => (current === value ? '' : value))}
                        aria-label={label}
                        disabled={submitting}
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
              <span id="gender-hint" className="visually-hidden">
                한 항목을 선택하거나 선택한 항목을 다시 눌러 취소할 수 있습니다.
              </span>
            </div>

            <p className="signup-personalization">
              더 잘 맞는 음악을 추천받고 싶다면 알려주세요.
              <br />
              출생연도와 성별 정보는 AI 음악 추천 개인화에만 활용됩니다.
            </p>

            <section className="signup-input-wrap signup-terms" aria-labelledby="terms-title">
              <h2 id="terms-title">
                약관 동의 <span className="visually-hidden">(필수)</span>
              </h2>
              <label className="signup-terms-select-all">
                <input
                  ref={selectAllTermsRef}
                  className="signup-checkbox"
                  type="checkbox"
                  checked={areAllTermsSelected}
                  onChange={(event) => toggleAllTerms(event.target.checked)}
                  disabled={
                    submitting || isTermsLoading || Boolean(termsError) || currentTerms.length === 0
                  }
                />
                <span>전체선택</span>
              </label>
              <div className="signup-check-list">
                {isTermsLoading && (
                  <p className="signup-terms-status" role="status">
                    약관을 불러오는 중이에요.
                  </p>
                )}
                {!isTermsLoading &&
                  !termsError &&
                  currentTerms.map((term) => {
                    const label = (term.is_required ? '[필수] ' : '[선택] ') + term.title;
                    return (
                      <div className="signup-term-row" key={term.terms_id}>
                        <input
                          className="signup-checkbox"
                          type="checkbox"
                          checked={agreedTermIds.includes(term.terms_id)}
                          onChange={(event) => toggleTerm(term.terms_id, event.target.checked)}
                          aria-label={label}
                          disabled={submitting}
                        />
                        <button
                          className="signup-term-link"
                          type="button"
                          onClick={() => showTermDetail(term)}
                        >
                          {label}
                        </button>
                      </div>
                    );
                  })}
                {termsError && (
                  <p className="signup-terms-error" role="alert">
                    {termsError}{' '}
                    <button type="button" onClick={reloadTerms} disabled={isTermsLoading}>
                      다시 시도
                    </button>
                  </p>
                )}
              </div>
            </section>
          </div>

          {error && (
            <p className="signup-message signup-error" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="signup-message signup-success" role="status">
              {success}
            </p>
          )}
          <ActionButton
            className="signup-submit"
            type="submit"
            variant="brandSolid"
            size="large"
            disabled={!formValid || submitting}
            loading={submitting}
          >
            회원가입
          </ActionButton>
        </form>
      </section>

      <BottomSheet.Root
        open={selectedTerm !== null}
        onOpenChange={(open) => !open && setSelectedTerm(null)}
      >
        <BottomSheet.Backdrop />
        <BottomSheet.Positioner>
          <BottomSheet.Content>
            <BottomSheet.Header>
              <BottomSheet.Title>{selectedTerm?.title}</BottomSheet.Title>
              <BottomSheet.Description>{selectedTerm?.version}</BottomSheet.Description>
              <BottomSheet.CloseButton aria-label="약관 상세 닫기">닫기</BottomSheet.CloseButton>
            </BottomSheet.Header>
            <BottomSheet.Body className="signup-term-sheet-body">
              <p>{selectedTerm?.content}</p>
            </BottomSheet.Body>
          </BottomSheet.Content>
        </BottomSheet.Positioner>
      </BottomSheet.Root>
    </main>
  );
}
