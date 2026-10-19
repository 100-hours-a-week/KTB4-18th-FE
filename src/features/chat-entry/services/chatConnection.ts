import { Client } from '@stomp/stompjs';

import type { ChatRoomMembership } from '../../../api/chatRooms';
import {
  getAccessToken,
  refreshAccessToken,
  shouldRefreshAccessToken,
  ACCESS_TOKEN_CHANGED_EVENT,
} from '../../auth-login/api/authSession';
import { CHAT_CACHE_LIMIT } from './chatConversationCache';
import { chatAuthContext, sameChatAuthContext } from './chatAuthContext';
import { chatBanNotice, parseChatEvent, type ChatEvent, type ChatGap } from './chatMessages';
import { ChatRecoveryError, fetchChatRecovery, fetchChatHistory } from './chatRecovery';

export type ChatConnectionStatus =
  | 'connecting'
  | 'recovering'
  | 'recovery-failed'
  | 'ready'
  | 'reconnecting'
  | 'left'
  | 'banned'
  | 'full'
  | 'error';

type Ready = Extract<ChatEvent, { type: 'CHAT_READY' }>;

export function connectChatRoom(
  membership: ChatRoomMembership,
  onStatus: (status: ChatConnectionStatus, message: string) => void,
  onEvent?: (event: ChatEvent) => void,
) {
  const url = new URL('/ws', import.meta.env.VITE_API_BASE_URL || window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  let isStopped = false;
  let isPaused = false;
  let isReady = false;
  let generation = 0;
  let readyTimer: number | undefined;
  let initialDeadline: number | undefined;
  let viewSessionId: string | undefined = membership.viewSessionId;
  let hasReceivedReady = false;
  let lastMessageId = 0;
  let recovery: AbortController | undefined;
  let buffered: ChatEvent[] = [];
  const owner = chatAuthContext(getAccessToken());
  const ownsCurrentAuth = () => sameChatAuthContext(owner, chatAuthContext(getAccessToken()));
  const onAuthChange = () => {
    if (!ownsCurrentAuth())
      terminal('error', '로그인 상태가 변경됐어요. 채팅 탭에 다시 입장해 주세요.');
  };

  const cancelRecovery = () => {
    recovery?.abort();
    recovery = undefined;
    buffered = [];
    window.clearTimeout(readyTimer);
    readyTimer = undefined;
  };
  const stop = () => {
    isStopped = true;
    isReady = false;
    generation += 1;
    cancelRecovery();
    window.clearTimeout(initialDeadline);
    window.removeEventListener?.(ACCESS_TOKEN_CHANGED_EVENT, onAuthChange);
    void client.deactivate({ force: true });
  };
  const terminal = (status: ChatConnectionStatus, message: string) => {
    if (isStopped) return;
    stop();
    onStatus(status, message);
  };
  const recoveryFailed = () => {
    if (isStopped) return;
    isPaused = true;
    isReady = false;
    generation += 1;
    cancelRecovery();
    window.clearTimeout(initialDeadline);
    void client.deactivate({ force: true });
    onStatus('recovery-failed', '이전 메시지를 복구하지 못했어요. 복구를 다시 시도해 주세요.');
  };
  const deliver = (event: ChatEvent) => {
    if (isStopped || !ownsCurrentAuth()) return;
    onEvent?.(event);
    if (event.type === 'CHAT_MESSAGE' || event.type === 'CHAT_ACK') {
      lastMessageId = Math.max(lastMessageId, event.message.messageId);
    }
  };
  const recover = async (ready: Ready, connectionGeneration: number) => {
    window.clearTimeout(readyTimer);
    window.clearTimeout(initialDeadline);
    recovery = new AbortController();
    const controller = recovery;
    onStatus('recovering', '놓친 메시지를 복구하고 있어요.');
    const recovered = new Map<number, Extract<ChatEvent, { type: 'CHAT_MESSAGE' }>>();
    const visited = new Set<string>();
    let cursor: string | null = ready.recoveryCursor;
    try {
      while (cursor) {
        if (visited.has(cursor)) throw new ChatRecoveryError(502);
        visited.add(cursor);
        const page = await fetchChatRecovery(
          membership,
          ready.viewSessionId,
          cursor,
          controller.signal,
        );
        if (
          isStopped ||
          isPaused ||
          generation !== connectionGeneration ||
          controller.signal.aborted ||
          !ownsCurrentAuth()
        )
          return;
        if (page.snapshotMessageId !== ready.snapshotMessageId) throw new ChatRecoveryError(502);
        for (const message of page.items)
          recovered.set(message.messageId, { type: 'CHAT_MESSAGE', message });
        cursor = page.nextCursor;
      }
      if (
        isStopped ||
        isPaused ||
        generation !== connectionGeneration ||
        controller.signal.aborted ||
        !ownsCurrentAuth()
      )
        return;
      const history = new Map<number, Extract<ChatEvent, { type: 'CHAT_MESSAGE' }>['message']>();
      const historyGaps = new Map<string, ChatGap>();
      const historyVisited = new Set<string>();
      let historyCursor: string | null = null;
      let historySnapshot: number | undefined;
      let oldest = Number.POSITIVE_INFINITY;
      do {
        if (historyCursor && historyVisited.has(historyCursor)) throw new ChatRecoveryError(502);
        if (historyCursor) historyVisited.add(historyCursor);
        const token = getAccessToken();
        if (!token || !ownsCurrentAuth()) return;
        const page = await fetchChatHistory(
          membership,
          ready.viewSessionId,
          historyCursor,
          controller.signal,
          token,
        );
        if (
          isStopped ||
          isPaused ||
          generation !== connectionGeneration ||
          controller.signal.aborted ||
          !ownsCurrentAuth()
        )
          return;
        historySnapshot ??= page.snapshotMessageId;
        if (page.snapshotMessageId !== historySnapshot || (page.hasNext && page.items.length === 0))
          throw new ChatRecoveryError(502);
        for (const message of page.items) {
          if (message.messageId >= oldest) throw new ChatRecoveryError(502);
          oldest = message.messageId;
          history.set(message.messageId, message);
        }
        for (const gap of page.gaps)
          historyGaps.set(`${gap.reason}:${gap.beforeMessageId}:${gap.resumedAt}`, gap);
        historyCursor = page.nextCursor;
      } while (historyCursor && history.size < CHAT_CACHE_LIMIT);
      deliver({
        type: 'CHAT_HISTORY',
        messages: [...history.values()]
          .sort((a, b) => a.messageId - b.messageId)
          .slice(-CHAT_CACHE_LIMIT),
        gaps: [...historyGaps.values()],
      });
      deliver({ type: 'CHAT_GAPS', gaps: [...historyGaps.values()] });
      [...recovered.values()]
        .sort((a, b) => a.message.messageId - b.message.messageId)
        .forEach(deliver);
      const live = buffered;
      buffered = [];
      live.forEach(deliver);
      if (isStopped || !ownsCurrentAuth()) return;
      recovery = undefined;
      isReady = true;
      onStatus('ready', '채팅방에 입장했어요.');
    } catch (error) {
      if (
        isStopped ||
        isPaused ||
        generation !== connectionGeneration ||
        controller.signal.aborted ||
        !ownsCurrentAuth()
      )
        return;
      if (error instanceof ChatRecoveryError && error.code === 'CHAT_ROOM_403_BANNED') {
        terminal('banned', chatBanNotice(error.bannedUntil));
      } else if (error instanceof ChatRecoveryError && error.status === 401) {
        terminal('error', '다시 로그인한 후 채팅 탭에 입장해 주세요.');
      } else recoveryFailed();
    }
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
        if (isStopped || isPaused) return;
        if (!token || !sameChatAuthContext(owner, chatAuthContext(token)) || !ownsCurrentAuth()) {
          terminal('error', '다시 로그인한 후 채팅 탭에 입장해 주세요.');
          return;
        }
        client.connectHeaders = {
          Authorization: `Bearer ${token}`,
          auth_session_id: owner!.sessionId,
          room_id: String(membership.roomId),
          membership_id: String(membership.membershipId),
          ...(viewSessionId
            ? { view_session_id: viewSessionId, last_message_id: String(lastMessageId) }
            : {}),
        };
      } catch {
        terminal('error', '로그인 상태를 확인하지 못했습니다. 다시 입장해 주세요.');
      }
    },
    onConnect: () => {
      if (isStopped || isPaused || !ownsCurrentAuth()) return;
      isReady = false;
      cancelRecovery();
      const connectionGeneration = ++generation;
      onStatus('connecting', '채팅방에 연결하고 있어요.');
      let remaining = 2;
      let ready: Ready | undefined;
      let started = false;
      const begin = () => {
        if (
          isStopped ||
          isPaused ||
          generation !== connectionGeneration ||
          remaining !== 0 ||
          !ready ||
          started
        )
          return;
        started = true;
        void recover(ready, connectionGeneration);
      };
      const receive = (frame: { body: string }) => {
        if (isStopped || isPaused || generation !== connectionGeneration || !ownsCurrentAuth())
          return;
        const event = parseChatEvent(frame.body);
        if (!event) return;
        if (event.type === 'CHAT_BANNED') {
          if (event.roomId === membership.roomId && event.membershipId === membership.membershipId)
            terminal('banned', chatBanNotice(event.bannedUntil));
        } else if (event.type === 'CHAT_READY') {
          if (
            event.roomId !== membership.roomId ||
            event.membershipId !== membership.membershipId ||
            (viewSessionId && viewSessionId !== event.viewSessionId)
          )
            return;
          hasReceivedReady = true;
          viewSessionId = event.viewSessionId;
          ready ??= event;
          begin();
        } else if (event.type === 'CHAT_MESSAGE' || event.type === 'CHAT_ACK') {
          if (
            event.message.roomId !== membership.roomId ||
            (event.type === 'CHAT_ACK' && event.membershipId !== membership.membershipId)
          )
            return;
          if (isReady) deliver(event);
          else buffered.push(event);
        } else deliver(event);
      };
      readyTimer = window.setTimeout(recoveryFailed, 10_000);
      for (const destination of [
        `/topic/chat-rooms/${membership.roomId}`,
        '/user/queue/chat-events',
      ]) {
        const receipt = `chat-ready-${membership.membershipId}-${crypto.randomUUID()}`;
        client.watchForReceipt(receipt, () => {
          if (isStopped || isPaused || generation !== connectionGeneration) return;
          remaining -= 1;
          begin();
        });
        client.subscribe(destination, receive, { receipt });
      }
    },
    onStompError: (frame) => {
      const code = frame.headers.message;
      if (code === 'CHAT_VIEW_UNAVAILABLE') {
        recoveryFailed();
        return;
      }
      if (code === 'CHAT_BANNED') terminal('banned', chatBanNotice(frame.headers.banned_until));
      else if (code === 'CHAT_FULL') terminal('full', '현재 지역 채팅방의 정원이 가득 찼습니다.');
      else if (code === 'CHAT_LEFT')
        terminal('left', '현재 채팅 참여가 종료됐어요. 채팅 탭에 다시 입장해 주세요.');
      else terminal('error', '채팅 연결 인증에 실패했습니다. 다시 입장해 주세요.');
    },
    onWebSocketClose: (event) => {
      if (isStopped || isPaused) return;
      isReady = false;
      generation += 1;
      cancelRecovery();
      if (event.code === 4100 && event.reason === 'CHAT_LOGGED_OUT') {
        terminal('left', '로그아웃되어 채팅이 종료됐어요.');
      } else if (event.code === 4100)
        terminal('left', '현재 채팅 참여가 종료됐어요. 채팅 탭에 다시 입장해 주세요.');
      else if (event.code === 4101) terminal('banned', chatBanNotice(event.reason?.split('|')[1]));
      else if (event.code === 4103) recoveryFailed();
      else {
        onStatus('reconnecting', '연결이 끊겼어요. 채팅방에 다시 연결하고 있습니다.');
        // Established views can reconnect beyond grace; only the server decides recoverable intervals.
        if (!hasReceivedReady)
          initialDeadline ??= window.setTimeout(
            () => terminal('error', '채팅방에 연결하지 못했습니다. 다시 입장해 주세요.'),
            30_000,
          );
      }
    },
  });
  onStatus('connecting', '채팅방에 연결하고 있어요.');
  window.addEventListener?.(ACCESS_TOKEN_CHANGED_EVENT, onAuthChange);
  client.activate();
  return Object.assign(stop, {
    retryRecovery() {
      if (isStopped || !isPaused || !ownsCurrentAuth()) return;
      isPaused = false;
      onStatus('reconnecting', '메시지 복구를 다시 시도하고 있어요.');
      client.activate();
    },
    send(clientMessageId: string, content: string) {
      if (isStopped || !isReady || !ownsCurrentAuth()) return false;
      client.publish({
        destination: `/app/chat-rooms/${membership.roomId}/messages`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_message_id: clientMessageId, content }),
      });
      return true;
    },
  });
}
