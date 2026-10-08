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
import { resolveCurrentChatLocation } from './resolveCurrentChatLocation';

export interface ChatParticipationState {
  status: ChatConnectionStatus | 'locating' | 'joining';
  message: string;
  activeRoom: ActiveChatRoom | null;
  isReady: boolean;
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
  private closeConnection: (() => void) | null = null;
  private interval: number | undefined;
  private isChecking = false;

  private readonly publish: (state: ChatParticipationState) => void;

  constructor(publish: (state: ChatParticipationState) => void) {
    this.publish = publish;
  }

  private update(status: ChatParticipationState['status'], message: string) {
    if (!this.isStopped)
      this.publish({ status, message, activeRoom: this.active, isReady: status === 'ready' });
  }

  async start() {
    this.update('locating', '현재 위치를 확인하고 있어요. 위치 권한을 허용해 주세요.');
    try {
      const location = await resolveCurrentChatLocation(this.controller.signal);
      await this.enter(location);
      if (!this.isStopped)
        this.interval = window.setInterval(() => void this.revalidate(), 10 * 60 * 1_000);
    } catch (error) {
      this.failed(error);
    }
  }

  private async enter(location: LocationResolution) {
    if (this.isStopped) return;
    this.update('joining', '현재 지역 채팅방에 입장하고 있어요.');
    const room = await getRegionChatRoom(location.region.sigungu.regionId, this.controller.signal);
    await transition(async () => {
      if (this.isStopped) return;
      // Do not abort a sent join: obtain its membership_id and explicitly end a late success.
      const membership = await joinChatRoom(
        room.roomId,
        location.locationResolutionToken,
        new AbortController().signal,
      );
      const token = getAccessToken();
      if (this.isStopped) {
        await leaveChatRoom(membership, token);
        return;
      }
      this.active = { room, membership };
      this.token = token;
      this.closeConnection = connectChatRoom(membership, (status, message) => {
        this.update(status, message);
        if (['left', 'banned', 'full', 'error'].includes(status)) {
          window.clearInterval(this.interval);
          this.controller.abort();
          void this.depart().catch(() =>
            this.update('error', '퇴장을 확인하지 못했습니다. 다시 시도해 주세요.'),
          );
        }
      });
    });
  }

  private depart() {
    this.closeConnection?.();
    this.closeConnection = null;
    const active = this.active;
    this.active = null;
    const token = this.token;
    this.token = null;
    return active ? transition(() => leaveChatRoom(active.membership, token)) : Promise.resolve();
  }

  private async revalidate() {
    if (this.isStopped || !this.active || this.isChecking) return;
    this.isChecking = true;
    try {
      const candidate = await resolveCurrentChatLocation(this.controller.signal);
      if (this.isStopped || candidate.region.sigungu.regionId === this.active?.room.regionId)
        return;
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
      if (this.isStopped || this.controller.signal.aborted) return;
      const confirmation = await resolveCurrentChatLocation(this.controller.signal);
      if (confirmation.region.sigungu.regionId !== candidate.region.sigungu.regionId) return;
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
