import { chatBanNotice, parseChatEvent, type ChatEvent } from './chatMessages';

import { Client } from '@stomp/stompjs';

import type { ChatRoomMembership } from '../../../api/chatRooms';
import {
  getAccessToken,
  refreshAccessToken,
  shouldRefreshAccessToken,
} from '../../auth-login/api/authSession';

export type ChatConnectionStatus =
  'connecting' | 'ready' | 'reconnecting' | 'left' | 'banned' | 'full' | 'error';

export function connectChatRoom(
  membership: ChatRoomMembership,
  onStatus: (status: ChatConnectionStatus, message: string) => void,
  onEvent?: (event: ChatEvent) => void,
) {
  const url = new URL('/ws', import.meta.env.VITE_API_BASE_URL || window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  let isStopped = false;
  let isReady = false;
  let generation = 0;
  let receiptTimer: number | undefined;
  let reconnectDeadline: number | undefined;
  let hasConnected = false;

  const clearTimers = () => {
    window.clearTimeout(receiptTimer);
    window.clearTimeout(reconnectDeadline);
    receiptTimer = undefined;
    reconnectDeadline = undefined;
  };
  const stop = () => {
    isStopped = true;
    isReady = false;
    clearTimers();
    void client.deactivate({ force: true });
  };
  const terminal = (status: ChatConnectionStatus, message: string) => {
    if (isStopped) return;
    stop();
    onStatus(status, message);
  };
  const client = new Client({
    brokerURL: url.href,
    reconnectDelay: 1_000,
    connectionTimeout: 10_000,
    heartbeatIncoming: 10_000,
    heartbeatOutgoing: 10_000,
    beforeConnect: async () => {
      try {
        const token = shouldRefreshAccessToken() ? await refreshAccessToken() : getAccessToken();
        if (isStopped) return;
        if (!token) {
          terminal('error', '다시 로그인한 후 채팅 탭에 입장해 주세요.');
          return;
        }
        client.connectHeaders = {
          Authorization: `Bearer ${token}`,
          room_id: String(membership.roomId),
          membership_id: String(membership.membershipId),
        };
      } catch {
        terminal('error', '로그인 상태를 확인하지 못했습니다. 다시 입장해 주세요.');
      }
    },
    onConnect: () => {
      if (isStopped) return;
      isReady = false;
      const connectionGeneration = ++generation;
      onStatus('connecting', '채팅방에 연결하고 있어요.');
      let remaining = 2;
      const receive = (frame: { body: string }) => {
        if (isStopped || generation !== connectionGeneration) return;
        const event = parseChatEvent(frame.body);
        if (event?.type === 'CHAT_BANNED') {
          terminal('banned', chatBanNotice(event.bannedUntil));
        } else if (event) onEvent?.(event);
      };
      receiptTimer = window.setTimeout(
        () => terminal('error', '채팅방 구독을 확인하지 못했습니다. 다시 입장해 주세요.'),
        10_000,
      );
      for (const destination of [
        `/topic/chat-rooms/${membership.roomId}`,
        '/user/queue/chat-events',
      ]) {
        const receipt = `chat-ready-${membership.membershipId}-${crypto.randomUUID()}`;
        client.watchForReceipt(receipt, () => {
          if (isStopped || generation !== connectionGeneration || --remaining !== 0) return;
          clearTimers();
          hasConnected = true;
          isReady = true;
          onStatus('ready', '채팅방에 입장했어요.');
        });
        client.subscribe(destination, receive, { receipt });
      }
    },
    onStompError: (frame) => {
      const code = frame.headers.message;
      if (code === 'CHAT_BANNED') terminal('banned', chatBanNotice(frame.headers.banned_until));
      else if (code === 'CHAT_FULL') terminal('full', '현재 지역 채팅방의 정원이 가득 찼습니다.');
      else if (code === 'CHAT_LEFT')
        terminal('left', '다른 탭 또는 기기에서 퇴장하여 채팅이 종료됐어요.');
      else terminal('error', '채팅 연결 인증에 실패했습니다. 다시 입장해 주세요.');
    },
    onWebSocketClose: (event) => {
      if (isStopped) return;
      isReady = false;
      generation += 1;
      window.clearTimeout(receiptTimer);
      if (event.code === 4100) {
        terminal('left', '다른 탭 또는 기기에서 퇴장하여 채팅이 종료됐어요.');
      } else if (event.code === 4101) {
        terminal('banned', chatBanNotice(event.reason?.split('|')[1]));
      } else {
        onStatus('reconnecting', '연결이 끊겼어요. 채팅방에 다시 연결하고 있습니다.');
        reconnectDeadline ??= window.setTimeout(
          () =>
            terminal(
              'error',
              hasConnected
                ? '연결 복구 유예가 끝났어요. 다시 입장해 주세요.'
                : '채팅방에 연결하지 못했습니다. 다시 입장해 주세요.',
            ),
          30_000,
        );
      }
    },
  });
  onStatus('connecting', '채팅방에 연결하고 있어요.');
  client.activate();
  return Object.assign(stop, {
    send(clientMessageId: string, content: string) {
      if (isStopped || !isReady) return false;
      client.publish({
        destination: `/app/chat-rooms/${membership.roomId}/messages`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_message_id: clientMessageId, content }),
      });
      return true;
    },
  });
}
