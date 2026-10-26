import { lazy, useCallback, useEffect, useRef, useState } from 'react';

import { RouteLoadBoundary } from './components/RouteLoadBoundary';
import { resetLoginQueueAfterLogout } from './features/auth-login/api/loginQueueApi';
import { MainPage } from './features/mainMap/MainPage';
import {
  logout,
  LogoutFinalizationError,
  LogoutRequestError,
} from './features/auth-login/api/logoutApi';
import {
  ACCESS_TOKEN_CHANGED_EVENT,
  ACCESS_TOKEN_REFRESH_EARLY_MS,
  AUTH_EXPIRED_EVENT,
  AUTH_SESSION_AVAILABLE_EVENT,
  AuthRequestError,
  clearAccessToken,
  getAuthRestoreState,
  getAccessToken,
  getAccessTokenExpiresAt,
  getLastAccessTokenRefreshAt,
  refreshAccessToken,
  shouldRefreshAccessToken,
  type AuthStatus,
} from './features/auth-login/api/authSession';
import {
  beginLogoutCleanupGate,
  isLogoutCleanupPending,
  LOGOUT_CLEANUP_STATE_CHANGED_EVENT,
} from './features/auth-login/api/logoutCleanupGate';
import { abortActiveCreate } from './features/auth-login/api/loginQueueCoordination';
import {
  getAuthCapabilityMessage,
  probeAuthCapabilities,
} from './features/auth-login/api/authCapabilities';
import {
  installSpaLinkHandler,
  navigate,
  readRouteLocation,
  replaceRoute,
  ROUTE_CHANGE_EVENT,
} from './shared/navigation';

import './App.css';

const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';
const CHATBOT_PATH = '/chatbot';
const MUSIC_RECORDS_PATH = '/music-records';
const MUSIC_RECORD_CREATE_PATH = '/music-records/new';
const CHAT_PATH = '/chat';
const MY_PATH = '/my';
const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;
const AUTH_RESTORE_UNAVAILABLE_MESSAGE =
  '저장된 로그인 상태를 확인할 수 없어요. 확인 후 다시 시도해 주세요.';

const LoginPage = lazy(() =>
  import('./features/auth-login/components/LoginPage').then(({ LoginPage }) => ({
    default: LoginPage,
  })),
);
const SignupPage = lazy(() =>
  import('./features/user-signup/components/SignupPage').then(({ SignupPage }) => ({
    default: SignupPage,
  })),
);
const ChatEntryPage = lazy(() =>
  import('./features/chat-entry/components/ChatEntryPage').then(({ ChatEntryPage }) => ({
    default: ChatEntryPage,
  })),
);
const MyPage = lazy(() =>
  import('./features/mypage/components/MyPage').then(({ MyPage }) => ({ default: MyPage })),
);
const MusicRecordListPage = lazy(() =>
  import('./features/music-record/components/MusicRecordPages').then(({ MusicRecordListPage }) => ({
    default: MusicRecordListPage,
  })),
);
const MusicRecordCreatePage = lazy(() =>
  import('./features/music-record/components/MusicRecordPages').then(
    ({ MusicRecordCreatePage }) => ({ default: MusicRecordCreatePage }),
  ),
);
const MusicRecordDetailPage = lazy(() =>
  import('./features/music-record/components/MusicRecordDetailPage').then(
    ({ MusicRecordDetailPage }) => ({ default: MusicRecordDetailPage }),
  ),
);
const ChatbotPage = lazy(() => import('./features/chatbot/components/ChatbotPage'));

function App() {
  const [routeLocation, setRouteLocation] = useState(() => readRouteLocation());
  const pathname = routeLocation.pathname;
  const [initialAuthRestoreState] = useState(() => getAuthRestoreState());
  const [authStatus, setAuthStatus] = useState<AuthStatus>('restoring');
  const [authCapability] = useState(() => probeAuthCapabilities());
  const [passwordChangedNotice, setPasswordChangedNotice] = useState(false);
  const [skipQueueRestoreAfterLogout, setSkipQueueRestoreAfterLogout] = useState(
    () => initialAuthRestoreState !== 'ready',
  );
  const [logoutCleanupPending, setLogoutCleanupPending] = useState(
    () => initialAuthRestoreState === 'cleanup-pending',
  );
  const [isLogoutCleanupRetrying, setIsLogoutCleanupRetrying] = useState(false);
  const logoutCleanupRetryRef = useRef(false);
  const [logoutCleanupError, setLogoutCleanupError] = useState('');
  const [authRestoreBlocked, setAuthRestoreBlocked] = useState(
    () => initialAuthRestoreState === 'unavailable',
  );
  const [authRestoreError, setAuthRestoreError] = useState(() =>
    initialAuthRestoreState === 'unavailable' ? AUTH_RESTORE_UNAVAILABLE_MESSAGE : '',
  );
  const [loginFormVersion, setLoginFormVersion] = useState(0);
  const authIntent = useRef(0);
  const [authIntentVersion, setAuthIntentVersion] = useState(0);
  const isLoggingOutRef = useRef(false);
  const [, setLogoutError] = useState('');
  const [isManualLogoutPending, setIsManualLogoutPending] = useState(false);
  const [manualLogoutError, setManualLogoutError] = useState('');
  const advanceAuthIntent = () => {
    authIntent.current += 1;
    setAuthIntentVersion(authIntent.current);
  };
  const isProtectedRoute =
    pathname === CHATBOT_PATH ||
    pathname === CHAT_PATH ||
    pathname === MY_PATH ||
    pathname === MUSIC_RECORDS_PATH ||
    pathname === MUSIC_RECORD_CREATE_PATH ||
    /^\/music-records\/([1-9]\d*)$/.test(pathname);

  useEffect(() => {
    const updateLocation = () => setRouteLocation(readRouteLocation());
    const removeSpaLinkHandler = installSpaLinkHandler();

    window.addEventListener('popstate', updateLocation);
    window.addEventListener(ROUTE_CHANGE_EVENT, updateLocation);
    return () => {
      removeSpaLinkHandler();
      window.removeEventListener('popstate', updateLocation);
      window.removeEventListener(ROUTE_CHANGE_EVENT, updateLocation);
    };
  }, []);

  useEffect(() => {
    const onLogoutCleanupStateChanged = (event: Event) => {
      const pending = Boolean((event as CustomEvent<{ pending?: boolean }>).detail?.pending);
      setLogoutCleanupPending(pending);
      setLoginFormVersion((version) => version + 1);
      if (pending) {
        advanceAuthIntent();
        setSkipQueueRestoreAfterLogout(true);
        setLogoutCleanupError('');
        abortActiveCreate();
        clearAccessToken();
        setAuthStatus('guest');
      } else {
        setLogoutCleanupError('');
      }
    };
    window.addEventListener(LOGOUT_CLEANUP_STATE_CHANGED_EVENT, onLogoutCleanupStateChanged);
    return () =>
      window.removeEventListener(LOGOUT_CLEANUP_STATE_CHANGED_EVENT, onLogoutCleanupStateChanged);
  }, []);

  const restore = useCallback(async () => {
    const currentIntent = authIntent.current;
    if (!authCapability.supported) {
      setAuthStatus('retryable-error');
      return;
    }
    const restoreState = getAuthRestoreState();
    if (restoreState === 'cleanup-pending') {
      setLogoutCleanupPending(true);
      setSkipQueueRestoreAfterLogout(true);
      clearAccessToken();
      setAuthStatus('guest');
      return;
    }
    if (restoreState === 'signed-out') {
      setAuthRestoreBlocked(false);
      setSkipQueueRestoreAfterLogout(true);
      clearAccessToken();
      setAuthStatus('guest');
      return;
    }
    if (restoreState === 'unavailable') {
      setAuthRestoreBlocked(true);
      setAuthRestoreError(AUTH_RESTORE_UNAVAILABLE_MESSAGE);
      setAuthStatus('retryable-error');
      return;
    }
    setAuthRestoreBlocked(false);
    setAuthRestoreError('');
    setAuthStatus('restoring');
    try {
      if (getAccessToken() && !shouldRefreshAccessToken()) {
        if (currentIntent === authIntent.current) setAuthStatus('authenticated');
        return;
      }
      await refreshAccessToken();
      if (currentIntent === authIntent.current) setAuthStatus('authenticated');
    } catch (caught) {
      if (currentIntent !== authIntent.current) return;
      if (getAuthRestoreState() === 'unavailable') {
        setAuthRestoreBlocked(true);
        setAuthRestoreError(AUTH_RESTORE_UNAVAILABLE_MESSAGE);
        setAuthStatus('retryable-error');
        return;
      }
      if (caught instanceof AuthRequestError && caught.status === 401) {
        setAuthStatus('guest');
      } else {
        setAuthStatus('retryable-error');
      }
    }
  }, [authCapability]);

  useEffect(() => {
    if (!authCapability.supported) return;
    queueMicrotask(() => void restore());
  }, [authCapability, restore]);

  useEffect(() => {
    const onPeerSessionAvailable = () => {
      advanceAuthIntent();
      void restore();
    };
    window.addEventListener(AUTH_SESSION_AVAILABLE_EVENT, onPeerSessionAvailable);
    return () => window.removeEventListener(AUTH_SESSION_AVAILABLE_EVENT, onPeerSessionAvailable);
  }, [restore]);

  useEffect(() => {
    const onExpired = () => {
      advanceAuthIntent();
      setAuthStatus((current) =>
        current === 'logging-in' || current === 'logging-out' ? current : 'guest',
      );
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    if (pathname === LOGIN_PATH && authStatus === 'authenticated') {
      replaceRoute(getSafeReturnTo(routeLocation.search));
    }
  }, [pathname, routeLocation.search, authStatus]);

  useEffect(() => {
    if (!isProtectedRoute || authStatus !== 'guest') return;
    if (
      authIntentVersion !== authIntent.current ||
      window.location.pathname !== routeLocation.pathname ||
      window.location.search !== routeLocation.search ||
      window.location.hash !== routeLocation.hash
    ) {
      return;
    }
    replaceRoute(loginHref(routeLocation));
  }, [authIntentVersion, authStatus, isProtectedRoute, routeLocation]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let timer: number | undefined;
    let refreshing = false;
    let terminalRefreshFailure = false;
    let nextAllowedRefreshAt = 0;
    const retryDelayMs = 60_000;

    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (!getAccessToken() || terminalRefreshFailure) {
        timer = undefined;
        return;
      }
      const expiresAt = getAccessTokenExpiresAt();
      const refreshDelay =
        expiresAt === null
          ? 0
          : Math.max(0, expiresAt - Date.now() - ACCESS_TOKEN_REFRESH_EARLY_MS);
      const cooldownDelay = Math.max(0, nextAllowedRefreshAt - Date.now());
      timer = window.setTimeout(
        () => {
          timer = undefined;
          void refreshIfDue();
        },
        Math.min(Math.max(refreshDelay, cooldownDelay), MAX_TIMEOUT_DELAY_MS),
      );
    };

    const refreshIfDue = async () => {
      if (refreshing || terminalRefreshFailure || !getAccessToken()) return;
      if (document.visibilityState === 'hidden') return;
      const cooldownDelay = nextAllowedRefreshAt - Date.now();
      if (cooldownDelay > 0) {
        schedule();
        return;
      }
      if (!shouldRefreshAccessToken()) {
        schedule();
        return;
      }

      refreshing = true;
      try {
        await refreshAccessToken();
      } catch (caught) {
        if (caught instanceof AuthRequestError && caught.status === 401) {
          clearAccessToken();
          setAuthStatus('guest');
        } else if (
          caught instanceof AuthRequestError &&
          (caught.status === null ||
            caught.status === 408 ||
            caught.status === 429 ||
            caught.status >= 500)
        ) {
          nextAllowedRefreshAt = Date.now() + retryDelayMs;
        } else {
          terminalRefreshFailure = true;
        }
      } finally {
        refreshing = false;
        if (getAccessToken() && !terminalRefreshFailure) schedule();
      }
    };

    const onAccessTokenChanged = () => {
      if (!getAccessToken()) {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        return;
      }
      terminalRefreshFailure = false;
      const expiresAt = getAccessTokenExpiresAt();
      if (expiresAt !== null && expiresAt - Date.now() > ACCESS_TOKEN_REFRESH_EARLY_MS) {
        nextAllowedRefreshAt = 0;
        terminalRefreshFailure = false;
      } else {
        const lastRefreshAt = getLastAccessTokenRefreshAt();
        if (lastRefreshAt > 0) {
          nextAllowedRefreshAt = Math.max(nextAllowedRefreshAt, lastRefreshAt + retryDelayMs);
        }
      }
      schedule();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshIfDue();
    };

    const initialExpiresAt = getAccessTokenExpiresAt();
    const initialRefreshAt = getLastAccessTokenRefreshAt();
    if (
      initialRefreshAt > 0 &&
      (initialExpiresAt === null || initialExpiresAt - Date.now() <= ACCESS_TOKEN_REFRESH_EARLY_MS)
    ) {
      nextAllowedRefreshAt = initialRefreshAt + retryDelayMs;
    }

    window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, onAccessTokenChanged);
    window.addEventListener('focus', onVisibility);
    window.addEventListener('pageshow', onVisibility);
    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, onAccessTokenChanged);
      window.removeEventListener('focus', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [authStatus]);

  const handleLoginSuccess = () => {
    advanceAuthIntent();
    setAuthStatus('authenticated');
    setLogoutError('');
    setManualLogoutError('');
    setAuthRestoreBlocked(false);
    setAuthRestoreError('');
    navigate(getSafeReturnTo(window.location.search));
  };

  const handleLogout = async () => {
    if (isLoggingOutRef.current) {
      return;
    }

    isLoggingOutRef.current = true;
    advanceAuthIntent();
    setIsManualLogoutPending(true);
    setAuthStatus('logging-out');
    setLogoutError('');
    setManualLogoutError('');
    setLogoutCleanupError('');
    let serverLogoutSucceeded = false;
    try {
      await logout(() => {
        serverLogoutSucceeded = true;
        beginLogoutCleanupGate();
        abortActiveCreate();
        setLogoutCleanupPending(true);
        setLoginFormVersion((version) => version + 1);
      });
      serverLogoutSucceeded = true;
      await resetLoginQueueAfterLogout();
      setLogoutCleanupPending(false);
      setSkipQueueRestoreAfterLogout(true);
      clearAccessToken();
      setAuthStatus('guest');
      navigate(LOGIN_PATH);
    } catch (error) {
      if (
        serverLogoutSucceeded ||
        error instanceof LogoutFinalizationError ||
        isLogoutCleanupPending()
      ) {
        setLogoutCleanupPending(true);
        setLogoutCleanupError(
          '로그아웃은 완료됐지만 로그인 준비를 끝내지 못했어요. 다시 시도해 주세요.',
        );
        setSkipQueueRestoreAfterLogout(true);
        clearAccessToken();
        setAuthStatus('guest');
        navigate(LOGIN_PATH);
        return;
      }
      setAuthStatus(getAccessToken() ? 'authenticated' : 'retryable-error');
      const message =
        error instanceof LogoutRequestError && error.status === null
          ? '네트워크 상태를 확인한 뒤 다시 시도해 주세요.'
          : '로그아웃에 실패했어요. 잠시 후 다시 시도해 주세요.';
      setLogoutError(message);
      setManualLogoutError(message);
    } finally {
      isLoggingOutRef.current = false;
      setIsManualLogoutPending(false);
    }
  };

  const handleWithdrawalComplete = async () => {
    advanceAuthIntent();
    setManualLogoutError('');
    setAuthStatus('logging-out');
    setLogoutError('');
    let serverLogoutSucceeded = false;
    try {
      await logout(() => {
        serverLogoutSucceeded = true;
        beginLogoutCleanupGate();
        abortActiveCreate();
        setLogoutCleanupPending(true);
        setLoginFormVersion((version) => version + 1);
      });
      serverLogoutSucceeded = true;
      await resetLoginQueueAfterLogout();
      setLogoutCleanupPending(false);
      setSkipQueueRestoreAfterLogout(true);
      clearAccessToken();
      setAuthStatus('guest');
      navigate(LOGIN_PATH);
    } catch (error) {
      if (
        serverLogoutSucceeded ||
        error instanceof LogoutFinalizationError ||
        isLogoutCleanupPending()
      ) {
        setLogoutCleanupPending(true);
        setLogoutCleanupError(
          '로그아웃은 완료됐지만 로그인 준비를 끝내지 못했어요. 다시 시도해 주세요.',
        );
        setSkipQueueRestoreAfterLogout(true);
        clearAccessToken();
        setAuthStatus('guest');
        navigate(LOGIN_PATH);
        return;
      }
      setAuthStatus('retryable-error');
      setLogoutError(
        error instanceof LogoutRequestError && error.status === null
          ? '네트워크 상태를 확인한 뒤 다시 시도해 주세요.'
          : '회원 탈퇴 후 세션 폐기에 실패했어요. 다시 로그인하거나 로그아웃을 재시도해 주세요.',
      );
    }
  };

  const retryLogoutCleanup = async () => {
    if (logoutCleanupRetryRef.current) return;
    logoutCleanupRetryRef.current = true;
    setIsLogoutCleanupRetrying(true);
    setLogoutCleanupError('');
    try {
      await resetLoginQueueAfterLogout();
      setLogoutCleanupPending(false);
      setSkipQueueRestoreAfterLogout(true);
      clearAccessToken();
      setAuthStatus('guest');
      navigate(LOGIN_PATH);
    } catch {
      setLogoutCleanupPending(true);
      setLogoutCleanupError(
        '로그인 준비를 완료하지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.',
      );
    } finally {
      logoutCleanupRetryRef.current = false;
      setIsLogoutCleanupRetrying(false);
    }
  };

  if (
    pathname === LOGIN_PATH &&
    authCapability.supported &&
    (authStatus === 'restoring' || authStatus === 'authenticated')
  ) {
    return (
      <main role="status" aria-live="polite">
        로그인 상태를 확인하고 있어요.
      </main>
    );
  }

  if (pathname === LOGIN_PATH) {
    return (
      <RouteLoadBoundary key={pathname}>
        <LoginPage
          key={loginFormVersion}
          skipInitialQueueRestore={skipQueueRestoreAfterLogout || logoutCleanupPending}
          authCapabilityMessage={
            authCapability.supported ? undefined : getAuthCapabilityMessage(authCapability.reason)
          }
          authRestoreError={authRestoreBlocked ? authRestoreError : undefined}
          onRetryAuthRestore={() => void restore()}
          logoutCleanupPending={logoutCleanupPending}
          logoutCleanupError={logoutCleanupError}
          logoutCleanupRetrying={isLogoutCleanupRetrying}
          onRetryLogoutCleanup={() => void retryLogoutCleanup()}
          passwordChangedNotice={passwordChangedNotice}
          onPasswordChangedNoticeDismiss={() => setPasswordChangedNotice(false)}
          onLoginSuccess={handleLoginSuccess}
          onLoginStart={() => {
            setSkipQueueRestoreAfterLogout(false);
            advanceAuthIntent();
            setAuthStatus('logging-in');
          }}
          onLoginFailure={() => setAuthStatus(getAccessToken() ? 'authenticated' : 'guest')}
        />
      </RouteLoadBoundary>
    );
  }

  if (pathname === SIGNUP_PATH) {
    return (
      <RouteLoadBoundary key={pathname}>
        <SignupPage onSignupSuccess={() => navigate(LOGIN_PATH)} />
      </RouteLoadBoundary>
    );
  }
  if (isProtectedRoute && authStatus === 'restoring') {
    return (
      <main role="status" aria-live="polite">
        로그인 상태를 확인하고 있어요.
      </main>
    );
  }
  if (isProtectedRoute && authStatus === 'retryable-error' && !getAccessToken()) {
    return (
      <main className="auth-status-page" role="alert">
        <p>
          {authCapability.supported
            ? '인증 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'
            : getAuthCapabilityMessage(authCapability.reason)}
        </p>
        {manualLogoutError && <p>{manualLogoutError}</p>}
        <button
          type="button"
          onClick={() => {
            setManualLogoutError('');
            void restore();
          }}
        >
          다시 시도
        </button>
        <a href={loginHref(routeLocation)}>로그인</a>
        <a href="/">음악 지도로 돌아가기</a>
      </main>
    );
  }
  if (isProtectedRoute && authStatus === 'guest') {
    return (
      <main role="status" aria-live="polite">
        로그인 페이지로 이동하고 있어요.
      </main>
    );
  }
  if (
    isProtectedRoute &&
    (authStatus === 'logging-in' || authStatus === 'logging-out') &&
    !(pathname === MY_PATH && isManualLogoutPending)
  ) {
    return (
      <main role="status" aria-live="polite">
        인증 상태를 갱신하고 있어요.
      </main>
    );
  }

  if (pathname === CHATBOT_PATH) {
    return (
      <RouteLoadBoundary key={pathname}>
        <ChatbotPage />
      </RouteLoadBoundary>
    );
  }
  if (pathname === MUSIC_RECORD_CREATE_PATH) {
    return (
      <RouteLoadBoundary key={pathname}>
        <MusicRecordCreatePage />
      </RouteLoadBoundary>
    );
  }
  if (pathname === MUSIC_RECORDS_PATH) {
    return (
      <RouteLoadBoundary key={pathname}>
        <MusicRecordListPage />
      </RouteLoadBoundary>
    );
  }
  const detailMatch = /^\/music-records\/([1-9]\d*)$/.exec(pathname);
  if (detailMatch) {
    return (
      <RouteLoadBoundary key={pathname}>
        <MusicRecordDetailPage recordId={Number(detailMatch[1])} />
      </RouteLoadBoundary>
    );
  }
  if (pathname === CHAT_PATH) {
    return (
      <RouteLoadBoundary key={pathname}>
        <ChatEntryPage />
      </RouteLoadBoundary>
    );
  }
  if (pathname === MY_PATH) {
    return (
      <RouteLoadBoundary key={pathname}>
        <MyPage
          onLogin={() => navigate(LOGIN_PATH)}
          onBack={() => navigate('/')}
          onLogout={handleLogout}
          isLogoutPending={isManualLogoutPending}
          logoutError={manualLogoutError}
          onWithdrawn={handleWithdrawalComplete}
          onPasswordChanged={() => {
            advanceAuthIntent();
            clearAccessToken();
            setAuthStatus('guest');
            setPasswordChangedNotice(true);
            navigate(LOGIN_PATH);
          }}
        />
      </RouteLoadBoundary>
    );
  }
  if (pathname !== '/') {
    return (
      <main>
        <h1>페이지를 찾을 수 없습니다</h1>
        <a href="/">홈으로</a>
      </main>
    );
  }

  return <MainPage onChat={() => navigate(CHAT_PATH)} />;
}

function getSafeReturnTo(search: string): string {
  const candidate = new URLSearchParams(search).get('returnTo');
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  try {
    const url = new URL(candidate, window.location.origin);
    if (
      url.origin !== window.location.origin ||
      url.pathname === LOGIN_PATH ||
      url.pathname === SIGNUP_PATH
    )
      return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

function loginHref(location: { pathname: string; search: string; hash: string }): string {
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  return `${LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`;
}

export default App;
