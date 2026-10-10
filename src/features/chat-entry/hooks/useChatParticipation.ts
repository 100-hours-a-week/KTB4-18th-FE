import { useEffect, useRef, useState } from 'react';

import {
  AUTH_EXPIRED_EVENT,
  ACCESS_TOKEN_CHANGED_EVENT,
  getAccessToken,
} from '../../auth-login/api/authSession';
import { ROUTE_CHANGE_EVENT } from '../../../shared/navigation';
import { ChatParticipation, type ChatParticipationState } from '../services/chatParticipation';

const INITIAL_STATE: ChatParticipationState = {
  status: 'locating',
  message: '현재 위치를 확인하고 있어요. 위치 권한을 허용해 주세요.',
  activeRoom: null,
  isReady: false,
};

export function useChatParticipation() {
  const [state, setState] = useState(INITIAL_STATE);
  const current = useRef<ChatParticipation | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const participation = new ChatParticipation(setState);
    current.current = participation;
    void participation.start();
    const end = () => {
      void participation.stop().catch(() => undefined);
      setState({
        status: 'left',
        message: '채팅방에서 퇴장했어요.',
        activeRoom: null,
        isReady: false,
      });
    };
    const onRoute = () => {
      if (window.location.pathname !== '/chat') end();
    };
    const onToken = () => {
      if (!getAccessToken()) end();
    };
    window.addEventListener(ROUTE_CHANGE_EVENT, onRoute);
    window.addEventListener('popstate', onRoute);
    window.addEventListener('pagehide', end);
    window.addEventListener(AUTH_EXPIRED_EVENT, end);
    window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, onToken);
    return () => {
      window.removeEventListener(ROUTE_CHANGE_EVENT, onRoute);
      window.removeEventListener('popstate', onRoute);
      window.removeEventListener('pagehide', end);
      window.removeEventListener(AUTH_EXPIRED_EVENT, end);
      window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, onToken);
      current.current = null;
      void participation.stop().catch(() => undefined);
    };
  }, [attempt]);
  return {
    ...state,
    retry: () => setAttempt((value) => value + 1),
    send: (content: string) => current.current?.send(content) ?? false,
    retryMessage: (id: string) => current.current?.retryMessage(id) ?? false,
  };
}
