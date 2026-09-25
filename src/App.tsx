import { ActionButton } from '@seed-design/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { recommend } from './api/recommendations';
import { RecommendationCards } from './components/RecommendationCards';
import { LoginPage } from './features/auth-login/components/LoginPage';
import { logout, LogoutRequestError } from './features/auth-login/api/logoutApi';
import {
  ChatEntryPage,
  type ActiveChatRoom,
} from './features/chat-entry/components/ChatEntryPage';
import { SignupPage } from './features/user-signup/components/SignupPage';
import { useVoiceInput } from './hooks/useVoiceInput';
import type { LoginSuccessResponse } from './features/auth-login/api/loginApi';
import type { RecommendationInputType } from './api/recommendations';
import type { Recommendation } from './types/recommendation';

import './App.css';

const LOGIN_PATH = '/login';
const SIGNUP_PATH = '/signup';
const CHATBOT_PATH = '/chatbot';
const CHAT_PATH = '/chat';

type ChatMessage = { id: string; sentAt: Date } & (
  | { role: 'user'; text: string }
  | { role: 'assistant'; result: Recommendation }
);

const formatTime = (date: Date) =>
  date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });

function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [activeChatRoom, setActiveChatRoom] = useState<ActiveChatRoom | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');

  useEffect(() => {
    const updatePathname = () => setPathname(window.location.pathname);

    window.addEventListener('popstate', updatePathname);
    return () => window.removeEventListener('popstate', updatePathname);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState(null, '', path);
    setPathname(path);
  };

  const handleLoginSuccess = (response: LoginSuccessResponse) => {
    setAccessToken(response.data.access_token);
    setIsAuthenticated(true);
    setLogoutError('');
    navigate('/');
  };

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    setLogoutError('');
    try {
      await logout();
      setAccessToken(null);
      setActiveChatRoom(null);
      setIsAuthenticated(false);
      navigate(LOGIN_PATH);
    } catch (error) {
      setLogoutError(
        error instanceof LogoutRequestError && error.status === null
          ? '네트워크 상태를 확인한 뒤 다시 시도해 주세요.'
          : '로그아웃에 실패했어요. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (pathname === LOGIN_PATH) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  if (pathname === SIGNUP_PATH) {
    return <SignupPage onSignupSuccess={() => navigate(LOGIN_PATH)} />;
  }

  if (pathname === CHATBOT_PATH) {
    return <ChatbotPage />;
  }

  if (pathname === CHAT_PATH) {
    return (
      <ChatEntryPage
        accessToken={accessToken}
        activeChatRoom={activeChatRoom}
        onEntered={setActiveChatRoom}
        onMembershipEnded={() => setActiveChatRoom(null)}
        onLogin={() => navigate(LOGIN_PATH)}
      />
    );
  }

  return (
    <MapHomePage
      isAuthenticated={isAuthenticated}
      isLoggingOut={isLoggingOut}
      logoutError={logoutError}
      onLogin={() => navigate(LOGIN_PATH)}
      onLogout={handleLogout}
      onChat={() => navigate(isAuthenticated ? CHAT_PATH : LOGIN_PATH)}
    />
  );
}

type MapHomePageProps = {
  isAuthenticated: boolean;
  isLoggingOut: boolean;
  logoutError: string;
  onLogin: () => void;
  onLogout: () => void;
  onChat: () => void;
};

function MapHomePage({
  isAuthenticated,
  isLoggingOut,
  logoutError,
  onLogin,
  onLogout,
  onChat,
}: MapHomePageProps) {
  return (
    <main className="map-home">
      <h1 className="sr-only">음악 지도</h1>
      <header className="map-home-header">
        <ActionButton
          className="map-auth-button"
          type="button"
          variant="brandSolid"
          size="medium"
          loading={isLoggingOut}
          onClick={isAuthenticated ? onLogout : onLogin}
        >
          {isAuthenticated ? '로그아웃' : '로그인'}
        </ActionButton>
      </header>
      {logoutError && (
        <p className="map-auth-error text-body2-normal-regular" role="alert">
          {logoutError}
        </p>
      )}
      <a className="chatbot-floating-button text-body2-normal-semibold" href={CHATBOT_PATH}>
        <span className="chatbot-floating-icon" aria-hidden="true">
          ♫
        </span>
        챗봇
      </a>
      <nav className="map-navigation" aria-label="주요 메뉴">
        <button className="map-navigation-item" type="button" aria-current="page">
          지도
        </button>
        <button className="map-navigation-item" type="button" onClick={onChat}>
          채팅
        </button>
      </nav>
    </main>
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
        { id: crypto.randomUUID(), role: 'assistant', result, sentAt: new Date() },
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
              <span className="recording-dot" aria-hidden="true" />녹음 중 {voice.elapsedSeconds}초 / 60초
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
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
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
