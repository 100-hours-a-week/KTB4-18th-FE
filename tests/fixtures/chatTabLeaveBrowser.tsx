/* eslint-disable react-refresh/only-export-components -- Isolated browser verification entry. */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatEntryPage } from '../../src/features/chat-entry/components/ChatEntryPage';
import { getAccessToken, setAccessToken } from '../../src/features/auth-login/api/authSession';
import { navigate, ROUTE_CHANGE_EVENT } from '../../src/shared/navigation';
import type { ChatRoomMembership } from '../../src/api/chatRooms';
import '../../src/index.css';
import '../../src/App.css';

declare global {
  interface Window {
    __chatTabE2E: {
      disconnect(): void;
      resume(): void;
      probe(membership: ChatRoomMembership): Promise<{ historyStatus: number; closeCode: number }>;
    };
  }
}

const actor =
  new URLSearchParams(location.search).get('actor') ??
  sessionStorage.getItem('e2e:actor') ??
  'owner';
sessionStorage.setItem('e2e:actor', actor);
const response = await fetch(`/__chat-e2e/config?actor=${encodeURIComponent(actor)}`);
if (!response.ok) throw Error('Start the isolated E2E runner first');
const config = (await response.json()) as { token: string };
if (!getAccessToken()) setAccessToken(config.token);

const NativeSocket = window.WebSocket;
const sockets = new Set<WebSocket>();
let isOffline = false;
class ControlledSocket extends NativeSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(isOffline ? 'ws://127.0.0.1:1/ws' : url, protocols);
    sockets.add(this);
    this.addEventListener('close', () => sockets.delete(this));
  }
}
window.WebSocket = ControlledSocket;
window.__chatTabE2E = {
  disconnect() {
    isOffline = true;
    sockets.forEach((socket) => socket.close());
  },
  resume() {
    isOffline = false;
  },
  async probe(membership) {
    const token = getAccessToken();
    const history = await fetch(
      `/api/v1/chat-rooms/${membership.roomId}/messages?membership_id=${membership.membershipId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Chat-View-Session': membership.viewSessionId,
        },
      },
    );
    const closeCode = await new Promise<number>((resolve, reject) => {
      const socket = new NativeSocket(`${location.origin.replace(/^http/, 'ws')}/ws`, 'v12.stomp');
      const timer = window.setTimeout(() => {
        socket.close();
        reject(Error('View probe timed out'));
      }, 5000);
      socket.addEventListener('open', () =>
        socket.send(
          `CONNECT\naccept-version:1.2\nAuthorization:Bearer ${token}\nroom_id:${membership.roomId}\nmembership_id:${membership.membershipId}\nview_session_id:${membership.viewSessionId}\n\n\u0000`,
        ),
      );
      socket.addEventListener('message', (event) => {
        if (String(event.data).startsWith('CONNECTED')) {
          clearTimeout(timer);
          socket.close();
          reject(Error('An explicitly departed view reconnected'));
        }
      });
      socket.addEventListener('close', (event) => {
        clearTimeout(timer);
        resolve(event.code);
      });
    });
    return { historyStatus: history.status, closeCode };
  },
};

function Harness() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener(ROUTE_CHANGE_EVENT, update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener(ROUTE_CHANGE_EVENT, update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return (
    <>
      <nav
        aria-label="검증용 화면 이동"
        style={{ position: 'fixed', top: 0, right: 0, zIndex: 1000, background: '#fff' }}
      >
        <button onClick={() => navigate('/')}>지도 탭</button>
        <button onClick={() => navigate('/chat')}>채팅 탭</button>
      </nav>
      {path === '/chat' ? (
        <ChatEntryPage />
      ) : (
        <main>
          <h1>지도 화면</h1>
        </main>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
