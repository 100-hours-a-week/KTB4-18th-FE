/* eslint-disable react-refresh/only-export-components -- Isolated browser verification entry. */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatRoomScreen } from '../../src/features/chat-entry/components/ChatEntryPage';
import { setAccessToken } from '../../src/features/auth-login/api/authSession';
import {
  musicSession,
  musicEvent,
  musicToken,
} from '../../src/features/chat-entry/music/chatMusicTestHelpers';
import {
  parseMusicEvent,
  type ChatMusicEvent,
} from '../../src/features/chat-entry/music/chatMusicTypes';
import '../../src/index.css';
import '../../src/App.css';

declare global {
  interface Window {
    musicFixture: {
      hint: (version: number) => void;
      connection: (ready: boolean) => void;
      sent: string[];
    };
  }
}
setAccessToken(musicToken());
const originalSession = musicSession();
const sent: string[] = [];
function Fixture() {
  const [event, setEvent] = useState<ChatMusicEvent>();
  const [session, setSession] = useState(originalSession);
  const [isReady, setReady] = useState(true);
  useEffect(() => {
    window.musicFixture = {
      hint: (version) => setEvent(parseMusicEvent(musicEvent(version))!),
      connection: (ready) => {
        setSession((s) => ({ ...s, generation: s.generation + 1 }));
        setReady(ready);
      },
      sent,
    };
  }, []);
  return (
    <ChatRoomScreen
      chat={{
        status: isReady ? 'ready' : 'reconnecting',
        message: isReady ? '입장했어요.' : '연결을 확인하고 있어요.',
        isReady,
        currentUserId: 7,
        connectedCount: 4,
        presenceStatus: 'live',
        musicSession: session,
        musicEvent: event,
        activeRoom: {
          room: {
            roomId: 700,
            regionId: 25,
            regionName: '성남시 분당구',
            capacity: 1000,
            status: 'ACTIVE',
          },
          membership: {
            membershipId: 900,
            roomId: 700,
            regionId: 25,
            viewSessionId: session.viewSessionId,
            joinedAt: '2026-11-09T05:00:00Z',
          },
        },
        messages: [
          {
            messageId: 1,
            clientMessageId: 'fixture-1',
            roomId: 700,
            userId: 8,
            nickname: '이웃',
            content: '오늘 함께 듣고 싶은 노래가 있나요?',
            createdAt: '2026-11-09T05:00:00Z',
          },
        ],
        retry: () => {},
        retryRecovery: () => {},
        send: (content) => {
          sent.push(content);
          return true;
        },
        retryMessage: () => false,
      }}
    />
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
