import { useEffect, useRef, useState } from 'react';

import type { ChatRoomMembership, ChatRoomSummary } from '../../../api/chatRooms';
import { useChatParticipation } from '../hooks/useChatParticipation';
import { Gnb } from '../../mainMap/MainPage';
import { navigate, navigateBack } from '../../../shared/navigation';

export interface ActiveChatRoom {
  room: ChatRoomSummary;
  membership: ChatRoomMembership;
}

export function ChatEntryPage() {
  const chat = useChatParticipation();
  const [draft, setDraft] = useState('');
  const [inputNotice, setInputNotice] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const [previousMembership, setPreviousMembership] = useState<number | undefined>(undefined);
  const membershipId = chat.activeRoom?.membership.membershipId;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [chat.messages?.length, chat.pendingMessages?.length]);
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
  // Reset the draft during render when the membership changes, before another room can send it.
  if (previousMembership !== membershipId) {
    setPreviousMembership(membershipId);
    if (draft) setDraft('');
    if (inputNotice) setInputNotice('');
  }
  const regionName = chat.activeRoom?.room.regionName;
  const canRetry = ['error', 'full', 'left'].includes(chat.status);

  return (
    <main className="chat-entry-screen">
      <header className="chat-entry-header">
        <button
          type="button"
          className="chat-header-back chat-entry-back"
          aria-label="뒤로가기"
          onClick={navigateBack}
        >
          <img src="/icons/chatbot/Arrow-reft.svg" alt="" aria-hidden="true" />
        </button>
      </header>
      <section className="chat-entry-card" aria-labelledby="chat-entry-title">
        <span className="chat-entry-icon" aria-hidden="true">
          💬
        </span>
        <h1 id="chat-entry-title" className="text-title1-bold">
          {regionName ? `${regionName} 채팅방` : '우리 지역 채팅방'}
        </h1>
        <p className="chat-entry-description text-body1-normal-regular" role="status">
          {chat.message}
        </p>
        <p className="text-body2-normal-regular">정원 25명</p>
        {canRetry && (
          <button type="button" className="btn-primary" onClick={chat.retry}>
            다시 입장
          </button>
        )}
        {chat.isReady && (
          <button type="button" className="btn-primary" onClick={() => navigate('/')}>
            퇴장
          </button>
        )}
      </section>
      <section className="region-chat-panel" aria-label="실시간 지역 채팅">
        <div
          className="region-chat-messages"
          role="log"
          aria-label="채팅 메시지"
          aria-live="polite"
        >
          {(chat.messages ?? []).map((message) => (
            <article className="region-chat-message" key={message.messageId}>
              <strong>{message.nickname}</strong>
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleTimeString('ko-KR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
              <p>{message.content}</p>
            </article>
          ))}
          {(chat.pendingMessages ?? []).map((message) => (
            <article
              className="region-chat-message region-chat-pending"
              key={message.clientMessageId}
            >
              <strong>나</strong>
              <p>{message.content}</p>
              <span>{message.status === 'sending' ? '전송 중' : message.notice}</span>
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
          <div ref={end} />
        </div>
        <form
          className="region-chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label htmlFor="region-chat-input">메시지</label>
          <textarea
            id="region-chat-input"
            value={draft}
            disabled={!chat.isReady}
            placeholder="메시지를 입력해 주세요"
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
          <span id="region-chat-count" aria-live="off">
            {length}/300자
          </span>
          <button
            type="submit"
            className="btn-primary"
            disabled={!chat.isReady || !text || length > 300}
          >
            전송
          </button>
          <p id="region-chat-notice" role="alert">
            {inputNotice || chat.sendNotice || ''}
          </p>
        </form>
      </section>
      <Gnb
        currentDestination="chatRooms"
        isHidden={false}
        onNavigate={(destination) => {
          const paths = {
            map: '/',
            records: '/music-records',
            recordCreate: '/music-records/new',
            chatRooms: '/chat',
            my: '/my',
          };
          if (destination === 'chatRooms') {
            if (canRetry) chat.retry();
          } else navigate(paths[destination]);
        }}
      />
    </main>
  );
}
