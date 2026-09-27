import { useEffect } from 'react';

import type { ChatRoomMembership, ChatRoomSummary } from '../../../api/chatRooms';
import { useChatLocation } from '../../../hooks/useChatLocation';

export interface ActiveChatRoom {
  room: ChatRoomSummary;
  membership: ChatRoomMembership;
}

interface ChatEntryPageProps {
  accessToken: string | null;
}

export function ChatEntryPage({ accessToken }: ChatEntryPageProps) {
  const location = useChatLocation({ accessToken });
  const { requestLocation, resolution } = location;

  useEffect(() => {
    void requestLocation();
  }, [requestLocation]);

  const regionName = resolution?.region.sigungu.name;
  const preparationMessage = regionName
    ? `${regionName} 채팅 기능을 준비하고 있어요.`
    : '채팅 기능을 준비하고 있어요.';

  return (
    <main className="chat-entry-screen">
      <section className="chat-entry-card" aria-labelledby="chat-entry-title">
        <span className="chat-entry-icon" aria-hidden="true">
          💬
        </span>
        <h1 id="chat-entry-title" className="text-title1-bold">
          우리 지역 채팅방
        </h1>
        <p className="chat-entry-description text-body1-normal-regular" role="status">
          {preparationMessage}
        </p>
      </section>
    </main>
  );
}
