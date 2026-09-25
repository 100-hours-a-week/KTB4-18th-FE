import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { recommend } from './api/recommendations';
import { RecommendationCards } from './components/RecommendationCards';
import { LoginPage } from './features/auth-login/components/LoginPage';
import { MainPage } from './features/mainMap/MainPage';
import {
  MusicRecordCreatePage,
  MusicRecordListPage,
} from './features/music-record/components/MusicRecordPages';
import { MusicRecordDetailPage } from './features/music-record/components/MusicRecordDetailPage';
import { logout, LogoutRequestError } from './features/auth-login/api/logoutApi';
import {
  AUTH_EXPIRED_EVENT,
  AuthRequestError,
  clearAccessToken,
  getAccessToken,
  refreshAccessToken,
  type AuthStatus,
} from './features/auth-login/api/authSession';
import { ChatEntryPage, type ActiveChatRoom } from './features/chat-entry/components/ChatEntryPage';
import { SignupPage } from './features/user-signup/components/SignupPage';
import { useVoiceInput } from './hooks/useVoiceInput';
import type { RecommendationInputType } from './api/recommendations';
import type { Recommendation } from './types/recommendation';
import { navigate, ROUTE_CHANGE_EVENT } from './shared/navigation';

import './App.css';

const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';
const CHATBOT_PATH = '/chatbot';
const MUSIC_RECORDS_PATH = '/music-records';
const MUSIC_RECORD_CREATE_PATH = '/music-records/new';
const CHAT_PATH = '/chat';

type ChatMessage = { id: string; sentAt: Date } & (
  { role: 'user'; text: string } | { role: 'assistant'; result: Recommendation }
);

const formatTime = (date: Date) =>
  date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });

function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('restoring');
  const authIntent = useRef(0);
  const isLoggingOutRef = useRef(false);
  const [activeChatRoom, setActiveChatRoom] = useState<ActiveChatRoom | null>(null);
  const [logoutError, setLogoutError] = useState('');

  useEffect(() => {
    const updatePathname = () => setPathname(window.location.pathname);

    window.addEventListener('popstate', updatePathname);
    window.addEventListener(ROUTE_CHANGE_EVENT, updatePathname);
    return () => {
      window.removeEventListener('popstate', updatePathname);
      window.removeEventListener(ROUTE_CHANGE_EVENT, updatePathname);
    };
  }, []);

  const restore = useCallback(async () => {
    const currentIntent = authIntent.current;
    setAuthStatus('restoring');
    try {
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
      setActiveChatRoom(null);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const handleLoginSuccess = () => {
    authIntent.current += 1;
    setAuthStatus('authenticated');
    setLogoutError('');
    navigate('/');
  };

  const handleLogout = async () => {
    if (isLoggingOutRef.current) {
      return;
    }

    isLoggingOutRef.current = true;
    authIntent.current += 1;
    setAuthStatus('logging-out');
    setLogoutError('');
    try {
      await logout();
      clearAccessToken();
      setAuthStatus('guest');
      setActiveChatRoom(null);
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

  if (pathname === LOGIN_PATH) {
    return (
      <LoginPage
        onLoginSuccess={handleLoginSuccess}
        onLoginStart={() => {
          authIntent.current += 1;
          setAuthStatus('logging-in');
        }}
        onLoginFailure={() => setAuthStatus(getAccessToken() ? 'authenticated' : 'guest')}
      />
    );
  }

  if (pathname === SIGNUP_PATH) {
    return <SignupPage onSignupSuccess={() => navigate(LOGIN_PATH)} />;
  }
  if (pathname === CHATBOT_PATH) {
    return <ChatbotPage />;
  }
  if (pathname === MUSIC_RECORD_CREATE_PATH) return <MusicRecordCreatePage />;
  if (pathname === MUSIC_RECORDS_PATH) return <MusicRecordListPage />;
  const detailMatch = /^\/music-records\/([1-9]\d*)$/.exec(pathname);
  if (detailMatch) return <MusicRecordDetailPage recordId={Number(detailMatch[1])} />;

  if (pathname === CHAT_PATH) {
    if (authStatus === 'restoring') return <main role="status">로그인 확인 중</main>;
    return (
      <ChatEntryPage
        accessToken={getAccessToken()}
        activeChatRoom={activeChatRoom}
        onEntered={setActiveChatRoom}
        onMembershipEnded={() => setActiveChatRoom(null)}
        onLogin={() => navigate(LOGIN_PATH)}
      />
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
      onChat={() => navigate(authStatus === 'authenticated' ? CHAT_PATH : LOGIN_PATH)}
    />
  );
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

    try {
      const result = await recommend(text, conversationKey, controller.signal, inputType);
      setMessages((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          result,
          sentAt: new Date(),
        },
      ]);
      setInputType('TEXT');
      voice.finishReview();
    } catch (caught) {
      if (!controller.signal.aborted) {
        setMessages((previous) => previous.filter((message) => message.id !== messageId));
        setError(caught instanceof Error ? caught.message : '서버에 연결하지 못했습니다.');
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
    <main className="chat-app">
      <header className="chat-header">
        <h1>음악 추천 챗봇</h1>
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
          <div className="welcome-bubble">
            <p>지금의 순간에 음악을 더해볼까요?</p>
            <p>느껴지는 분위기나 장소, 날씨를 편하게 들려주세요.</p>
            <p>이 순간에 어울리는 음악을 골라드릴게요.</p>
            <p className="sample-notice">
              현재는 입력 문장으로 iTunes에서 음악을 검색합니다. 입력 문장은 연속 추천을 위해
              대화별로 저장합니다.
            </p>
          </div>
          <time>{formatTime(openedAt)}</time>
        </div>
        {messages.map((message) => (
          <div
            key={message.id}
            className={`message-row ${message.role === 'user' ? 'user-row' : 'assistant-row'}`}
          >
            {message.role === 'user' ? (
              <p className="user-bubble">{message.text}</p>
            ) : (
              <RecommendationCards
                recommendation={message.result}
                activePreview={activePreview}
                onPreviewChange={setActivePreview}
              />
            )}
            <time dateTime={message.sentAt.toISOString()}>{formatTime(message.sentAt)}</time>
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
            {voice.isRecording ? '■' : '🎙'}
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
            ↑
          </button>
        </form>
      </div>
    </main>
  );
}

export default App;
