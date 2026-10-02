import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { recommend, streamRecommendation } from './api/recommendations';
import { RecommendationCards } from './components/RecommendationCards';
import { LoginPage } from './features/auth-login/components/LoginPage';
import { MainPage } from './features/mainMap/MainPage';
import {
  MusicRecordCreatePage,
  MusicRecordListPage,
} from './features/music-record/components/MusicRecordPages';
import { MusicRecordDetailPage } from './features/music-record/components/MusicRecordDetailPage';
import { MyPage } from './features/mypage/components/MyPage';
import { logout, LogoutRequestError } from './features/auth-login/api/logoutApi';
import {
  ACCESS_TOKEN_CHANGED_EVENT,
  ACCESS_TOKEN_REFRESH_EARLY_MS,
  AUTH_EXPIRED_EVENT,
  AuthRequestError,
  clearAccessToken,
  getAccessToken,
  getAccessTokenExpiresAt,
  getLastAccessTokenRefreshAt,
  refreshAccessToken,
  shouldRefreshAccessToken,
  type AuthStatus,
} from './features/auth-login/api/authSession';
import { ChatEntryPage } from './features/chat-entry/components/ChatEntryPage';
import { SignupPage } from './features/user-signup/components/SignupPage';
import { useVoiceInput } from './hooks/useVoiceInput';
import type { RecommendationInputType } from './api/recommendations';
import type { Recommendation } from './types/recommendation';
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

type ChatMessage = { id: string; sentAt: Date } & (
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      text: string;
      result: Recommendation;
      streamStatus: 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
      failureMessage?: string;
    }
);

const formatTime = (date: Date) =>
  date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });

function App() {
  const [routeLocation, setRouteLocation] = useState(() => readRouteLocation());
  const pathname = routeLocation.pathname;
  const [authStatus, setAuthStatus] = useState<AuthStatus>('restoring');
  const authIntent = useRef(0);
  const [authIntentVersion, setAuthIntentVersion] = useState(0);
  const isLoggingOutRef = useRef(false);
  const [logoutError, setLogoutError] = useState('');
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

  const restore = useCallback(async () => {
    const currentIntent = authIntent.current;
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
      if (caught instanceof AuthRequestError && caught.status === 401) {
        setAuthStatus('guest');
      } else {
        setAuthStatus('retryable-error');
      }
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void restore());
  }, [restore]);

  useEffect(() => {
    const onExpired = () => {
      setAuthStatus((current) =>
        current === 'logging-in' || current === 'logging-out' ? current : 'guest',
      );
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

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
    navigate(getSafeReturnTo(window.location.search));
  };

  const handleLogout = async () => {
    if (isLoggingOutRef.current) {
      return;
    }

    isLoggingOutRef.current = true;
    advanceAuthIntent();
    setAuthStatus('logging-out');
    setLogoutError('');
    try {
      await logout();
      clearAccessToken();
      setAuthStatus('guest');
      navigate(LOGIN_PATH);
    } catch (error) {
      setAuthStatus(getAccessToken() ? 'authenticated' : 'retryable-error');
      setLogoutError(
        error instanceof LogoutRequestError && error.status === null
          ? '네트워크 상태를 확인한 뒤 다시 시도해 주세요.'
          : '로그아웃에 실패했어요. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      isLoggingOutRef.current = false;
    }
  };

  const handleWithdrawalComplete = async () => {
    advanceAuthIntent();
    setAuthStatus('logging-out');
    setLogoutError('');
    try {
      await logout();
      clearAccessToken();
      setAuthStatus('guest');
      navigate(LOGIN_PATH);
    } catch (error) {
      setAuthStatus('retryable-error');
      setLogoutError(
        error instanceof LogoutRequestError && error.status === null
          ? '네트워크 상태를 확인한 뒤 다시 시도해 주세요.'
          : '회원 탈퇴 후 세션 폐기에 실패했어요. 다시 로그인하거나 로그아웃을 재시도해 주세요.',
      );
    }
  };

  if (pathname === LOGIN_PATH) {
    return (
      <LoginPage
        onLoginSuccess={handleLoginSuccess}
        onLoginStart={() => {
          advanceAuthIntent();
          setAuthStatus('logging-in');
        }}
        onLoginFailure={() => setAuthStatus(getAccessToken() ? 'authenticated' : 'guest')}
      />
    );
  }

  if (pathname === SIGNUP_PATH) {
    return <SignupPage onSignupSuccess={() => navigate(LOGIN_PATH)} />;
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
      <main role="alert">
        <p>인증 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.</p>
        <button type="button" onClick={() => void restore()}>
          다시 시도
        </button>
        <a href={loginHref(routeLocation)}>로그인</a>
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
  if (isProtectedRoute && (authStatus === 'logging-in' || authStatus === 'logging-out')) {
    return (
      <main role="status" aria-live="polite">
        인증 상태를 갱신하고 있어요.
      </main>
    );
  }

  if (pathname === CHATBOT_PATH) return <ChatbotPage />;
  if (pathname === MUSIC_RECORD_CREATE_PATH) return <MusicRecordCreatePage />;
  if (pathname === MUSIC_RECORDS_PATH) return <MusicRecordListPage />;
  const detailMatch = /^\/music-records\/([1-9]\d*)$/.exec(pathname);
  if (detailMatch) return <MusicRecordDetailPage recordId={Number(detailMatch[1])} />;
  if (pathname === CHAT_PATH) return <ChatEntryPage />;
  if (pathname === MY_PATH) {
    return (
      <MyPage
        onLogin={() => navigate(LOGIN_PATH)}
        onLogout={handleLogout}
        onWithdrawn={handleWithdrawalComplete}
      />
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

  return (
    <MainPage
      isAuthenticated={
        authStatus === 'authenticated' ||
        (authStatus === 'retryable-error' && Boolean(getAccessToken()))
      }
      isLoggingOut={authStatus === 'logging-out'}
      isRestoring={authStatus === 'restoring'}
      isRetryableError={authStatus === 'retryable-error'}
      onRetryAuth={() => void restore()}
      logoutError={logoutError}
      onLogin={() => navigate(LOGIN_PATH)}
      onLogout={handleLogout}
      onChat={() => navigate(CHAT_PATH)}
    />
  );
}

function getSafeReturnTo(search: string): string {
  const candidate = new URLSearchParams(search).get('returnTo');
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  try {
    const url = new URL(candidate, window.location.origin);
    if (url.origin !== window.location.origin) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

function loginHref(location: { pathname: string; search: string; hash: string }): string {
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  return `${LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`;
}

function ChatbotPage() {
  const [conversationKey] = useState(() => crypto.randomUUID());
  const [openedAt] = useState(() => new Date());
  const [prompt, setPrompt] = useState('');
  const [inputType, setInputType] = useState<RecommendationInputType>('TEXT');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatAppRef = useRef<HTMLElement>(null);

  const handleTranscript = useCallback((transcript: string) => {
    setPrompt(transcript);
    setInputType('VOICE');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);
  const voice = useVoiceInput({ onTranscript: handleTranscript });
  const resetVoiceForTextInput = voice.useTextInput;

  const useTextInput = useCallback(() => {
    resetVoiceForTextInput();
    setInputType('TEXT');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [resetVoiceForTextInput]);

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    const chatApp = chatAppRef.current;
    const visualViewport = window.visualViewport;
    if (!chatApp || !visualViewport) return;

    const updateKeyboardInset = () => {
      const appBottom = chatApp.getBoundingClientRect().bottom;
      const visualViewportBottom = visualViewport.offsetTop + visualViewport.height;
      const inset = Math.max(0, appBottom - visualViewportBottom);
      chatApp.style.setProperty('--chat-keyboard-inset', `${inset}px`);
    };

    updateKeyboardInset();
    visualViewport.addEventListener('resize', updateKeyboardInset);
    visualViewport.addEventListener('scroll', updateKeyboardInset);
    return () => {
      visualViewport.removeEventListener('resize', updateKeyboardInset);
      visualViewport.removeEventListener('scroll', updateKeyboardInset);
      chatApp.style.removeProperty('--chat-keyboard-inset');
    };
  }, []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, error]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || requestRef.current) {
      return;
    }
    const controller = new AbortController();
    const messageId = crypto.randomUUID();
    requestRef.current = controller;
    setLoading(true);
    setError('');
    setActivePreview(null);
    setMessages((previous) => [
      ...previous,
      { id: messageId, role: 'user', text, sentAt: new Date() },
    ]);
    setPrompt('');

    let accepted = false;
    let assistantId: string | null = null;
    try {
      const acceptedResult = await recommend(text, conversationKey, controller.signal, inputType);
      accepted = true;
      const currentAssistantId = crypto.randomUUID();
      assistantId = currentAssistantId;
      setMessages((previous) => [
        ...previous,
        {
          id: currentAssistantId,
          role: 'assistant',
          text: '',
          result: {
            recommendation_id: acceptedResult.recommendation_id,
            conversation_key: acceptedResult.conversation_key,
            status: 'PROCESSING',
            items: [],
            completed_at: null,
          },
          streamStatus: 'PROCESSING',
          sentAt: new Date(),
        },
      ]);
      const updateAssistant = (
        update: (
          message: Extract<ChatMessage, { role: 'assistant' }>,
        ) => Extract<ChatMessage, { role: 'assistant' }>,
      ) => {
        setMessages((previous) =>
          previous.map((message) =>
            message.id === currentAssistantId && message.role === 'assistant'
              ? update(message)
              : message,
          ),
        );
      };
      const result = await streamRecommendation(
        acceptedResult.recommendation_id,
        controller.signal,
        {
          onText: (delta) =>
            updateAssistant((message) => ({ ...message, text: message.text + delta })),
          onTracks: (tracks) =>
            updateAssistant((message) => ({
              ...message,
              result: {
                ...message.result,
                items: tracks.map((track, index) => ({
                  rank_no: index + 1,
                  music: {
                    music_id: index + 1,
                    title: track.title,
                    artist_name: track.artist,
                    album_cover_url: track.artwork_url,
                    preview_url: track.preview_url,
                  },
                })),
              },
            })),
        },
      );
      updateAssistant((message) => ({ ...message, result, streamStatus: result.status }));
      setInputType('TEXT');
      voice.finishReview();
    } catch (caught) {
      if (!controller.signal.aborted) {
        const message = caught instanceof Error ? caught.message : '서버에 연결하지 못했습니다.';
        if (accepted && assistantId) {
          setMessages((previous) =>
            previous.map((item) =>
              item.id === assistantId && item.role === 'assistant'
                ? {
                    ...item,
                    streamStatus: 'FAILED',
                    result: { ...item.result, items: [], status: 'FAILED' },
                    failureMessage: message,
                  }
                : item,
            ),
          );
        } else {
          setMessages((previous) => previous.filter((item) => item.id !== messageId));
          setError(message);
        }
        setPrompt(text);
      }
    } finally {
      requestRef.current = null;
      if (!controller.signal.aborted) {
        setLoading(false);
        inputRef.current?.focus();
      }
    }
  }

  return (
    <main className="chat-app" ref={chatAppRef}>
      <header className="chat-header">
        <a className="chat-header-back" href="/" aria-label="도트 지도 메인 페이지로 이동">
          <img src="/icons/chatbot/Arrow-reft.svg" alt="" aria-hidden="true" />
        </a>
        <h1>음악 추천 챗봇</h1>
        <span className="chat-header-spacer" aria-hidden="true" />
      </header>
      <div className="chat-content" role="log" aria-label="음악 추천 대화" aria-live="polite">
        <p className="date-label">
          {openedAt.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
          })}
        </p>
        <div className="message-row assistant-row">
          <div className="message-group assistant-group">
            <div className="welcome-bubble">
              <p>지금의 순간에 음악을 더해볼까요?</p>
              <p>느껴지는 분위기나 장소, 날씨를 편하게 들려주세요.</p>
              <p>이 순간에 어울리는 음악을 골라드릴게요.</p>
            </div>
            <time>{formatTime(openedAt)}</time>
          </div>
        </div>
        {messages.map((message) => (
          <div
            key={message.id}
            className={`message-row ${message.role === 'user' ? 'user-row' : 'assistant-row'}`}
          >
            <div
              className={`message-group ${message.role === 'user' ? 'user-group' : 'assistant-group'}`}
            >
              {message.role === 'user' ? (
                <p className="user-bubble">{message.text}</p>
              ) : (
                <div className="assistant-content">
                  {message.text && <p className="assistant-text-bubble">{message.text}</p>}
                  {message.streamStatus === 'PROCESSING' && (
                    <p className="assistant-text-bubble" role="status">
                      추천 결과를 받고 있어요…
                    </p>
                  )}
                  {message.failureMessage && (
                    <p role="alert" className="assistant-text-bubble error-message">
                      {message.failureMessage}
                    </p>
                  )}
                  {(message.streamStatus === 'COMPLETED' || message.result.items.length > 0) && (
                    <RecommendationCards
                      recommendation={message.result}
                      activePreview={activePreview}
                      onPreviewChange={setActivePreview}
                    />
                  )}
                </div>
              )}
              <time dateTime={message.sentAt.toISOString()}>{formatTime(message.sentAt)}</time>
            </div>
          </div>
        ))}
        {loading && (
          <p className="status-message" role="status">
            음악을 고르고 있어요…
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error} 입력창에서 다시 전송할 수 있습니다.
          </p>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="input-area">
        {voice.isRecording && (
          <div className="voice-status" role="status">
            <span>
              <span className="recording-dot" aria-hidden="true" />
              녹음 중 {voice.elapsedSeconds}초 / 60초
            </span>
            <button type="button" onClick={voice.cancelRecording}>
              취소
            </button>
          </div>
        )}
        {voice.isTranscribing && (
          <p className="voice-status" role="status">
            음성을 텍스트로 변환하고 있어요…
          </p>
        )}
        {voice.status === 'reviewing' && (
          <p className="voice-review-notice" role="status">
            변환된 문장을 확인하고 필요한 부분을 수정한 뒤 전송해 주세요.
          </p>
        )}
        {voice.error && (
          <div className="voice-error" role="alert">
            <p>{voice.error}</p>
            <div className="voice-error-actions">
              {voice.canRetry && (
                <button type="button" onClick={voice.retryTranscription}>
                  전사 다시 시도
                </button>
              )}
              <button type="button" onClick={() => void voice.startRecording()}>
                다시 녹음
              </button>
              <button type="button" onClick={useTextInput}>
                텍스트로 입력
              </button>
            </div>
          </div>
        )}
        <form className="input-bar" onSubmit={submit}>
          <button
            className={`voice-button ${voice.isRecording ? 'recording' : ''}`}
            type="button"
            disabled={loading || voice.isTranscribing}
            aria-label={voice.isRecording ? '음성 녹음 종료' : '음성 녹음 시작'}
            aria-pressed={voice.isRecording}
            onClick={() => {
              if (voice.isRecording) {
                voice.stopRecording();
              } else {
                void voice.startRecording();
              }
            }}
          >
            <img
              src="/icons/chatbot/Microphone.svg"
              alt=""
              aria-hidden="true"
              width="20"
              height="20"
            />
          </button>
          <label className="sr-only" htmlFor="prompt">
            추천받고 싶은 상황
          </label>
          <textarea
            ref={inputRef}
            id="prompt"
            placeholder="메시지를 입력하세요…"
            rows={1}
            maxLength={1000}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={loading || voice.isRecording || voice.isTranscribing}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            className="send-button"
            type="submit"
            disabled={loading || voice.isRecording || voice.isTranscribing || !prompt.trim()}
            aria-label="추천 요청 보내기"
          >
            <img
              src="/icons/chatbot/Arrow-up.svg"
              alt=""
              aria-hidden="true"
              width="20"
              height="20"
            />
          </button>
        </form>
      </div>
    </main>
  );
}

export default App;
