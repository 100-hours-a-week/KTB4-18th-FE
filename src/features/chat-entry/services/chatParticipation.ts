import {
  getRegionChatRoom,
  joinChatRoom,
  leaveChatRoom,
  ChatRoomRequestError,
} from '../../../api/chatRooms';
import type { LocationResolution } from '../../../api/locationResolutions';
import { getAccessToken } from '../../auth-login/api/authSession';
import type { ActiveChatRoom } from '../components/ChatEntryPage';
import { connectChatRoom, type ChatConnectionStatus } from './chatConnection';
import { chatAuthContext, sameChatAuthContext, type ChatAuthContext } from './chatAuthContext';
import {
  REJECTION_MESSAGES,
  chatBanNotice,
  type ChatEvent,
  type ChatMessage,
  type ChatGap,
} from './chatMessages';
import { resolveCurrentChatLocation } from './resolveCurrentChatLocation';
import {
  chatAccountId,
  openChatConversation,
  retainChatMessages,
  storeChatConversation,
  CHAT_CACHE_TTL_MS,
  type ChatCacheContext,
} from './chatConversationCache';

export interface PendingChatMessage {
  clientMessageId: string;
  content: string;
  status: 'sending' | 'uncertain' | 'rejected';
  notice: string;
}

export interface ChatParticipationState {
  status: ChatConnectionStatus | 'locating' | 'joining';
  message: string;
  activeRoom: ActiveChatRoom | null;
  isReady: boolean;
  currentUserId?: number | null;
  connectedCount?: number | null;
  presenceStatus?: 'loading' | 'live' | 'disconnected' | 'error';
  messages?: ChatMessage[];
  pendingMessages?: PendingChatMessage[];
  sendNotice?: string;
  gaps?: ChatGap[];
  restoredThroughMessageId?: number;
}

// Serialize REST transitions across StrictMode, rapid tab changes, and late join responses.
let transitions: Promise<unknown> = Promise.resolve();
function transition<T>(work: () => Promise<T>) {
  const next = transitions.then(work, work);
  transitions = next.catch(() => undefined);
  return next;
}

export class ChatParticipation {
  private isStopped = false;
  private controller = new AbortController();
  private active: ActiveChatRoom | null = null;
  private token: string | null = null;
  private currentUserId: number | null = null;
  private connectedCount: number | null = null;
  private presenceVersion = -1;
  private presenceStatus: NonNullable<ChatParticipationState['presenceStatus']> = 'loading';
  private presenceTimer: number | undefined;
  private closeConnection:
    | ((() => void) & {
        send?: (id: string, content: string) => boolean;
        retryRecovery?: () => void;
      })
    | null = null;
  private messages: ChatMessage[] = [];
  private gaps: ChatGap[] = [];
  private pending = new Map<string, PendingChatMessage>();
  private pendingTimers = new Map<string, number>();
  private status: ChatParticipationState['status'] = 'locating';
  private statusMessage = '';
  private sendNotice = '';
  private interval: number | undefined;
  private isChecking = false;
  private cacheContext: ChatCacheContext | null = null;
  private restoredThroughMessageId: number | undefined;
  private expirationTimer: number | undefined;
  private startingAccountId: number | null = null;
  private startingAuthContext: ChatAuthContext | null = null;

  private readonly publish: (state: ChatParticipationState) => void;

  constructor(publish: (state: ChatParticipationState) => void) {
    this.publish = publish;
  }

  private update(status: ChatParticipationState['status'], message: string) {
    this.messages = retainChatMessages(this.messages);
    this.status = status;
    this.statusMessage = message;
    if (!this.isStopped)
      this.publish({
        status,
        message,
        activeRoom: this.active,
        currentUserId: this.currentUserId,
        connectedCount: this.connectedCount,
        presenceStatus: this.presenceStatus,
        isReady: status === 'ready',
        messages: [...this.messages],
        pendingMessages: [...this.pending.values()],
        sendNotice: this.sendNotice,
        gaps: [...this.gaps],
        restoredThroughMessageId: this.restoredThroughMessageId,
      });
  }

  async start() {
    this.startingAccountId = chatAccountId(getAccessToken());
    this.startingAuthContext = chatAuthContext(getAccessToken());
    this.update('locating', '현재 위치를 확인하고 있어요. 위치 권한을 허용해 주세요.');
    try {
      const location = await resolveCurrentChatLocation(
        this.controller.signal,
        getAccessToken() ?? undefined,
      );
      await this.enter(location);
      if (this.ownsSession() && this.active)
        this.interval = window.setInterval(() => void this.revalidate(), 10 * 60 * 1_000);
    } catch (error) {
      this.failed(error);
    }
  }

  private ownsSession() {
    return (
      !this.isStopped &&
      !this.controller.signal.aborted &&
      sameChatAuthContext(this.startingAuthContext, chatAuthContext(getAccessToken()))
    );
  }

  private async enter(location: LocationResolution) {
    if (!this.ownsSession()) return;
    this.update('joining', '현재 지역 채팅방에 입장하고 있어요.');
    const room = await getRegionChatRoom(location.region.sigungu.regionId, this.controller.signal);
    await transition(async () => {
      if (!this.ownsSession()) return;
      const entryToken = getAccessToken();
      if (!entryToken) return;
      // Do not abort a sent join: obtain its membership_id and explicitly end a late success.
      const membership = await joinChatRoom(
        room.roomId,
        location.locationResolutionToken,
        new AbortController().signal,
        entryToken,
      );
      const token = getAccessToken();
      if (
        this.isStopped ||
        chatAccountId(token) !== this.startingAccountId ||
        !sameChatAuthContext(this.startingAuthContext, chatAuthContext(token))
      ) {
        await leaveChatRoom(membership, entryToken);
        return;
      }
      this.active = { room, membership };
      this.token = token;
      this.currentUserId = chatAccountId(token);
      this.clearMessages();
      if (this.currentUserId !== null) {
        const restored = openChatConversation(this.currentUserId, room.regionId, room.roomId);
        this.cacheContext = restored.context;
        this.messages = restored.messages;
        this.restoredThroughMessageId = this.messages.at(-1)?.messageId;
        this.rememberMessages();
      }
      this.closeConnection = connectChatRoom(
        membership,
        (status, message) => {
          if (
            status === 'connecting' ||
            status === 'reconnecting' ||
            status === 'recovery-failed'
          ) {
            window.clearTimeout(this.presenceTimer);
            this.connectedCount = null;
            this.presenceVersion = -1;
            this.presenceStatus =
              status === 'recovery-failed'
                ? 'error'
                : status === 'reconnecting'
                  ? 'disconnected'
                  : 'loading';
          }
          if (status === 'ready' && this.connectedCount === null) {
            this.presenceTimer = window.setTimeout(() => {
              if (this.isStopped || this.connectedCount !== null) return;
              this.presenceStatus = 'error';
              this.update(this.status, this.statusMessage);
            }, 10_000);
          }
          if (status === 'reconnecting') {
            this.pending.forEach((item) => {
              if (item.status === 'sending') {
                item.status = 'uncertain';
                item.notice = '전송 결과를 확인하지 못했어요. 연결 후 재전송할 수 있어요.';
              }
            });
          }
          this.update(status, message);
          if (['left', 'banned', 'full', 'error'].includes(status)) {
            window.clearInterval(this.interval);
            this.controller.abort();
            void this.depart().catch(() =>
              this.update('error', '퇴장을 확인하지 못했습니다. 다시 시도해 주세요.'),
            );
          }
        },
        (event) => {
          if (!this.isStopped && this.active?.membership.membershipId === membership.membershipId)
            this.receive(event);
        },
      );
    });
  }

  private depart() {
    this.closeConnection?.();
    this.closeConnection = null;
    this.clearMessages();
    const active = this.active;
    this.active = null;
    const token = this.token;
    this.token = null;
    this.currentUserId = null;
    this.update(this.status, this.statusMessage);
    return active ? transition(() => leaveChatRoom(active.membership, token)) : Promise.resolve();
  }

  private clearMessages() {
    window.clearTimeout(this.expirationTimer);
    this.cacheContext = null;
    this.restoredThroughMessageId = undefined;
    window.clearTimeout(this.presenceTimer);
    this.connectedCount = null;
    this.presenceVersion = -1;
    this.presenceStatus = 'loading';
    this.pendingTimers.forEach((timer) => window.clearTimeout(timer));
    this.pendingTimers.clear();
    this.messages = [];
    this.gaps = [];
    this.pending.clear();
    this.sendNotice = '';
  }

  private rememberMessages() {
    this.messages = retainChatMessages(this.messages);
    if (this.active && this.cacheContext)
      storeChatConversation(
        this.cacheContext,
        this.active.room.regionId,
        this.active.room.roomId,
        this.messages,
      );
    window.clearTimeout(this.expirationTimer);
    if (!this.isStopped && this.messages.length) {
      const earliest = Math.min(...this.messages.map((item) => Date.parse(item.createdAt)));
      this.expirationTimer = window.setTimeout(
        () => {
          if (this.isStopped) return;
          this.rememberMessages();
          this.update(this.status, this.statusMessage);
        },
        Math.max(1, earliest + CHAT_CACHE_TTL_MS - Date.now()),
      );
    }
  }

  private receive(event: ChatEvent) {
    const membership = this.active?.membership;
    if (!membership) return;
    if (event.type === 'CHAT_READY') return;
    if (event.type === 'CHAT_GAPS') {
      for (const gap of event.gaps) {
        if (
          !this.gaps.some(
            (item) =>
              item.reason === gap.reason &&
              item.beforeMessageId === gap.beforeMessageId &&
              item.resumedAt === gap.resumedAt,
          )
        )
          this.gaps.push(gap);
      }
      this.update(this.status, this.statusMessage);
      return;
    }
    if (event.type === 'CHAT_PRESENCE') {
      if (event.roomId !== membership.roomId || event.version <= this.presenceVersion) return;
      window.clearTimeout(this.presenceTimer);
      this.connectedCount = event.connectedCount;
      this.presenceVersion = event.version;
      this.presenceStatus = 'live';
      this.update(this.status, this.statusMessage);
      return;
    }
    if (event.type === 'CHAT_BANNED') {
      if (event.membershipId !== membership.membershipId || event.roomId !== membership.roomId)
        return;
      this.update('banned', chatBanNotice(event.bannedUntil));
      window.clearInterval(this.interval);
      this.controller.abort();
      void this.depart().catch(() => undefined);
      return;
    }
    if (event.type === 'CHAT_REJECTED') {
      if (event.membershipId !== membership.membershipId || event.roomId !== membership.roomId)
        return;
      const pending = this.pending.get(event.clientMessageId);
      if (pending && pending.status !== 'rejected') {
        window.clearTimeout(this.pendingTimers.get(event.clientMessageId));
        this.pendingTimers.delete(event.clientMessageId);
        pending.status = event.reason === 'SEND_FAILED' ? 'uncertain' : 'rejected';
        pending.notice =
          REJECTION_MESSAGES[event.reason] ??
          '메시지를 보내지 못했어요. 새 메시지로 다시 작성해 주세요.';
        this.sendNotice = pending.notice;
      }
    } else {
      if (
        event.message.roomId !== membership.roomId ||
        (event.type === 'CHAT_ACK' &&
          (event.membershipId !== membership.membershipId ||
            event.message.userId !== this.currentUserId))
      )
        return;
      const pending = this.pending.get(event.message.clientMessageId);
      // ACK content is the stored server result and can differ after masking.
      if (pending && event.message.userId === this.currentUserId) {
        this.pending.delete(event.message.clientMessageId);
        window.clearTimeout(this.pendingTimers.get(event.message.clientMessageId));
        this.pendingTimers.delete(event.message.clientMessageId);
      }
      if (!this.messages.some((item) => item.messageId === event.message.messageId)) {
        this.messages.push(event.message);
        this.messages.sort((a, b) => a.messageId - b.messageId);
      }
      this.rememberMessages();
    }
    this.update(this.status, this.statusMessage);
  }

  send(content: string): boolean {
    const text = content.trim();
    this.sendNotice = !text
      ? '메시지를 입력해 주세요.'
      : Array.from(text).length > 300
        ? '메시지는 300자까지 보낼 수 있어요.'
        : this.status !== 'ready'
          ? '채팅방 연결이 완료된 후 보내 주세요.'
          : '';
    if (this.sendNotice) {
      this.update(this.status, this.statusMessage);
      return false;
    }
    const id = crypto.randomUUID();
    this.pending.set(id, { clientMessageId: id, content: text, status: 'sending', notice: '' });
    return this.transmit(id);
  }

  retryMessage(id: string) {
    const pending = this.pending.get(id);
    if (!pending || pending.status !== 'uncertain' || this.status !== 'ready') return false;
    return this.transmit(id);
  }

  retryRecovery() {
    if (!this.isStopped && this.status === 'recovery-failed')
      this.closeConnection?.retryRecovery?.();
  }

  private transmit(id: string) {
    const pending = this.pending.get(id);
    if (!pending) return false;
    pending.status = 'sending';
    pending.notice = '';
    this.sendNotice = '';
    let sent = false;
    try {
      sent = this.closeConnection?.send?.(id, pending.content) ?? false;
    } catch {
      /* Keep UUID for retry. */
    }
    if (!sent) {
      pending.status = 'uncertain';
      pending.notice = '전송 결과를 확인하지 못했어요. 연결 후 재전송할 수 있어요.';
    } else if (this.pending.has(id)) {
      window.clearTimeout(this.pendingTimers.get(id));
      this.pendingTimers.set(
        id,
        window.setTimeout(() => {
          this.pendingTimers.delete(id);
          const current = this.pending.get(id);
          if (!current || this.isStopped) return;
          current.status = 'uncertain';
          current.notice = '전송 결과를 확인하지 못했어요. 재전송할 수 있어요.';
          this.update(this.status, this.statusMessage);
        }, 10_000),
      );
    }
    this.update(this.status, this.statusMessage);
    return sent;
  }

  private async revalidate() {
    if (!this.ownsSession() || !this.active || this.isChecking) return;
    const membershipId = this.active.membership.membershipId;
    const isCurrent = () =>
      this.ownsSession() && this.active?.membership.membershipId === membershipId;
    this.isChecking = true;
    try {
      const candidate = await resolveCurrentChatLocation(
        this.controller.signal,
        getAccessToken() ?? undefined,
      );
      if (!isCurrent() || candidate.region.sigungu.regionId === this.active?.room.regionId) return;
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 15_000);
        this.controller.signal.addEventListener(
          'abort',
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      if (!isCurrent()) return;
      const confirmation = await resolveCurrentChatLocation(
        this.controller.signal,
        getAccessToken() ?? undefined,
      );
      if (
        !isCurrent() ||
        confirmation.region.sigungu.regionId !== candidate.region.sigungu.regionId
      )
        return;
      this.update('joining', '지역 이동이 확인되어 새 채팅방으로 이동하고 있어요.');
      // Always leave the old room before any destination lookup, including failed/full destinations.
      await this.depart();
      await this.enter(confirmation);
    } catch (error) {
      if (!this.active) this.failed(error);
      // A failed location recheck alone keeps the existing room.
    } finally {
      this.isChecking = false;
    }
  }

  private failed(error: unknown) {
    if (this.isStopped || this.controller.signal.aborted) return;
    this.update(
      error instanceof ChatRoomRequestError && error.isBanned
        ? 'banned'
        : error instanceof ChatRoomRequestError && error.status === 409
          ? 'full'
          : 'error',
      error instanceof Error ? error.message : '채팅방에 입장하지 못했습니다. 다시 시도해 주세요.',
    );
  }

  stop() {
    this.isStopped = true;
    this.controller.abort();
    window.clearInterval(this.interval);
    return this.depart();
  }
}
