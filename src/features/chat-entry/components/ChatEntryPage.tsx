import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ChatRoomMembership, ChatRoomSummary } from '../../../api/chatRooms';
import { useChatParticipation } from '../hooks/useChatParticipation';
import { navigate, navigateBack } from '../../../shared/navigation';
import './ChatEntryPage.css';

export interface ActiveChatRoom {
  room: ChatRoomSummary;
  membership: ChatRoomMembership;
}

export function ChatEntryPage() {
  const chat = useChatParticipation();
  return <ChatRoomScreen chat={chat} />;
}

export function ChatRoomScreen({ chat }: { chat: ReturnType<typeof useChatParticipation> }) {
  const [draft, setDraft] = useState('');
  const [inputNotice, setInputNotice] = useState('');
  const screen = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const isFollowing = useRef(true);
  const [previousMembership, setPreviousMembership] = useState<number | undefined>(undefined);
  const membershipId = chat.activeRoom?.membership.membershipId;
  const resizeInput = useCallback(() => {
    const element = input.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const maximum = Number.parseFloat(style.maxHeight) || 140;
    const border =
      (Number.parseFloat(style.borderTopWidth) || 0) +
      (Number.parseFloat(style.borderBottomWidth) || 0);
    element.style.height = '44px';
    const height = element.value.trim() ? element.scrollHeight + border : 44;
    element.style.height = `${Math.max(44, Math.min(maximum, height))}px`;
    if (list.current && isFollowing.current) list.current.scrollTop = list.current.scrollHeight;
  }, []);
  useLayoutEffect(() => {
    resizeInput();
  }, [draft, membershipId, resizeInput]);
  useEffect(() => {
    isFollowing.current = true;
  }, [membershipId]);
  useEffect(() => {
    const element = list.current;
    if (element && isFollowing.current) element.scrollTop = element.scrollHeight;
  }, [chat.messages?.length, chat.pendingMessages?.length, membershipId]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const updateViewport = () => {
      if (!screen.current) return;
      const height = `${viewport?.height ?? window.innerHeight}px`;
      screen.current.style.height = height;
      screen.current.style.top = `${viewport?.offsetTop ?? 0}px`;
      screen.current.style.setProperty('--chat-entry-viewport-height', height);
      resizeInput();
    };
    updateViewport();
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    let width = input.current?.clientWidth;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            if (input.current?.clientWidth !== width) {
              width = input.current?.clientWidth;
              resizeInput();
            }
          });
    if (input.current) observer?.observe(input.current);
    let isActive = true;
    void document.fonts?.ready.then(() => {
      if (isActive) resizeInput();
    });
    return () => {
      isActive = false;
      observer?.disconnect();
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, [resizeInput]);
  const text = draft.trim();
  const length = Array.from(text).length;
  const submit = () => {
    if (!text || length > 300) {
      setInputNotice(!text ? '메시지를 입력해 주세요.' : '메시지는 300자까지 보낼 수 있어요.');
      return;
    }
    if (chat.send(draft)) {
      setDraft('');
      setInputNotice('');
    }
  };
  if (previousMembership !== membershipId) {
    setPreviousMembership(membershipId);
    if (draft) setDraft('');
    if (inputNotice) setInputNotice('');
  }
  const regionName = chat.activeRoom?.room.regionName;
  const capacity = chat.activeRoom?.room.capacity;
  const isLiveCount =
    chat.presenceStatus === 'live' &&
    chat.connectedCount !== null &&
    chat.connectedCount !== undefined;
  const canRetry = ['error', 'full', 'left'].includes(chat.status);
  const isNormal = chat.status === 'ready' && chat.isReady;
  const isPresenceError = ['disconnected', 'error'].includes(chat.presenceStatus ?? '');
  const messages = chat.messages ?? [];
  const displayedMessages = messages.map((message, index) => {
    const previous = messages[index - 1];
    const date = new Date(message.createdAt);
    const hasDate =
      !previous || new Date(previous.createdAt).toDateString() !== date.toDateString();
    const boundaries: string[] = [];
    if (chat.restoredThroughMessageId !== undefined) {
      if (index === 0 && message.messageId <= chat.restoredThroughMessageId)
        boundaries.push('이전에 봤던 대화');
      if (
        message.messageId > chat.restoredThroughMessageId &&
        (!previous || previous.messageId <= chat.restoredThroughMessageId)
      )
        boundaries.push('다시 입장한 이후 대화');
    }
    for (const gap of chat.gaps ?? []) {
      if (
        gap.beforeMessageId < message.messageId &&
        (!previous || previous.messageId <= gap.beforeMessageId)
      )
        boundaries.push(
          gap.reason === 'ABSENCE'
            ? '연결이 끊겨 일부 대화가 표시되지 않아요'
            : '보관 기간이 지난 메시지는 표시되지 않아요',
        );
    }
    const isContinuation =
      !hasDate &&
      boundaries.length === 0 &&
      previous?.userId === message.userId &&
      Math.floor(Date.parse(previous.createdAt) / 60000) === Math.floor(date.getTime() / 60000);
    return { message, date, hasDate, boundaries, isContinuation };
  });

  return (
    <main ref={screen} className="chat-entry-screen">
      <div className="chat-entry-shell">
        <header className="chat-entry-header">
          <button
            type="button"
            className="chat-entry-back"
            aria-label="뒤로가기"
            onClick={navigateBack}
          >
            <img src="/icons/chat/back.svg" alt="" aria-hidden="true" width="24" height="24" />
          </button>
          <h1 id="chat-entry-title">{regionName ? `${regionName} 채팅방` : '우리 지역 채팅방'}</h1>
          <div className="chat-entry-capacity" aria-hidden="true">
            <span>{isLiveCount ? chat.connectedCount : '-'}</span>
            <span>/{capacity ?? '-'}</span>
          </div>
        </header>
        <div className="region-chat-status">
          <p role="status" className={isNormal ? 'chat-entry-visually-hidden' : undefined}>
            {chat.message}
          </p>
          <p
            className={`region-chat-count${isPresenceError ? '' : ' chat-entry-visually-hidden'}`}
            aria-label="현재 접속 인원"
          >
            {isLiveCount
              ? `${chat.connectedCount} / ${capacity ?? '-'}명`
              : chat.presenceStatus === 'disconnected'
                ? '연결 끊김'
                : chat.presenceStatus === 'error'
                  ? '인원 확인 실패'
                  : '인원 확인 중'}
          </p>
          {capacity !== null && capacity !== undefined && (
            <span className="chat-entry-visually-hidden">정원 {capacity}명</span>
          )}
          {canRetry && (
            <button type="button" onClick={chat.retry}>
              다시 입장
            </button>
          )}
          {chat.status === 'recovery-failed' && (
            <button type="button" onClick={chat.retryRecovery}>
              복구 다시 시도
            </button>
          )}
          {chat.isReady && (
            <button type="button" className="chat-entry-exit" onClick={() => navigate('/')}>
              퇴장
            </button>
          )}
        </div>
        <section className="region-chat-panel" aria-label="실시간 지역 채팅">
          <div
            ref={list}
            className="region-chat-messages"
            onScroll={(event) => {
              const element = event.currentTarget;
              isFollowing.current =
                element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
            }}
            tabIndex={0}
            role="log"
            aria-label="채팅 메시지"
            aria-live="polite"
          >
            {displayedMessages.map(
              ({ message, date, hasDate, boundaries, isContinuation }, index) => (
                <Fragment key={message.messageId}>
                  {hasDate && (
                    <p className="region-chat-date">
                      {date.toLocaleDateString('ko-KR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        weekday: 'long',
                      })}
                    </p>
                  )}
                  {boundaries.map((boundary, boundaryIndex) => (
                    <p className="region-chat-gap" role="status" key={boundaryIndex}>
                      {boundary}
                    </p>
                  ))}
                  <article
                    className={`region-chat-message${message.userId === chat.currentUserId ? ' region-chat-own' : ''}${isContinuation ? ' region-chat-continuation' : ''}`}
                  >
                    <strong className="chat-entry-visually-hidden">
                      {message.userId === chat.currentUserId ? '나' : message.nickname}
                    </strong>
                    <p className="region-chat-bubble">{message.content}</p>
                    <time
                      dateTime={message.createdAt}
                      className={
                        displayedMessages[index + 1]?.isContinuation
                          ? 'chat-entry-visually-hidden'
                          : 'region-chat-time'
                      }
                    >
                      {date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}
                    </time>
                    {message.userId === chat.currentUserId && (
                      <span className="region-chat-delivery chat-entry-visually-hidden">
                        전송 완료
                      </span>
                    )}
                  </article>
                </Fragment>
              ),
            )}
            {(chat.gaps ?? [])
              .filter((gap) => gap.beforeMessageId >= (messages.at(-1)?.messageId ?? 0))
              .map((gap) => (
                <p
                  className="region-chat-gap"
                  role="status"
                  key={`${gap.reason}:${gap.beforeMessageId}:${gap.resumedAt}`}
                >
                  {gap.reason === 'ABSENCE'
                    ? '연결이 끊겨 일부 대화가 표시되지 않아요'
                    : '보관 기간이 지난 메시지는 표시되지 않아요'}
                </p>
              ))}
            {(chat.pendingMessages ?? [])
              .filter(
                (pending) =>
                  !messages.some(
                    (message) =>
                      message.userId === chat.currentUserId &&
                      message.clientMessageId === pending.clientMessageId,
                  ),
              )
              .map((message) => (
                <article
                  className="region-chat-message region-chat-pending region-chat-own"
                  key={message.clientMessageId}
                >
                  <strong className="chat-entry-visually-hidden">나</strong>
                  <p className="region-chat-bubble">{message.content}</p>
                  <span
                    className={
                      message.status === 'sending'
                        ? 'chat-entry-visually-hidden'
                        : 'region-chat-pending-notice'
                    }
                  >
                    {message.status === 'sending' ? '전송 중' : message.notice}
                  </span>
                  {message.status === 'uncertain' && (
                    <button
                      type="button"
                      disabled={!chat.isReady}
                      onClick={() => chat.retryMessage(message.clientMessageId)}
                    >
                      재전송
                    </button>
                  )}
                </article>
              ))}
          </div>
          <form
            className="region-chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label htmlFor="region-chat-input" className="chat-entry-visually-hidden">
              메시지
            </label>
            <span id="region-chat-count" className="chat-entry-visually-hidden" aria-live="off">
              {length}/300자
            </span>
            <p id="region-chat-notice" role="alert">
              {inputNotice || chat.sendNotice || ''}
            </p>
            <div className="region-chat-composer-row">
              <textarea
                ref={input}
                id="region-chat-input"
                rows={1}
                value={draft}
                disabled={!chat.isReady}
                placeholder="메시지를 입력하세요..."
                aria-describedby="region-chat-count region-chat-notice"
                onChange={(event) => {
                  setDraft(event.target.value);
                  setInputNotice('');
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229
                  ) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <button
                type="submit"
                className="region-chat-send"
                aria-label="전송"
                disabled={!chat.isReady || !text || length > 300}
              >
                <img src="/icons/chat/send.svg" alt="" aria-hidden="true" width="20" height="20" />
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
