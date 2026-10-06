import { ActionButton, BottomSheet, ContentDialog, Menu } from '@seed-design/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import {
  getCurrentTerms,
  getTermDetail,
  type CurrentTerm,
  type TermDetail,
} from '../../user-signup/api/termsApi';
import {
  changeMyPassword,
  verifyMyCurrentPassword,
  getMyProfile,
  getMySettings,
  getRecommendationHistoryPage,
  MyPageRequestError,
  type RecommendationHistoryItem,
  updateMyProfile,
  updateMySettings,
  withdrawMyAccount,
  type UserProfile,
  type UserSettings,
} from '../api/mypageApi';
import { getAllMusicRecords } from '../../music-record/api/musicRecordsApi';
import { validateProfileFields } from '../model/profileValidation';

type MyPageProps = {
  onLogin: () => void;
  onBack: () => void;
  onLogout: () => void;
  isLogoutPending?: boolean;
  logoutError?: string;
  onWithdrawn: () => void | Promise<void>;
  onPasswordChanged?: () => void;
};
type View = 'overview' | 'profile' | 'settings' | 'password' | 'terms' | 'recommendations';
const INITIAL_SETTINGS: UserSettings = {
  map_visibility: 'PRIVATE',
  is_unrecorded_dot_recommendation_enabled: true,
};

function message(error: unknown, fallback: string) {
  if (error instanceof MyPageRequestError) {
    if (error.status === 401) return '로그인이 만료되었어요. 다시 로그인해 주세요.';
    if (error.status === null) return '네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
    return error.messageFromServer ?? fallback;
  }
  return fallback;
}

const INLINE_MARKDOWN_PATTERN =
  /(\*\*.+?\*\*|__.+?__|~~.+?~~|`[^`]+`|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;

function renderInlineMarkdown(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let previous = 0;
  let key = 0;
  for (const match of value.matchAll(INLINE_MARKDOWN_PATTERN)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > previous) nodes.push(value.slice(previous, start));
    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key++}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (link) {
        nodes.push(
          <a key={key++} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    previous = start + token.length;
  }
  if (previous < value.length) nodes.push(value.slice(previous));
  return nodes;
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownBlockStart(lines: string[], index: number): boolean {
  const line = lines[index]?.trim() ?? '';
  return (
    /^#{1,6}\s/.test(line) ||
    /^```/.test(line) ||
    /^>/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    /^(?:---+|___+|\*\*\*+)$/.test(line) ||
    (line.includes('|') && isMarkdownTableSeparator(lines[index + 1] ?? ''))
  );
}

function TermsMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (/^```/.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${index}`}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      const level = Math.min(6, heading?.[1].length ?? 2);
      const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
      const Tag = headingTags[level - 1];
      blocks.push(<Tag key={`heading-${index}`}>{renderInlineMarkdown(heading?.[2] ?? '')}</Tag>);
      index += 1;
      continue;
    }
    if (line.includes('|') && isMarkdownTableSeparator(lines[index + 1] ?? '')) {
      const headers = splitMarkdownTableRow(line);
      const separators = splitMarkdownTableRow(lines[index + 1]);
      const alignments = separators.map((cell) =>
        cell.startsWith(':') && cell.endsWith(':')
          ? 'center'
          : cell.endsWith(':')
            ? 'right'
            : 'left',
      );
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().includes('|')) {
        rows.push(splitMarkdownTableRow(lines[index++]));
      }
      blocks.push(
        <div className="mypage-terms-table-scroll" key={`table-${index}`}>
          <table className="mypage-terms-table">
            <thead>
              <tr>
                {headers.map((cell, column) => (
                  <th
                    key={`heading-${column}`}
                    style={{ textAlign: alignments[column] as 'left' | 'center' | 'right' }}
                  >
                    {renderInlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {headers.map((_, column) => (
                    <td
                      key={`cell-${column}`}
                      style={{ textAlign: alignments[column] as 'left' | 'center' | 'right' }}
                    >
                      {renderInlineMarkdown(row[column] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      const ordered = /^\d+[.)]\s+/.test(line);
      const listItems: ReactNode[] = [];
      const pattern = ordered ? /^\d+[.)]\s+(.*)$/ : /^[-*+]\s+(.*)$/;
      while (index < lines.length && pattern.test(lines[index].trim())) {
        const item = lines[index].trim().replace(pattern, '$1');
        listItems.push(<li key={index}>{renderInlineMarkdown(item)}</li>);
        index += 1;
      }
      blocks.push(
        ordered ? (
          <ol key={`list-${index}`}>{listItems}</ol>
        ) : (
          <ul key={`list-${index}`}>{listItems}</ul>
        ),
      );
      continue;
    }
    if (/^>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index++].replace(/^\s*>\s?/, '').trim());
      }
      blocks.push(
        <blockquote key={`quote-${index}`}>{renderInlineMarkdown(quote.join(' '))}</blockquote>,
      );
      continue;
    }
    if (/^(?:---+|___+|\*\*\*+)$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} />);
      index += 1;
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines, index)) {
      paragraph.push(lines[index++].trim());
    }
    blocks.push(<p key={`paragraph-${index}`}>{renderInlineMarkdown(paragraph.join(' '))}</p>);
  }
  return <div className="mypage-terms-markdown">{blocks}</div>;
}

function Header({
  title,
  onBack,
  children,
  className,
}: {
  title: string;
  onBack?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`mypage-header ${className ?? ''}`}>
      {onBack ? (
        <button
          className="mypage-icon-button"
          type="button"
          onClick={onBack}
          aria-label="마이페이지로 돌아가기"
        >
          <img src="/icons/chatbot/Arrow-reft.svg" alt="" aria-hidden="true" />
        </button>
      ) : (
        <span className="mypage-header-spacer" aria-hidden="true" />
      )}
      <h1>{title}</h1>
      <div className="mypage-header-action">{children}</div>
    </header>
  );
}

function ProfilePage({
  profile,
  reload,
  back,
}: {
  profile: UserProfile;
  reload: () => void;
  back: () => void;
}) {
  const [nickname, setNickname] = useState(profile.nickname);
  const [birthYear, setBirthYear] = useState(profile.birth_year?.toString() ?? '');
  const [gender, setGender] = useState(profile.gender ?? '');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const validationErrors = validateProfileFields(nickname, birthYear);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Object.values(validationErrors).some(Boolean) || saving) {
      setNotice('프로필 정보를 확인해 주세요.');
      return;
    }
    setSaving(true);
    setNotice('');
    try {
      await updateMyProfile({
        nickname: nickname.trim(),
        birth_year: birthYear ? Number(birthYear) : null,
        gender: gender || null,
      });
      setNotice('프로필을 저장했어요.');
      reload();
    } catch (error) {
      setNotice(message(error, '프로필을 저장하지 못했어요.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <Header title="프로필 수정" onBack={back}>
        <Menu.Root>
          <Menu.Trigger className="mypage-icon-button" aria-label="더보기">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </Menu.Trigger>
          <Menu.Positioner>
            <Menu.Content>
              <Menu.Item onClick={back}>마이페이지로 돌아가기</Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Menu.Root>
      </Header>
      <section className="mypage-page-content mypage-profile-page">
        <form className="mypage-form" onSubmit={submit}>
          <label>
            <span>
              닉네임 <b aria-hidden="true">*</b>
            </span>
            <input
              value={nickname}
              maxLength={12}
              onChange={(event) => {
                setNickname(event.target.value);
                setNotice('');
              }}
              aria-invalid={Boolean(validationErrors.nickname)}
              aria-describedby={validationErrors.nickname ? 'mypage-nickname-error' : undefined}
            />
            {validationErrors.nickname && (
              <span id="mypage-nickname-error" className="mypage-notice" role="alert">
                {validationErrors.nickname}
              </span>
            )}
          </label>
          <label>
            <span>
              이메일 <b aria-hidden="true">*</b>
            </span>
            <input value={profile.email} readOnly aria-readonly="true" />
          </label>
          <label>
            <span>
              출생연도 <span className="mypage-optional-label">(선택)</span>
            </span>
            <input
              value={birthYear}
              aria-label="출생 연도 (선택)"
              inputMode="numeric"
              maxLength={4}
              onChange={(event) => {
                setBirthYear(event.target.value.replace(/\D/g, ''));
                setNotice('');
              }}
              aria-invalid={Boolean(validationErrors.birthYear)}
              aria-describedby={validationErrors.birthYear ? 'mypage-birth-year-error' : undefined}
            />
            {validationErrors.birthYear && (
              <span id="mypage-birth-year-error" className="mypage-notice" role="alert">
                {validationErrors.birthYear}
              </span>
            )}
          </label>
          <div className="mypage-gender-field" role="group" aria-labelledby="mypage-gender-label">
            <span id="mypage-gender-label" className="mypage-gender-title">
              성별 <span className="mypage-optional-label">(선택)</span>
            </span>
            <div className="mypage-gender-options">
              <label>
                <input
                  type="checkbox"
                  name="mypage-gender"
                  value="FEMALE"
                  checked={gender === 'FEMALE'}
                  onChange={(event) => setGender(event.target.checked ? 'FEMALE' : '')}
                />
                <span className="mypage-gender-check" aria-hidden="true" />
                <span>여성</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  name="mypage-gender"
                  value="MALE"
                  checked={gender === 'MALE'}
                  onChange={(event) => setGender(event.target.checked ? 'MALE' : '')}
                />
                <span className="mypage-gender-check" aria-hidden="true" />
                <span>남성</span>
              </label>
            </div>
          </div>
          <aside className="mypage-personalization-note">
            더 잘 맞는 음악을 추천받고 싶다면 알려주세요.
            <br />
            출생연도와 성별 정보는 AI 음악 추천 개인화에만 활용됩니다.
          </aside>
          {notice && (
            <p className="mypage-notice" role="status">
              {notice}
            </p>
          )}
          <div className="mypage-action-dock">
            <ActionButton
              type="submit"
              variant="brandSolid"
              size="medium"
              loading={saving}
              disabled={saving}
            >
              저장
            </ActionButton>
          </div>
        </form>
      </section>
    </>
  );
}

function SettingsPage({
  settings,
  reload,
  back,
}: {
  settings: UserSettings;
  reload: () => void;
  back: () => void;
}) {
  const [value, setValue] = useState(settings);
  const [notice, setNotice] = useState('');
  async function save(next: UserSettings) {
    const previous = value;
    setValue(next);
    setNotice('');
    try {
      await updateMySettings(next);
      reload();
    } catch (error) {
      setValue(previous);
      setNotice(message(error, '설정을 저장하지 못했어요.'));
    }
  }
  return (
    <>
      <Header title="설정" onBack={back} />
      <section className="mypage-page-content">
        <h2>개인 설정</h2>
        <label className="mypage-switch-row">
          <span>
            <strong>지도 공개</strong>
            <small>내 음악 지도를 다른 사용자에게 보여줘요.</small>
          </span>
          <input
            type="checkbox"
            checked={value.map_visibility === 'PUBLIC'}
            onChange={(event) =>
              void save({ ...value, map_visibility: event.target.checked ? 'PUBLIC' : 'PRIVATE' })
            }
          />
        </label>
        <label className="mypage-switch-row">
          <span>
            <strong>미기록 도트 추천</strong>
            <small>아직 기록하지 않은 장소의 음악을 추천해요.</small>
          </span>
          <input
            type="checkbox"
            checked={value.is_unrecorded_dot_recommendation_enabled}
            onChange={(event) =>
              void save({
                ...value,
                is_unrecorded_dot_recommendation_enabled: event.target.checked,
              })
            }
          />
        </label>
        {notice && (
          <p className="mypage-notice" role="alert">
            {notice}
          </p>
        )}
      </section>
    </>
  );
}

function PasswordPage({
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
      <Header title="비밀번호 재설정" onBack={back} />
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

function TermsPage({ back }: { back: () => void }) {
  const [terms, setTerms] = useState<CurrentTerm[]>([]);
  const [selected, setSelected] = useState<Pick<
    TermDetail,
    'title' | 'version' | 'content'
  > | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      setTerms(await getCurrentTerms());
    } catch {
      setTerms([]);
      setError('약관 및 정책을 불러오지 못했어요.');
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function open(term: CurrentTerm) {
    setError('');
    try {
      setSelected(await getTermDetail(term));
    } catch {
      setError('약관 상세를 불러오지 못했어요.');
    }
  }
  return (
    <>
      <Header title="약관 및 정책" onBack={back} />
      <section className="mypage-page-content mypage-terms-page">
        {error && (
          <p className="mypage-notice" role="alert">
            {error}{' '}
            <button className="mypage-inline-button" type="button" onClick={() => void load()}>
              다시 시도
            </button>
          </p>
        )}
        <div className="mypage-terms-list">
          {terms.map((term) => (
            <button
              className="mypage-navigation-row"
              type="button"
              key={term.terms_id}
              onClick={() => void open(term)}
            >
              <span>{term.title}</span>
              <img src="/icons/mypage/arrow-right.svg" alt="" />
            </button>
          ))}
          <button
            className="mypage-navigation-row"
            type="button"
            onClick={() =>
              setSelected({
                title: '오픈소스 라이선스',
                version: '',
                content: [
                  '| 오픈소스 | 라이선스 |',
                  '| --- | --- |',
                  '| React | MIT |',
                  '| React DOM | MIT |',
                  '| @seed-design/react | Apache-2.0 |',
                  '| @karrotmarket/react-monochrome-icon | Apache-2.0 |',
                ].join('\n'),
              })
            }
          >
            <span>오픈소스 라이선스</span>
            <img src="/icons/mypage/arrow-right.svg" alt="" />
          </button>
        </div>
        <p className="mypage-app-version">앱 버전 1.0.0 (Build 24)</p>
      </section>
      <BottomSheet.Root
        open={selected !== null}
        onOpenChange={(openSheet) => !openSheet && setSelected(null)}
      >
        <BottomSheet.Backdrop />
        <BottomSheet.Positioner>
          <BottomSheet.Content>
            <BottomSheet.Header>
              <BottomSheet.Title>{selected?.title}</BottomSheet.Title>
              <BottomSheet.Description>{selected?.version}</BottomSheet.Description>
              <BottomSheet.CloseButton aria-label="약관 상세 닫기">닫기</BottomSheet.CloseButton>
            </BottomSheet.Header>
            <BottomSheet.Body className="mypage-term-sheet-body">
              {selected && <TermsMarkdown content={selected.content} />}
            </BottomSheet.Body>
          </BottomSheet.Content>
        </BottomSheet.Positioner>
      </BottomSheet.Root>
    </>
  );
}

type RecommendedSong = RecommendationHistoryItem & { date: string };

function flattenRecommendationPage(
  groups: Awaited<ReturnType<typeof getRecommendationHistoryPage>>['groups'],
) {
  return groups.flatMap((group) =>
    group.recommendations.flatMap((recommendation) =>
      recommendation.items.map((item) => ({ ...item, date: group.date })),
    ),
  );
}

function RecommendationPage({ back }: { back: () => void }) {
  const [songs, setSongs] = useState<RecommendedSong[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [lastPage, setLastPage] = useState({ start: 0, length: 0 });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isLoadingRef = useRef(false);
  const loadedSongCountRef = useRef(0);

  const load = useCallback(async (nextCursor?: string | null) => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setIsLoading(true);
    setError('');
    try {
      const page = await getRecommendationHistoryPage(nextCursor);
      const pageSongs = flattenRecommendationPage(page.groups);
      const start = nextCursor ? loadedSongCountRef.current : 0;
      loadedSongCountRef.current = start + pageSongs.length;
      setLastPage({ start, length: pageSongs.length });
      setSongs((current) => (nextCursor ? [...current, ...pageSongs] : pageSongs));
      setCursor(page.next_cursor);
      setHasNext(page.has_next);
    } catch (caught) {
      setError(message(caught, '추천 받은 곡을 불러오지 못했어요.'));
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !hasNext || !cursor || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void load(cursor);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, hasNext, load, lastPage]);

  const preloadIndex = lastPage.start + Math.max(0, Math.ceil(lastPage.length / 2) - 1);
  return (
    <>
      <Header title="챗봇 추천" onBack={back} />
      <section
        className="mypage-page-content mypage-recommendations"
        aria-labelledby="recommendations-title"
      >
        <h2 id="recommendations-title">챗봇 추천</h2>
        <p className="mypage-recommendations-caption">추천 받은 곡 {songs.length}곡</p>
        {songs.map((song, index) => (
          <article
            className="mypage-recommendation-item"
            key={`${song.music_id}-${song.date}-${index}`}
          >
            <img className="mypage-recommendation-cover" src="/album-placeholder.svg" alt="" />
            <div>
              <strong>{song.title}</strong>
              <span>{song.artist_name}</span>
            </div>
            <span className="mypage-recommendation-play" aria-hidden="true">
              <img src="/icons/mypage/play.svg" alt="" />
            </span>
            {index === preloadIndex && hasNext && <div ref={sentinelRef} aria-hidden="true" />}
          </article>
        ))}
        {error && (
          <p className="mypage-notice" role="alert">
            {error}{' '}
            <button
              className="mypage-inline-button"
              type="button"
              onClick={() => void load(cursor)}
            >
              다시 시도
            </button>
          </p>
        )}
        {isLoading && (
          <p className="mypage-loading" role="status">
            추천 곡을 불러오고 있어요.
          </p>
        )}
        {!songs.length && !isLoading && !error && (
          <p className="mypage-loading">아직 챗봇으로 추천 받은 곡이 없어요.</p>
        )}
        {hasNext && !isLoading && (
          <button className="mypage-inline-button" type="button" onClick={() => void load(cursor)}>
            다음 추천 불러오기
          </button>
        )}
      </section>
    </>
  );
}

function WithdrawalDialog({
  open,
  setOpen,
  onWithdrawn,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  onWithdrawn: () => void | Promise<void>;
}) {
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  function change(opened: boolean) {
    setOpen(opened);
  }
  function changePasswordDialog(opened: boolean) {
    setPasswordDialogOpen(opened);
    if (!opened) {
      setPassword('');
      setNotice('');
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setNotice('');
    try {
      await withdrawMyAccount(password);
      setPassword('');
      setPasswordDialogOpen(false);
      await onWithdrawn();
    } catch (error) {
      setNotice(message(error, '회원 탈퇴를 처리하지 못했어요.'));
    } finally {
      setPassword('');
      setSubmitting(false);
    }
  }
  return (
    <>
      <ContentDialog.Root open={open} onOpenChange={change}>
        <ContentDialog.Backdrop className="mypage-withdrawal-backdrop" />
        <ContentDialog.Positioner>
          <ContentDialog.Content className="mypage-withdrawal-dialog">
            <div className="mypage-withdrawal-warning-content">
              <div className="mypage-withdrawal-icon" aria-hidden="true">
                <svg viewBox="0 0 100 100" focusable="false">
                  <circle cx="50" cy="50" r="42" />
                  <circle className="mypage-info-dot" cx="50" cy="31" r="4" />
                  <path d="M50 44v24" />
                </svg>
              </div>
              <ContentDialog.Header className="mypage-withdrawal-header">
                <ContentDialog.Title className="mypage-withdrawal-title">
                  회원 탈퇴하시겠습니까?
                </ContentDialog.Title>
                <ContentDialog.Description className="mypage-withdrawal-description">
                  지도에 남긴 기록과 추천이 모두 삭제되며 복구할 수 없습니다.
                </ContentDialog.Description>
                <ContentDialog.CloseButton
                  className="mypage-visually-hidden"
                  aria-label="회원 탈퇴 닫기"
                >
                  닫기
                </ContentDialog.CloseButton>
              </ContentDialog.Header>
            </div>
            <ContentDialog.Footer className="mypage-withdrawal-actions">
              <button
                className="mypage-withdrawal-cancel"
                type="button"
                onClick={() => change(false)}
              >
                취소
              </button>
              <ActionButton
                className="mypage-withdrawal-confirm"
                type="button"
                variant="brandSolid"
                size="medium"
                onClick={() => {
                  setPassword('');
                  setNotice('');
                  change(false);
                  setPasswordDialogOpen(true);
                }}
              >
                탈퇴
              </ActionButton>
            </ContentDialog.Footer>
          </ContentDialog.Content>
        </ContentDialog.Positioner>
      </ContentDialog.Root>

      <ContentDialog.Root open={passwordDialogOpen} onOpenChange={changePasswordDialog}>
        <ContentDialog.Backdrop className="mypage-withdrawal-backdrop" />
        <ContentDialog.Positioner>
          <ContentDialog.Content className="mypage-withdrawal-dialog mypage-withdrawal-password-dialog">
            <ContentDialog.Header className="mypage-withdrawal-header">
              <ContentDialog.Title className="mypage-withdrawal-title">
                현재 비밀번호를 입력해주세요
              </ContentDialog.Title>
              <ContentDialog.Description className="mypage-withdrawal-description">
                본인 확인을 위해 현재 비밀번호가 필요합니다.
              </ContentDialog.Description>
              <ContentDialog.CloseButton
                className="mypage-visually-hidden"
                aria-label="비밀번호 입력 닫기"
              >
                닫기
              </ContentDialog.CloseButton>
            </ContentDialog.Header>
            <form className="mypage-withdrawal-password-form" onSubmit={submit}>
              <label className="mypage-withdrawal-password-label">
                현재 비밀번호
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus
                />
              </label>
              {notice && (
                <p className="mypage-notice" role="alert">
                  {notice}
                </p>
              )}
              <ContentDialog.Footer className="mypage-withdrawal-actions">
                <button
                  className="mypage-withdrawal-cancel"
                  type="button"
                  onClick={() => changePasswordDialog(false)}
                >
                  취소
                </button>
                <ActionButton
                  className="mypage-withdrawal-confirm"
                  type="submit"
                  variant="brandSolid"
                  size="medium"
                  loading={submitting}
                  disabled={!password}
                >
                  탈퇴하기
                </ActionButton>
              </ContentDialog.Footer>
            </form>
          </ContentDialog.Content>
        </ContentDialog.Positioner>
      </ContentDialog.Root>
    </>
  );
}

export function MyPage({
  onLogin,
  onBack,
  onLogout,
  isLogoutPending = false,
  logoutError = '',
  onWithdrawn,
  onPasswordChanged,
}: MyPageProps) {
  const [view, setView] = useState<View>('overview');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<UserSettings>(INITIAL_SETTINGS);
  const [savedSongCount, setSavedSongCount] = useState<number | null>(null);
  const [savedSongError, setSavedSongError] = useState('');
  const [error, setError] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const version = useRef(0);
  const reload = useCallback(async () => {
    const current = ++version.current;
    setProfile(null);
    setSavedSongCount(null);
    setError('');
    setSavedSongError('');
    try {
      const [nextProfile, nextSettings] = await Promise.all([getMyProfile(), getMySettings()]);
      if (current !== version.current) return;
      setIsAuthenticated(true);
      setProfile(nextProfile);
      setSettings(nextSettings);
    } catch (caught) {
      if (
        current === version.current &&
        caught instanceof MyPageRequestError &&
        caught.status === 401
      ) {
        setIsAuthenticated(false);
      } else if (current === version.current) {
        setError(message(caught, '마이페이지 정보를 불러오지 못했어요.'));
      }
      return;
    }
    try {
      const records = await getAllMusicRecords();
      if (current === version.current) setSavedSongCount(records.length);
    } catch {
      if (current === version.current) setSavedSongError('저장한 곡 수를 불러오지 못했어요.');
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => {
      window.clearTimeout(timer);
      version.current += 1;
    };
  }, [reload]);
  const joinedDate = useMemo(
    () =>
      profile
        ? new Intl.DateTimeFormat('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }).format(new Date(profile.created_at))
        : '',
    [profile],
  );
  if (isAuthenticated === false)
    return (
      <main className="mypage-screen">
        <section className="mypage-empty">
          <h1>마이페이지</h1>
          <p>내 정보와 음악 활동을 보려면 로그인이 필요해요.</p>
          <ActionButton type="button" variant="brandSolid" size="large" onClick={onLogin}>
            로그인
          </ActionButton>
        </section>
      </main>
    );
  let content: ReactNode;
  if (view === 'profile' && profile)
    content = (
      <ProfilePage
        profile={profile}
        reload={() => void reload()}
        back={() => setView('overview')}
      />
    );
  else if (view === 'settings')
    content = (
      <SettingsPage
        settings={settings}
        reload={() => void reload()}
        back={() => setView('overview')}
      />
    );
  else if (view === 'password')
    content = (
      <PasswordPage back={() => setView('overview')} onPasswordChanged={onPasswordChanged} />
    );
  else if (view === 'terms') content = <TermsPage back={() => setView('overview')} />;
  else if (view === 'recommendations')
    content = <RecommendationPage back={() => setView('overview')} />;
  else
    content = (
      <>
        <Header title="마이페이지" onBack={onBack} className="mypage-overview-header">
          <Menu.Root>
            <Menu.Trigger
              className="mypage-icon-button"
              aria-label="더보기"
              disabled={isLogoutPending}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="19" cy="12" r="1.5" />
              </svg>
            </Menu.Trigger>
            <Menu.Positioner>
              <Menu.Content>
                <Menu.Item onClick={() => setView('profile')}>프로필 수정</Menu.Item>
                <Menu.Item disabled={isLogoutPending} onClick={() => setWithdrawOpen(true)}>
                  회원 탈퇴
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
        </Header>
        {error && (
          <p className="mypage-page-error" role="alert">
            {error}{' '}
            <button className="mypage-inline-button" type="button" onClick={() => void reload()}>
              다시 시도
            </button>
          </p>
        )}
        {!profile ? (
          <p className="mypage-loading" role="status">
            마이페이지를 불러오고 있어요.
          </p>
        ) : (
          <>
            <section className="mypage-summary">
              <div className="mypage-avatar">
                {profile.profile_image_url ? (
                  <img src={profile.profile_image_url} alt="프로필" />
                ) : (
                  <span className="mypage-avatar-placeholder" aria-label="기본 프로필 이미지">
                    <img src="/icons/mypage/Profile.svg" alt="" />
                  </span>
                )}
              </div>
              <div>
                <strong>{profile.nickname}</strong>
                <span className="mypage-summary-email">{profile.email}</span>
                <small className="mypage-summary-joined-date">{joinedDate} 가입</small>
              </div>
              <div className="mypage-song-count">
                <strong>{savedSongCount ?? '—'}</strong>
                <span>저장한 곡</span>
                {savedSongError && (
                  <button
                    className="mypage-inline-button"
                    type="button"
                    onClick={() => void reload()}
                  >
                    재시도
                  </button>
                )}
              </div>
            </section>
            {savedSongError && (
              <p className="mypage-page-error" role="alert">
                {savedSongError}
              </p>
            )}
            <nav className="mypage-navigation" aria-label="마이페이지 메뉴">
              <button
                className="mypage-navigation-row"
                type="button"
                onClick={() => setView('recommendations')}
              >
                <span>챗봇 추천</span>
                <img src="/icons/mypage/arrow-right.svg" alt="" />
              </button>
              <button
                className="mypage-navigation-row"
                type="button"
                onClick={() => setView('password')}
              >
                <span>비밀번호 재설정</span>
                <img src="/icons/mypage/arrow-right.svg" alt="" />
              </button>
              <button
                className="mypage-navigation-row"
                type="button"
                onClick={() => setView('terms')}
              >
                <span>약관 및 정책</span>
                <img src="/icons/mypage/arrow-right.svg" alt="" />
              </button>
            </nav>
            {isLogoutPending && (
              <p role="status" aria-live="polite">
                로그아웃 중…
              </p>
            )}
            {logoutError && (
              <p className="mypage-page-error" role="alert">
                {logoutError}
              </p>
            )}
            <button
              className="mypage-logout-button"
              type="button"
              onClick={() => void onLogout()}
              disabled={isLogoutPending}
            >
              로그아웃
            </button>
          </>
        )}
      </>
    );
  return (
    <main className="mypage-screen">
      {content}
      <WithdrawalDialog open={withdrawOpen} setOpen={setWithdrawOpen} onWithdrawn={onWithdrawn} />
    </main>
  );
}
