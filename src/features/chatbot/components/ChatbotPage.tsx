import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { recommend, streamRecommendation } from '../../../api/recommendations';
import { RecommendationCards } from '../../../components/RecommendationCards';
import { ChatImageRecommendation } from '../../chat-image-recommendation/components/ChatImageRecommendation';
import { useVoiceInput } from '../../../hooks/useVoiceInput';
import type { RecommendationInputType } from '../../../api/recommendations';
import type { Recommendation } from '../../../types/recommendation';

type ChatMessage = { id: string; sentAt: Date } & (
  | { role: 'user'; text: string }
  | { role: 'user'; imageUrl: string }
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

const MAX_PROMPT_LENGTH = 200;

export default function ChatbotPage() {
  const [conversationKey] = useState(() => crypto.randomUUID());
  const [openedAt] = useState(() => new Date());
  const [prompt, setPrompt] = useState('');
  const isPromptTooLong = prompt.length > MAX_PROMPT_LENGTH;
  const [inputType, setInputType] = useState<RecommendationInputType>('TEXT');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatAppRef = useRef<HTMLElement>(null);
  const ownedImageUrls = useRef(new Set<string>());

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

  useEffect(
    () => () => {
      requestRef.current?.abort();
      ownedImageUrls.current.forEach((url) => URL.revokeObjectURL(url));
      ownedImageUrls.current.clear();
    },
    [],
  );
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
    if (!text || isPromptTooLong || requestRef.current) {
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

  const handleImageUsable = useCallback(
    async (recommendationId: number, imageUrl: string, confirmedAt: Date) => {
      ownedImageUrls.current.add(imageUrl);
      const controller = new AbortController();
      requestRef.current?.abort();
      requestRef.current = controller;
      const imageMessageId = crypto.randomUUID();
      const assistantId = crypto.randomUUID();
      setMessages((previous) => [
        ...previous,
        { id: imageMessageId, role: 'user', imageUrl, sentAt: confirmedAt },
        {
          id: assistantId,
          role: 'assistant',
          text: '',
          result: {
            recommendation_id: recommendationId,
            conversation_key: conversationKey,
            status: 'PROCESSING',
            items: [],
            completed_at: null,
          },
          streamStatus: 'PROCESSING',
          sentAt: new Date(),
        },
      ]);
      setLoading(true);
      setError('');
      try {
        const result = await streamRecommendation(recommendationId, controller.signal, {
          onText: (delta) =>
            setMessages((previous) =>
              previous.map((message) =>
                message.id === assistantId && message.role === 'assistant'
                  ? { ...message, text: message.text + delta }
                  : message,
              ),
            ),
          onTracks: (tracks) =>
            setMessages((previous) =>
              previous.map((message) =>
                message.id === assistantId && message.role === 'assistant'
                  ? {
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
                    }
                  : message,
              ),
            ),
        });
        setMessages((previous) =>
          previous.map((message) =>
            message.id === assistantId && message.role === 'assistant'
              ? { ...message, result, streamStatus: result.status }
              : message,
          ),
        );
        setInputType('TEXT');
      } catch (caught) {
        if (!controller.signal.aborted) {
          const failureMessage =
            caught instanceof Error ? caught.message : '추천 결과를 가져오지 못했습니다.';
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId && message.role === 'assistant'
                ? {
                    ...message,
                    streamStatus: 'FAILED',
                    result: { ...message.result, status: 'FAILED', items: [] },
                    failureMessage,
                  }
                : message,
            ),
          );
        }
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [conversationKey],
  );

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
            className={`message-row ${message.role === 'user' ? 'user-row' : 'assistant-row'} ${message.role === 'user' && 'imageUrl' in message ? 'image-message-row' : ''}`}
          >
            <div
              className={`message-group ${message.role === 'user' ? 'user-group' : 'assistant-group'} ${message.role === 'user' && 'imageUrl' in message ? 'image-message-group' : ''}`}
            >
              {message.role === 'user' ? (
                'imageUrl' in message ? (
                  <img
                    className="chat-image-message"
                    src={message.imageUrl}
                    alt="음악 추천에 사용한 장소 사진"
                  />
                ) : (
                  <p className="user-bubble">{message.text}</p>
                )
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
            {voice.isAutomaticallyStopped
              ? '녹음이 자동 종료되었어요. 음성을 변환하고 있어요.'
              : '음성을 텍스트로 변환하고 있어요…'}
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
        <div className="prompt-feedback sr-only">
          <span id="prompt-count">
            {prompt.length} / {MAX_PROMPT_LENGTH}
          </span>
          <p id="prompt-limit-message" role={isPromptTooLong ? 'alert' : undefined}>
            {isPromptTooLong
              ? '입력이 200자를 초과했습니다. 내용을 200자 이내로 수정한 뒤 보내 주세요.'
              : '최대 200자까지 입력할 수 있습니다.'}
          </p>
        </div>
        <form className="input-bar" onSubmit={submit}>
          <ChatImageRecommendation
            conversationKey={conversationKey}
            disabled={
              loading || voice.isRecording || voice.isTranscribing || voice.status === 'reviewing'
            }
            onUsable={(id, url, confirmedAt) => void handleImageUsable(id, url, confirmedAt)}
          />
          <label className="sr-only" htmlFor="prompt">
            추천받고 싶은 상황
          </label>
          <div className="prompt-field">
            <textarea
              ref={inputRef}
              id="prompt"
              placeholder="메시지를 입력하세요…"
              rows={1}
              maxLength={MAX_PROMPT_LENGTH}
              aria-describedby="prompt-count prompt-limit-message"
              aria-invalid={isPromptTooLong}
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
          </div>
          <button
            className="send-button"
            type="submit"
            disabled={
              loading ||
              voice.isRecording ||
              voice.isTranscribing ||
              isPromptTooLong ||
              !prompt.trim()
            }
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
