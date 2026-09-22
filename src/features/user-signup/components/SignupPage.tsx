import IconArrowLeftLine from '@karrotmarket/react-monochrome-icon/IconArrowLeftLine'
import IconEyeLine from '@karrotmarket/react-monochrome-icon/IconEyeLine'
import IconEyeSlashLine from '@karrotmarket/react-monochrome-icon/IconEyeSlashLine'
import {
  ActionButton,
  BottomSheet,
  Checkbox,
  Field,
  Icon,
  RadioGroup,
  RadioGroupField,
  TextField,
} from '@seed-design/react'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { signup } from '../api/signupApi'
import { privacyNotice, privacyPolicyDetail, signupTerms } from '../model/signupTerms'
import type { SignupTerm } from '../model/signupTerms'
import './SignupPage.css'

type Gender = '' | 'MALE' | 'FEMALE'
type InputField = 'nickname' | 'email' | 'password' | 'birthYear'

type SignupPageProps = {
  onSignupSuccess?: () => void
}

const maxLengthByField = {
  nickname: 12,
  email: 40,
  password: 64,
} as const

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const nicknameCharacterPattern = /^[가-힣A-Za-z0-9]*$/
const passwordPattern = /^[A-Za-z0-9!@#$%^&*_+=-]+$/
const EMAIL_PART_CHARACTER_PATTERN = /[^A-Za-z0-9._+-]/g
const EMAIL_DOMAIN_OPTIONS = ['gmail.com', 'naver.com', 'daum.net', 'kakao.com', 'hanmail.net']
const PASSWORD_GUIDANCE = '8~64자 / 사용 가능 특수문자: ! @ # $ % ^ & * _ - + ='
const PASSWORD_CHARACTER_ERROR = `사용할 수 없는 특수 문자가 포함되어 있어요. ${PASSWORD_GUIDANCE}`
const MIN_BIRTH_YEAR = 1900
const CURRENT_YEAR = new Date().getFullYear()
const hangulInitialKeys = [
  'r',
  'R',
  's',
  'e',
  'E',
  'f',
  'a',
  'q',
  'Q',
  't',
  'T',
  'd',
  'w',
  'W',
  'c',
  'z',
  'x',
  'v',
  'g',
]
const hangulMedialKeys = [
  'k',
  'o',
  'i',
  'O',
  'j',
  'p',
  'u',
  'P',
  'h',
  'hk',
  'ho',
  'hl',
  'y',
  'n',
  'nj',
  'np',
  'nl',
  'b',
  'm',
  'ml',
  'l',
]
const hangulFinalKeys = [
  '',
  'r',
  'R',
  'rt',
  's',
  'sw',
  'sg',
  'e',
  'f',
  'fr',
  'fa',
  'fq',
  'ft',
  'fx',
  'fv',
  'fg',
  'a',
  'q',
  'qt',
  't',
  'T',
  'd',
  'w',
  'c',
  'z',
  'x',
  'v',
  'g',
]
const hangulJamoKeys: Record<string, string> = {
  ㄱ: 'r',
  ㄲ: 'R',
  ㄳ: 'rt',
  ㄴ: 's',
  ㄵ: 'sw',
  ㄶ: 'sg',
  ㄷ: 'e',
  ㄸ: 'E',
  ㄹ: 'f',
  ㄺ: 'fr',
  ㄻ: 'fa',
  ㄼ: 'fq',
  ㄽ: 'ft',
  ㄾ: 'fx',
  ㄿ: 'fv',
  ㅀ: 'fg',
  ㅁ: 'a',
  ㅂ: 'q',
  ㅃ: 'Q',
  ㅄ: 'qt',
  ㅅ: 't',
  ㅆ: 'T',
  ㅇ: 'd',
  ㅈ: 'w',
  ㅉ: 'W',
  ㅊ: 'c',
  ㅋ: 'z',
  ㅌ: 'x',
  ㅍ: 'v',
  ㅎ: 'g',
  ㅏ: 'k',
  ㅐ: 'o',
  ㅑ: 'i',
  ㅒ: 'O',
  ㅓ: 'j',
  ㅔ: 'p',
  ㅕ: 'u',
  ㅖ: 'P',
  ㅗ: 'h',
  ㅘ: 'hk',
  ㅙ: 'ho',
  ㅚ: 'hl',
  ㅛ: 'y',
  ㅜ: 'n',
  ㅝ: 'nj',
  ㅞ: 'np',
  ㅟ: 'nl',
  ㅠ: 'b',
  ㅡ: 'm',
  ㅢ: 'ml',
  ㅣ: 'l',
}

const errorMessages: Record<string, string> = {
  'invalid request': '입력 내용을 다시 확인해 주세요.',
  'email already exists': '이미 가입된 이메일이에요.',
  'internal server error': '회원가입을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.',
}

const checkIcon = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="m5 12 4 4L19 6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

type TermDetail = SignupTerm['detail']

function convertHangulToKeyboardInput(value: string) {
  return Array.from(value)
    .map((character) => {
      const code = character.codePointAt(0) ?? 0
      if (code < 0xac00 || code > 0xd7a3) return hangulJamoKeys[character] ?? character

      const syllableIndex = code - 0xac00
      const initialIndex = Math.floor(syllableIndex / 588)
      const medialIndex = Math.floor((syllableIndex % 588) / 28)
      const finalIndex = syllableIndex % 28
      return (
        hangulInitialKeys[initialIndex] +
        hangulMedialKeys[medialIndex] +
        hangulFinalKeys[finalIndex]
      )
    })
    .join('')
}

function composeEmail(localPart: string, domain: string) {
  return `${localPart}${domain ? `@${domain}` : ''}`
}

function normalizeEmailPart(value: string) {
  return convertHangulToKeyboardInput(value).replace(EMAIL_PART_CHARACTER_PATTERN, '').toLowerCase()
}

function getInputError(field: InputField, value: string) {
  if (field === 'nickname') {
    if (value.trim() === '') return '닉네임을 입력해 주세요.'
    if (value.length < 2 || value.length > maxLengthByField.nickname) {
      return '닉네임은 2자 이상 12자 이하로 입력해 주세요.'
    }
    if (!nicknameCharacterPattern.test(value)) return '한글, 영문, 숫자만 사용할 수 있어요.'
    return undefined
  }

  if (field === 'email') {
    const trimmedEmail = value.trim()
    if (trimmedEmail === '') return '이메일을 입력해 주세요.'
    return emailPattern.test(trimmedEmail) ? undefined : '올바른 이메일 형식으로 입력해 주세요.'
  }

  if (field === 'password') {
    if (value === '') return '비밀번호를 입력해 주세요.'
    if (value.length < 8) return '비밀번호는 8자 이상 입력해 주세요.'
    if (value.length > maxLengthByField.password) return '비밀번호는 64자 이하로 입력해 주세요.'
    if (!passwordPattern.test(value)) return PASSWORD_CHARACTER_ERROR
    const hasNumber = /[0-9]/.test(value)
    const hasSpecialCharacter = /[!@#$%^&*_+=-]/.test(value)
    if (!hasNumber && !hasSpecialCharacter)
      return '비밀번호에 숫자와 특수문자를 각각 1개 이상 입력해 주세요.'
    if (!hasNumber) return '비밀번호에 숫자를 1개 이상 입력해 주세요.'
    if (!hasSpecialCharacter) return '비밀번호에 특수문자를 1개 이상 입력해 주세요.'
    return undefined
  }

  if (value === '') return undefined
  const year = Number(value)
  if (!Number.isInteger(year) || year < MIN_BIRTH_YEAR || year > CURRENT_YEAR) {
    return `출생연도는 ${MIN_BIRTH_YEAR}년부터 ${CURRENT_YEAR}년 사이로 입력해 주세요.`
  }
  return undefined
}

export function SignupPage({ onSignupSuccess }: SignupPageProps) {
  const [email, setEmail] = useState('')
  const [emailDomain, setEmailDomain] = useState('')
  const [password, setPassword] = useState('')
  const [isPasswordFocused, setIsPasswordFocused] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [nickname, setNickname] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [gender, setGender] = useState<Gender>('')
  const [agreedTermIds, setAgreedTermIds] = useState<number[]>([])
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<InputField, string>>>({})
  const [touchedFields, setTouchedFields] = useState<Partial<Record<InputField, boolean>>>({})
  const [selectedTerm, setSelectedTerm] = useState<TermDetail | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const requiredTermIds = useMemo(
    () => signupTerms.filter((term) => term.required).map((term) => term.id),
    [],
  )
  const emailLocalPart = email.split('@')[0]
  const formValid =
    !getInputError('email', email) &&
    !getInputError('password', password) &&
    !getInputError('nickname', nickname) &&
    !getInputError('birthYear', birthYear) &&
    requiredTermIds.every((id) => agreedTermIds.includes(id))
  const allTermsSelected = signupTerms.every((term) => agreedTermIds.includes(term.id))

  function toggleTerm(id: number, checked: boolean) {
    setAgreedTermIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((termId) => termId !== id),
    )
  }

  function toggleAllTerms(checked: boolean) {
    setAgreedTermIds(checked ? signupTerms.map((term) => term.id) : [])
  }

  function setFieldError(field: InputField, message?: string) {
    setFieldErrors((current) => {
      if (current[field] === message) return current
      return { ...current, [field]: message }
    })
  }

  function getMaxLengthError(field: keyof typeof maxLengthByField) {
    if (field === 'password') return '비밀번호는 64자 이하로 입력해 주세요.'
    return `최대 입력 길이인 ${maxLengthByField[field]}자를 넘겼습니다.`
  }

  function updateEmail(localPart: string, domain: string, exceedsMaxLength = false) {
    const nextEmail = composeEmail(localPart, domain)
    setEmail(nextEmail)
    setFieldError(
      'email',
      exceedsMaxLength ? getMaxLengthError('email') : getInputError('email', nextEmail),
    )
  }

  function updateEmailLocalPart(value: string) {
    const normalizedLocalPart = normalizeEmailPart(value)
    const maxLocalPartLength = Math.max(
      0,
      maxLengthByField.email - (emailDomain ? emailDomain.length + 1 : 0),
    )
    const exceedsMaxLength = normalizedLocalPart.length > maxLocalPartLength
    updateEmail(normalizedLocalPart.slice(0, maxLocalPartLength), emailDomain, exceedsMaxLength)
  }

  function updateEmailDomain(value: string) {
    const normalizedDomain = normalizeEmailPart(value)
    const maxDomainLength = Math.max(
      0,
      maxLengthByField.email - emailLocalPart.length - (emailLocalPart ? 1 : 0),
    )
    const exceedsMaxLength = normalizedDomain.length > maxDomainLength
    const nextDomain = normalizedDomain.slice(0, maxDomainLength)
    setEmailDomain(nextDomain)
    updateEmail(emailLocalPart, nextDomain, exceedsMaxLength)
  }

  function updateTextField(
    field: 'nickname' | 'password',
    value: string,
    setValue: (nextValue: string) => void,
    isComposing = false,
  ) {
    const maxLength = maxLengthByField[field]
    const isNickname = field === 'nickname'
    const shouldConvertHangulToKeyboardInput = field === 'password'
    const valueWithEnglishKeyboardInput = shouldConvertHangulToKeyboardInput
      ? convertHangulToKeyboardInput(value)
      : value
    const hasUnavailableNicknameCharacter =
      isNickname && !isComposing && !nicknameCharacterPattern.test(valueWithEnglishKeyboardInput)
    const valueWithAllowedCharacters =
      isNickname && !isComposing
        ? valueWithEnglishKeyboardInput.replace(/[^가-힣A-Za-z0-9]/g, '')
        : valueWithEnglishKeyboardInput
    const exceedsMaxLength = valueWithAllowedCharacters.length > maxLength
    const nextValue = valueWithAllowedCharacters.slice(0, maxLength).toLowerCase()

    setValue(nextValue)
    setFieldError(
      field,
      exceedsMaxLength
        ? getMaxLengthError(field)
        : hasUnavailableNicknameCharacter
          ? '한글, 영문, 숫자만 사용할 수 있어요.'
          : field === 'password' || touchedFields[field]
            ? getInputError(field, nextValue)
            : undefined,
    )
  }

  function preventOverLengthInput(
    event: FormEvent<HTMLInputElement>,
    field: keyof typeof maxLengthByField,
    currentValue: string,
  ) {
    const nativeEvent = event.nativeEvent as InputEvent
    if (nativeEvent.isComposing) return
    const insertedValue = nativeEvent.data
    if (!insertedValue || nativeEvent.inputType?.startsWith('delete')) return

    const { selectionEnd, selectionStart } = event.currentTarget
    const selectedLength = (selectionEnd ?? 0) - (selectionStart ?? 0)
    const maxLength = maxLengthByField[field]
    if (currentValue.length - selectedLength + insertedValue.length <= maxLength) return

    event.preventDefault()
    setFieldError(field, getMaxLengthError(field))
  }

  function preventUnavailableNicknameCharacter(event: FormEvent<HTMLInputElement>) {
    const nativeEvent = event.nativeEvent as InputEvent
    if (nativeEvent.isComposing) return

    const insertedValue = nativeEvent.data
    if (!insertedValue || nicknameCharacterPattern.test(insertedValue)) return

    event.preventDefault()
    setFieldError('nickname', '한글, 영문, 숫자만 사용할 수 있어요.')
  }

  function validateOnBlur(field: InputField, value: string) {
    setTouchedFields((current) => ({ ...current, [field]: true }))
    setFieldError(field, getInputError(field, value))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!formValid || submitting) return

    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const result = await signup({
        email: email.trim().toLowerCase(),
        password,
        nickname: nickname.trim(),
        ...(birthYear === '' ? {} : { birth_year: Number(birthYear) }),
        ...(gender === '' ? {} : { gender }),
        terms_ids: agreedTermIds,
      })
      if (onSignupSuccess) {
        onSignupSuccess()
        return
      }
      setSuccess(`회원가입이 완료되었어요. 회원 번호: ${result.data.user_id}`)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'internal server error'
      setError(errorMessages[message] ?? errorMessages['internal server error'])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="signup-page">
      <section className="signup-card" aria-labelledby="signup-title">
        <button
          className="signup-back"
          type="button"
          aria-label="이전 화면으로 돌아가기"
          onClick={() => history.back()}
        >
          <Icon svg={<IconArrowLeftLine />} size="24px" />
        </button>
        <h1 id="signup-title" className="text-title2-bold">
          회원가입
        </h1>
        <p className="signup-intro text-body2-reading-regular">
          머문음에서 나만의 음악 지도를 시작해 보세요.
        </p>

        <form className="signup-form" onSubmit={handleSubmit} noValidate>
          <Field.Root className="signup-field" invalid={Boolean(fieldErrors.nickname)}>
            <Field.Label>닉네임</Field.Label>
            <TextField.Root>
              <TextField.Input
                aria-label="닉네임"
                value={nickname}
                onBeforeInput={(event) => {
                  preventUnavailableNicknameCharacter(event)
                  preventOverLengthInput(event, 'nickname', nickname)
                }}
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
                onBlur={() => validateOnBlur('nickname', nickname)}
                placeholder="입력해주세요"
                autoComplete="nickname"
              />
            </TextField.Root>
            {fieldErrors.nickname && (
              <Field.ErrorMessage>{fieldErrors.nickname}</Field.ErrorMessage>
            )}
          </Field.Root>

          <Field.Root className="signup-field" invalid={Boolean(fieldErrors.email)}>
            <Field.Label>이메일</Field.Label>
            <div className="signup-email-control">
              <TextField.Root>
                <TextField.Input
                  aria-label="이메일 아이디"
                  type="text"
                  value={emailLocalPart}
                  onChange={(event) => updateEmailLocalPart(event.target.value)}
                  onBlur={() => validateOnBlur('email', email)}
                  placeholder="example"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  lang="en"
                />
              </TextField.Root>
              <span className="signup-email-at" aria-hidden="true">
                @
              </span>
              <TextField.Root className="signup-email-domain-input">
                <TextField.Input
                  aria-label="이메일 도메인"
                  type="text"
                  value={emailDomain}
                  onChange={(event) => updateEmailDomain(event.target.value)}
                  onBlur={() => validateOnBlur('email', email)}
                  placeholder="도메인 선택 또는 입력"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  lang="en"
                  list="email-domain-options"
                />
                <datalist id="email-domain-options">
                  {EMAIL_DOMAIN_OPTIONS.map((domain) => (
                    <option key={domain} value={domain} />
                  ))}
                </datalist>
              </TextField.Root>
            </div>
            {fieldErrors.email && <Field.ErrorMessage>{fieldErrors.email}</Field.ErrorMessage>}
          </Field.Root>

          <Field.Root className="signup-field" invalid={Boolean(fieldErrors.password)}>
            <Field.Label>비밀번호</Field.Label>
            <TextField.Root className="signup-password-input">
              <TextField.Input
                aria-label="비밀번호"
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
                  setIsPasswordFocused(false)
                  validateOnBlur('password', password)
                }}
                minLength={8}
                placeholder="8자 이상 입력해주세요"
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                lang="en"
              />
              <button
                className="signup-password-visibility"
                type="button"
                aria-label={isPasswordVisible ? '비밀번호 숨기기' : '비밀번호 표시'}
                onClick={() => setIsPasswordVisible((current) => !current)}
              >
                <Icon
                  svg={isPasswordVisible ? <IconEyeSlashLine /> : <IconEyeLine />}
                  size="20px"
                />
              </button>
            </TextField.Root>
            {fieldErrors.password && (
              <Field.ErrorMessage>{fieldErrors.password}</Field.ErrorMessage>
            )}
            {!fieldErrors.password && isPasswordFocused && (
              <Field.Description>{PASSWORD_GUIDANCE}</Field.Description>
            )}
          </Field.Root>

          <div className="signup-optional-fields">
            <Field.Root className="signup-field" invalid={Boolean(fieldErrors.birthYear)}>
              <Field.Label>
                출생연도 <Field.IndicatorText>(선택)</Field.IndicatorText>
              </Field.Label>
              <TextField.Root>
                <TextField.Input
                  aria-label="출생연도"
                  type="number"
                  value={birthYear}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setBirthYear(nextValue)
                    if (touchedFields.birthYear)
                      setFieldError('birthYear', getInputError('birthYear', nextValue))
                  }}
                  onBlur={() => validateOnBlur('birthYear', birthYear)}
                  min={MIN_BIRTH_YEAR}
                  max={CURRENT_YEAR}
                  inputMode="numeric"
                  placeholder="출생연도"
                />
              </TextField.Root>
              {fieldErrors.birthYear && (
                <Field.ErrorMessage>{fieldErrors.birthYear}</Field.ErrorMessage>
              )}
            </Field.Root>

            <fieldset className="signup-field signup-gender">
              <legend className="text-label1-normal-semibold">
                성별 <em>(선택)</em>
              </legend>
              <RadioGroupField.Root
                value={gender}
                onValueChange={(value) => setGender(value as Gender)}
                name="gender"
              >
                <RadioGroup.Item value="FEMALE">
                  <RadioGroup.ItemControl>
                    <RadioGroup.ItemIndicator />
                  </RadioGroup.ItemControl>
                  <RadioGroup.ItemLabel>여성</RadioGroup.ItemLabel>
                  <RadioGroup.ItemHiddenInput />
                </RadioGroup.Item>
                <RadioGroup.Item value="MALE">
                  <RadioGroup.ItemControl>
                    <RadioGroup.ItemIndicator />
                  </RadioGroup.ItemControl>
                  <RadioGroup.ItemLabel>남성</RadioGroup.ItemLabel>
                  <RadioGroup.ItemHiddenInput />
                </RadioGroup.Item>
              </RadioGroupField.Root>
            </fieldset>
          </div>

          <p className="signup-personalization text-body3-reading-regular">
            더 잘 맞는 음악을 추천받고 싶다면 알려주세요.
            <br />
            출생연도와 성별 정보는 AI 음악 추천 개인화에만 활용됩니다.
          </p>

          <section className="signup-terms" aria-labelledby="terms-title">
            <h2 id="terms-title" className="text-heading1-bold">
              약관 동의
            </h2>
            <Checkbox.Root
              checked={allTermsSelected}
              onCheckedChange={toggleAllTerms}
              className="signup-check-all"
            >
              <Checkbox.Control>
                <Checkbox.Indicator checked={checkIcon} />
              </Checkbox.Control>
              <Checkbox.Label>전체 동의</Checkbox.Label>
              <Checkbox.HiddenInput />
            </Checkbox.Root>
            <button
              className="signup-privacy text-body3-reading-regular"
              type="button"
              onClick={() => setSelectedTerm(privacyPolicyDetail)}
            >
              [확인] {privacyNotice}
            </button>
            <Checkbox.Group className="signup-check-list">
              {signupTerms.map((term) => (
                <div className="signup-term-row" key={term.id}>
                  <Checkbox.Root
                    checked={agreedTermIds.includes(term.id)}
                    onCheckedChange={(checked) => toggleTerm(term.id, checked)}
                    aria-label={term.label}
                  >
                    <Checkbox.Control>
                      <Checkbox.Indicator checked={checkIcon} />
                    </Checkbox.Control>
                    <Checkbox.HiddenInput />
                  </Checkbox.Root>
                  <div>
                    <button
                      className="signup-term-link"
                      type="button"
                      onClick={() => setSelectedTerm(term.detail)}
                    >
                      {term.label}
                    </button>
                    <span className="signup-term-description text-caption-regular">
                      {term.description}
                    </span>
                  </div>
                </div>
              ))}
            </Checkbox.Group>
          </section>

          {error && (
            <p className="signup-error text-body3-reading-regular" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="signup-success text-body3-reading-regular" role="status">
              {success}
            </p>
          )}
          <ActionButton
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
              {selectedTerm?.sections.map((section) => (
                <section key={section.heading} className="signup-term-sheet-section">
                  <h3 className="text-label1-normal-semibold">{section.heading}</h3>
                  <p className="text-body3-reading-regular">{section.content}</p>
                </section>
              ))}
            </BottomSheet.Body>
          </BottomSheet.Content>
        </BottomSheet.Positioner>
      </BottomSheet.Root>
    </main>
  )
}
