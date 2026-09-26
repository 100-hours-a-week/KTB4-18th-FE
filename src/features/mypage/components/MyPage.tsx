import { ActionButton, BottomSheet, Menu, ResponsiveDialog } from '@seed-design/react';
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

type MyPageProps = {
  accessToken: string | null;
  onLogin: () => void;
  onLogout: () => void;
  onWithdrawn: () => void;
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

function Header({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack?: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="mypage-header">
      {onBack ? (
        <button
          className="mypage-icon-button"
          type="button"
          onClick={onBack}
          aria-label="마이페이지로 돌아가기"
        >
          ‹
        </button>
      ) : (
        <a href="/" aria-label="홈으로">
          ‹
        </a>
      )}
      <h1>{title}</h1>
      <div className="mypage-header-action">{children}</div>
    </header>
  );
}

function ProfilePage({
  profile,
  token,
  reload,
  back,
}: {
  profile: UserProfile;
  token: string;
  reload: () => void;
  back: () => void;
}) {
  const [nickname, setNickname] = useState(profile.nickname);
  const [birthYear, setBirthYear] = useState(profile.birth_year?.toString() ?? '');
  const [gender, setGender] = useState(profile.gender ?? '');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nickname.trim() || saving) return;
    setSaving(true);
    setNotice('');
    try {
      await updateMyProfile(token, {
        nickname: nickname.trim(),
        ...(birthYear ? { birth_year: Number(birthYear) } : {}),
        ...(gender ? { gender } : {}),
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
      <Header title="프로필 수정" onBack={back} />
      <section className="mypage-card">
        <h2>프로필 정보</h2>
        <form className="mypage-form" onSubmit={submit}>
          <label>
            닉네임
            <input
              value={nickname}
              maxLength={12}
              onChange={(event) => setNickname(event.target.value)}
            />
          </label>
          <label>
            출생 연도
            <input
              value={birthYear}
              inputMode="numeric"
              maxLength={4}
              onChange={(event) => setBirthYear(event.target.value.replace(/\D/g, ''))}
            />
          </label>
          <label>
            성별
            <select value={gender} onChange={(event) => setGender(event.target.value)}>
              <option value="">변경하지 않음</option>
              <option value="MALE">남성</option>
              <option value="FEMALE">여성</option>
            </select>
          </label>
          {notice && (
            <p className="mypage-notice" role="status">
              {notice}
            </p>
          )}
          <ActionButton
            type="submit"
            variant="brandSolid"
            size="medium"
            loading={saving}
            disabled={!nickname.trim()}
          >
            저장
          </ActionButton>
        </form>
      </section>
    </>
  );
}

function SettingsPage({
  token,
  settings,
  reload,
  back,
}: {
  token: string;
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
      await updateMySettings(token, next);
      reload();
    } catch (error) {
      setValue(previous);
      setNotice(message(error, '설정을 저장하지 못했어요.'));
    }
  }
  return (
    <>
      <Header title="설정" onBack={back} />
      <section className="mypage-card">
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

function PasswordPage({ token, back }: { token: string; back: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !next || !confirmation || saving) return;
    setNotice('');
    if (next !== confirmation) {
      setNotice('새 비밀번호가 일치하지 않아요.');
      return;
    }
    setSaving(true);
    try {
      await changeMyPassword(token, current, next);
      setNotice('비밀번호를 변경했어요.');
    } catch (error) {
      setNotice(message(error, '비밀번호를 변경하지 못했어요.'));
    } finally {
      setCurrent('');
      setNext('');
      setConfirmation('');
      setSaving(false);
    }
  }
  return (
    <>
      <Header title="비밀번호 재설정" onBack={back} />
      <section className="mypage-card">
        <h2>비밀번호 변경</h2>
        <form className="mypage-form" onSubmit={submit}>
          <label>
            현재 비밀번호
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </label>
          <label>
            새 비밀번호
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </label>
          <label>
            새 비밀번호 확인
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {notice && (
            <p className="mypage-notice" role="alert">
              {notice}
            </p>
          )}
          <ActionButton
            type="submit"
            variant="brandSolid"
            size="medium"
            loading={saving}
            disabled={!current || !next || !confirmation}
          >
            변경
          </ActionButton>
        </form>
      </section>
    </>
  );
}

function TermsPage({ back }: { back: () => void }) {
  const [terms, setTerms] = useState<CurrentTerm[]>([]);
  const [selected, setSelected] = useState<TermDetail | null>(null);
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
      <section className="mypage-card">
        <h2>약관 및 정책</h2>
        {error && (
          <p className="mypage-notice" role="alert">
            {error}{' '}
            <button className="mypage-inline-button" type="button" onClick={() => void load()}>
              다시 시도
            </button>
          </p>
        )}
        {terms.map((term) => (
          <button
            className="mypage-navigation-row"
            type="button"
            key={term.terms_id}
            onClick={() => void open(term)}
          >
            <span>{term.title}</span>
            <span aria-hidden="true">›</span>
          </button>
        ))}
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
              <p className="text-body3-reading-regular">{selected?.content}</p>
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

function RecommendationPage({ token, back }: { token: string; back: () => void }) {
  const [songs, setSongs] = useState<RecommendedSong[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [lastPage, setLastPage] = useState({ start: 0, length: 0 });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isLoadingRef = useRef(false);
  const loadedSongCountRef = useRef(0);

  const load = useCallback(
    async (nextCursor?: string | null) => {
      if (isLoadingRef.current) return;
      isLoadingRef.current = true;
      setIsLoading(true);
      setError('');
      try {
        const page = await getRecommendationHistoryPage(token, nextCursor);
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
    },
    [token],
  );

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
        className="mypage-card mypage-recommendations"
        aria-labelledby="recommendations-title"
      >
        <h2 id="recommendations-title">추천 받은 곡</h2>
        {songs.map((song, index) => (
          <article
            className="mypage-recommendation-item"
            key={`${song.music_id}-${song.date}-${index}`}
          >
            <div>
              <strong>{song.title}</strong>
              <span>{song.artist_name}</span>
              <small>{song.date}</small>
            </div>
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
  token,
  open,
  setOpen,
  onWithdrawn,
}: {
  token: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  onWithdrawn: () => void;
}) {
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  function change(opened: boolean) {
    if (!opened) {
      setPassword('');
      setNotice('');
    }
    setOpen(opened);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setNotice('');
    try {
      await withdrawMyAccount(token, password);
      setPassword('');
      onWithdrawn();
    } catch (error) {
      setNotice(message(error, '회원 탈퇴를 처리하지 못했어요.'));
    } finally {
      setPassword('');
      setSubmitting(false);
    }
  }
  return (
    <ResponsiveDialog.Root open={open} onOpenChange={change}>
      <ResponsiveDialog.Backdrop />
      <ResponsiveDialog.Positioner>
        <ResponsiveDialog.Content>
          <ResponsiveDialog.Header>
            <ResponsiveDialog.Title>정말 탈퇴할까요?</ResponsiveDialog.Title>
            <ResponsiveDialog.Description>
              본인 확인을 위해 현재 비밀번호를 입력해 주세요.
            </ResponsiveDialog.Description>
            <ResponsiveDialog.CloseButton aria-label="회원 탈퇴 닫기">
              닫기
            </ResponsiveDialog.CloseButton>
          </ResponsiveDialog.Header>
          <ResponsiveDialog.Body>
            <form className="mypage-form" onSubmit={submit}>
              <label>
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
              <ResponsiveDialog.Footer>
                <ResponsiveDialog.Action onClick={() => change(false)}>
                  취소
                </ResponsiveDialog.Action>
                <ActionButton
                  type="submit"
                  variant="brandSolid"
                  size="medium"
                  loading={submitting}
                  disabled={!password}
                >
                  탈퇴
                </ActionButton>
              </ResponsiveDialog.Footer>
            </form>
          </ResponsiveDialog.Body>
        </ResponsiveDialog.Content>
      </ResponsiveDialog.Positioner>
    </ResponsiveDialog.Root>
  );
}

export function MyPage({ accessToken, onLogin, onLogout, onWithdrawn }: MyPageProps) {
  const [view, setView] = useState<View>('overview');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<UserSettings>(INITIAL_SETTINGS);
  const [savedSongCount, setSavedSongCount] = useState<number | null>(null);
  const [savedSongError, setSavedSongError] = useState('');
  const [error, setError] = useState('');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const version = useRef(0);
  const reload = useCallback(async () => {
    if (!accessToken) return;
    const current = ++version.current;
    setProfile(null);
    setSavedSongCount(null);
    setError('');
    setSavedSongError('');
    try {
      const [nextProfile, nextSettings] = await Promise.all([
        getMyProfile(accessToken),
        getMySettings(accessToken),
      ]);
      if (current !== version.current) return;
      setProfile(nextProfile);
      setSettings(nextSettings);
    } catch (caught) {
      if (current === version.current)
        setError(message(caught, '마이페이지 정보를 불러오지 못했어요.'));
      return;
    }
    try {
      const records = await getAllMusicRecords();
      if (current === version.current) setSavedSongCount(records.length);
    } catch {
      if (current === version.current) setSavedSongError('저장한 곡 수를 불러오지 못했어요.');
    }
  }, [accessToken]);
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
  if (!accessToken)
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
        token={accessToken}
        reload={() => void reload()}
        back={() => setView('overview')}
      />
    );
  else if (view === 'settings')
    content = (
      <SettingsPage
        token={accessToken}
        settings={settings}
        reload={() => void reload()}
        back={() => setView('overview')}
      />
    );
  else if (view === 'password')
    content = <PasswordPage token={accessToken} back={() => setView('overview')} />;
  else if (view === 'terms') content = <TermsPage back={() => setView('overview')} />;
  else if (view === 'recommendations')
    content = <RecommendationPage token={accessToken} back={() => setView('overview')} />;
  else
    content = (
      <>
        <Header title="마이페이지">
          <Menu.Root>
            <Menu.Trigger className="mypage-icon-button" aria-label="더보기">
              ⋮
            </Menu.Trigger>
            <Menu.Positioner>
              <Menu.Content>
                <Menu.Item onClick={() => setView('profile')}>프로필 수정</Menu.Item>
                <Menu.Item onClick={() => setWithdrawOpen(true)}>회원 탈퇴</Menu.Item>
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
                    👤
                  </span>
                )}
              </div>
              <div>
                <strong>{profile.nickname}</strong>
                <span>{profile.email}</span>
                <small>{joinedDate} 가입</small>
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
                <span aria-hidden="true">›</span>
              </button>
              <button
                className="mypage-navigation-row"
                type="button"
                onClick={() => setView('password')}
              >
                <span>비밀번호 재설정</span>
                <span aria-hidden="true">›</span>
              </button>
              <button
                className="mypage-navigation-row"
                type="button"
                onClick={() => setView('settings')}
              >
                <span>설정</span>
                <span aria-hidden="true">›</span>
              </button>
              <button
                className="mypage-navigation-row"
                type="button"
                onClick={() => setView('terms')}
              >
                <span>약관 및 정책</span>
                <span aria-hidden="true">›</span>
              </button>
            </nav>
            <button className="mypage-logout-button" type="button" onClick={() => void onLogout()}>
              로그아웃
            </button>
          </>
        )}
      </>
    );
  return (
    <main className="mypage-screen">
      {content}
      <WithdrawalDialog
        token={accessToken}
        open={withdrawOpen}
        setOpen={setWithdrawOpen}
        onWithdrawn={onWithdrawn}
      />
    </main>
  );
}
