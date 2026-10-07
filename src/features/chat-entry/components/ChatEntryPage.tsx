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
