/* eslint-disable react-refresh/only-export-components -- Standalone verification entry mounts its own test UI. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Client } from '@stomp/stompjs';
import { ChatEntryPage } from '../../src/features/chat-entry/components/ChatEntryPage';
import {
  getAccessToken,
  setAccessToken,
  clearAccessToken,
} from '../../src/features/auth-login/api/authSession';
import { joinChatRoom } from '../../src/api/chatRooms';
import { resolveLocation } from '../../src/api/locationResolutions';
import {
  openChatConversation,
  storeChatConversation,
  chatAccountId,
  CHAT_CACHE_KEY,
} from '../../src/features/chat-entry/services/chatConversationCache';
import '../../src/index.css';
import '../../src/App.css';

const config = await fetch('./chatRecovery.local.json').then((response) => {
  if (!response.ok) throw Error('Run BE chatProcessTest with CHAT_BROWSER_FE_DIR first');
  return response.json();
});
if (!getAccessToken()) setAccessToken(config.token);
Object.defineProperty(navigator, 'geolocation', {
  configurable: true,
  value: {
    getCurrentPosition(success: PositionCallback) {
      queueMicrotask(() =>
        success({
          coords: { latitude: 37.3595704, longitude: 127.105399, accuracy: 10 },
          timestamp: Date.now(),
        } as GeolocationPosition),
      );
    },
  },
});
const NativeSocket = window.WebSocket;
let offline = false;
const sockets: WebSocket[] = [];
class TestSocket extends NativeSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(offline ? 'ws://127.0.0.1:1/ws' : url, protocols);
    sockets.push(this);
  }
}
window.WebSocket = TestSocket;
const nativeFetch = window.fetch.bind(window);
let hold = false;
let release: (() => void) | undefined;
window.fetch = async (...args: Parameters<typeof fetch>) => {
  const response = await nativeFetch(...args);
  if (hold && String(args[0]).includes('/messages?')) {
    hold = false;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  }
  return response;
};
let actor: Client | undefined;
let serial = 0;
async function actorMessage() {
  if (!actor?.connected) {
    const location = await resolveLocation(
      { latitude: 37.3595704, longitude: 127.105399, accuracyMeters: 10 },
      new AbortController().signal,
    );
    const membership = await joinChatRoom(
      config.room,
      location.locationResolutionToken,
      new AbortController().signal,
    );
    actor = new Client({
      webSocketFactory: () => new NativeSocket(config.url.replace(/^http/, 'ws') + '/ws'),
      reconnectDelay: 0,
      connectHeaders: {
        Authorization: `Bearer ${getAccessToken()}`,
        room_id: String(config.room),
        membership_id: String(membership.membershipId),
      },
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('actor readiness timed out')), 10000);
      actor!.onConnect = () => {
        const receipt = crypto.randomUUID();
        actor!.watchForReceipt(receipt, () => {
          clearTimeout(timer);
          resolve();
        });
        actor!.subscribe(`/topic/chat-rooms/${config.room}`, () => undefined, { receipt });
      };
      actor!.activate();
    });
  }
  actor.publish({
    destination: `/app/chat-rooms/${config.room}/messages`,
    body: JSON.stringify({
      client_message_id: crypto.randomUUID(),
      content: `합성 다른 연결 메시지 ${++serial} (${Date.now()})`,
    }),
  });
}
async function startLongDisconnect(notify: (value: string) => void) {
  await actorMessage();
  offline = true;
  sockets.at(-1)?.close();
  notify('31초 단절 중: 다른 연결로 부재 메시지를 보내세요.');
  setTimeout(() => {
    void actorMessage().finally(() => {
      setTimeout(() => {
        offline = false;
        notify('부재 중 자동 전송 후 재연결: 누락 메시지 제외와 안내를 확인하세요.');
      }, 1500);
    });
  }, 31000);
}
function Harness() {
  const [show, setShow] = useState(true);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState('실제 서버·합성 계정·합성 위치·제어된 네트워크 단절');
  const run = (action: () => void | Promise<void>) => () => {
    Promise.resolve()
      .then(action)
      .catch(() => setNotice('검증 동작 실패: 서버 로그와 상태를 확인하세요.'));
  };
  return (
    <>
      <aside
        aria-label="검증 제어"
        style={{
          position: 'fixed',
          zIndex: 1000,
          top: 0,
          right: 0,
          maxWidth: 310,
          background: '#fff',
          color: '#111',
          border: '1px solid #444',
          padding: 8,
          fontSize: 12,
        }}
      >
        <details>
          <summary>검증 제어 펼치기</summary>
          <p role="status">{notice}</p>
          <button onClick={run(actorMessage)}>다른 연결 메시지</button>{' '}
          <button
            onClick={() => {
              sockets.at(-1)?.close();
            }}
          >
            짧은 단절
          </button>{' '}
          <button onClick={run(() => startLongDisconnect(setNotice))}>31초 단절</button>{' '}
          <button
            onClick={() => {
              hold = true;
              sockets.at(-1)?.close();
            }}
          >
            복구 응답 보류
          </button>{' '}
          <button
            onClick={() => {
              release?.();
              release = undefined;
            }}
          >
            복구 응답 해제
          </button>{' '}
          <button
            onClick={() => {
              setShow((value) => !value);
            }}
          >
            앱 내 이동/재입장
          </button>{' '}
          <button
            onClick={() => {
              clearAccessToken();
              setNotice('로그아웃: 캐시와 연결을 확인하세요.');
            }}
          >
            로그아웃
          </button>{' '}
          <button
            onClick={() => {
              setAccessToken(config.otherToken);
              setVersion((value) => value + 1);
            }}
          >
            계정 전환
          </button>{' '}
          <button
            onClick={() => {
              const account = chatAccountId(getAccessToken())!;
              const { context } = openChatConversation(account, config.region, config.room);
              storeChatConversation(
                context,
                config.region,
                config.room,
                Array.from({ length: 206 }, (_, index) => ({
                  messageId: 100000 + index,
                  clientMessageId: 'fixture-' + index,
                  roomId: config.room,
                  userId: account,
                  nickname: '합성 캐시',
                  content: `합성 이전 대화 ${index}`,
                  createdAt: new Date(
                    Date.now() - (index === 205 ? 24 * 60 * 60 * 1000 : 0),
                  ).toISOString(),
                })),
              );
              setShow(false);
              setNotice(
                '유효 캐시205개·24시간 만료1개 저장: 재입장 후200개와 만료 제외를 확인하세요.',
              );
            }}
          >
            200개 캐시 경계
          </button>{' '}
          <button
            onClick={() => {
              sessionStorage.setItem(CHAT_CACHE_KEY, '{broken');
              location.reload();
            }}
          >
            손상 캐시 새로고침
          </button>{' '}
          <button
            onClick={() => {
              const original = Storage.prototype.setItem;
              Storage.prototype.setItem = function (key, value) {
                if (key === CHAT_CACHE_KEY) throw Error('synthetic quota');
                original.call(this, key, value);
              };
              setNotice('캐시 용량 오류 적용: 현재 채팅 전송을 확인하세요.');
            }}
          >
            캐시 용량 오류
          </button>{' '}
          <a href="./chatRecovery.html" target="_blank" rel="opener">
            두 번째 탭
          </a>
        </details>
      </aside>
      {show ? (
        <ChatEntryPage key={version} />
      ) : (
        <p style={{ marginTop: 280 }}>채팅에서 이동했습니다. 재입장 버튼으로 복원합니다.</p>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
