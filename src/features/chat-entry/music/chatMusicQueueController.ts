import { getAccessToken } from '../../auth-login/api/authSession';
import { chatAuthContext, sameChatAuthContext } from '../services/chatAuthContext';
import {
  ChatMusicError,
  fetchMusicQueue,
  mutateMusicQueue,
  searchChatMusic,
  type MusicMutation,
} from './chatMusicApi';
import type {
  ChatMusicEvent,
  ChatMusicSession,
  MusicQueueItem,
  MusicQueuePage,
  RequestableMusic,
  RequestableMusicPage,
} from './chatMusicTypes';

export interface MusicQueueState {
  queue: MusicQueuePage | null;
  queueLoading: boolean;
  queueError: string;
  isQueueStale: boolean;
  search: RequestableMusicPage | null;
  searchQuery: string;
  searchLoading: boolean;
  searchError: string;
  pending: MusicMutation | null;
  isMutating: boolean;
  notice: string;
  isCoolingDown: boolean;
}
const initial = (): MusicQueueState => ({
  queue: null,
  queueLoading: false,
  queueError: '',
  isQueueStale: true,
  search: null,
  searchQuery: '',
  searchLoading: false,
  searchError: '',
  pending: null,
  isMutating: false,
  notice: '',
  isCoolingDown: false,
});
const normalizedQuery = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ');

/** Memory is scoped to one account/sid/room/member/view. A reconnect may retry only the original command tuple. */
export class ChatMusicQueueController {
  private state = initial();
  private listeners = new Set<() => void>();
  private isActive = false;
  private generation = 0;
  private maxVersion = -1;
  private epoch: number | undefined;
  private queueRequest: AbortController | undefined;
  private searchRequest: AbortController | undefined;
  private mutationRequest: AbortController | undefined;
  private queueSerial = 0;
  private searchSerial = 0;
  private mutationSerial = 0;
  private refreshAgain = false;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private queueCursors = new Set<string>();
  private searchCursors = new Set<string>();
  private cooldownTimer: ReturnType<typeof setTimeout> | undefined;
  private session: ChatMusicSession;

  constructor(session: ChatMusicSession) {
    this.session = session;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<MusicQueueState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private owns(generation = this.generation) {
    return (
      this.isActive &&
      generation === this.generation &&
      sameChatAuthContext(
        chatAuthContext(this.session.ownerToken),
        chatAuthContext(getAccessToken()),
      )
    );
  }
  connect(session: ChatMusicSession, isReady: boolean) {
    this.pause();
    this.session = session;
    if (!isReady) return;
    this.generation += 1;
    this.isActive = true;
    this.maxVersion = -1;
    this.epoch = undefined;
    this.queueCursors.clear();
    this.searchCursors.clear();
    this.update({ queue: null, search: null, isQueueStale: true, queueError: '', searchError: '' });
    void this.loadQueue();
  }
  pause() {
    this.isActive = false;
    this.generation += 1;
    this.queueSerial += 1;
    this.searchSerial += 1;
    this.mutationSerial += 1;
    this.queueRequest?.abort();
    this.searchRequest?.abort();
    this.mutationRequest?.abort();
    this.queueRequest = undefined;
    this.searchRequest = undefined;
    this.mutationRequest = undefined;
    this.refreshAgain = false;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.update({
      queueLoading: false,
      searchLoading: false,
      isMutating: false,
      isQueueStale: true,
      ...(this.state.pending
        ? { notice: '처리 결과를 확인하지 못했어요. 연결 후 같은 요청으로 결과를 확인해 주세요.' }
        : {}),
    });
  }
  dispose() {
    this.pause();
    clearTimeout(this.cooldownTimer);
  }
  private cooldown(seconds: number) {
    clearTimeout(this.cooldownTimer);
    this.update({ isCoolingDown: true });
    this.cooldownTimer = setTimeout(
      () => this.update({ isCoolingDown: false }),
      Math.max(1, seconds) * 1000,
    );
  }
  hint(event: ChatMusicEvent | undefined) {
    if (
      !event ||
      !this.owns() ||
      event.roomId !== this.session.roomId ||
      (this.epoch !== undefined && event.epoch !== this.epoch) ||
      event.version < this.maxVersion
    )
      return;
    this.epoch = event.epoch;
    this.maxVersion = event.version;
    if (!this.state.queue || this.state.queue.version < event.version) {
      this.update({ isQueueStale: true });
      if (this.queueRequest) this.refreshAgain = true;
      else this.scheduleRefresh();
    }
  }
  private scheduleRefresh() {
    if (!this.owns() || this.refreshTimer !== undefined) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      if (this.owns()) void this.loadQueue(false, false);
    }, 200);
  }
  async loadQueue(more = false, retry = true): Promise<void> {
    if (!this.owns()) return;
    const previous = this.state.queue;
    const cursor = more ? previous?.nextCursor : null;
    if (more && (!cursor || this.state.isQueueStale || this.state.queueLoading)) return;
    if (!more) {
      this.queueCursors.clear();
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.queueRequest?.abort();
    const controller = new AbortController();
    this.queueRequest = controller;
    const serial = ++this.queueSerial;
    const generation = this.generation;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    this.update({ queueLoading: true, queueError: '' });
    try {
      const page = await fetchMusicQueue(this.session, cursor ?? null, controller.signal);
      if (!this.owns(generation) || serial !== this.queueSerial) return;
      if (cursor && (!previous || page.version !== previous.version))
        throw new ChatMusicError(409, 'QUEUE_CHANGED');
      if (
        (page.nextCursor &&
          (page.nextCursor === cursor || this.queueCursors.has(page.nextCursor))) ||
        (page.items.length === 0 && page.nextCursor)
      )
        throw new ChatMusicError(502, 'INVALID_RESPONSE');
      if (this.state.queue && page.version < this.state.queue.version) return;
      if (
        cursor &&
        previous &&
        page.items.some((item) =>
          previous.items.some((old) => old.queueItemId === item.queueItemId),
        )
      )
        throw new ChatMusicError(502, 'INVALID_RESPONSE');
      if (cursor) this.queueCursors.add(cursor);
      const isStale = page.version < this.maxVersion;
      this.update({
        queue: {
          ...page,
          items: more && previous ? [...previous.items, ...page.items] : page.items,
        },
        isQueueStale: isStale,
        queueError: isStale ? '대기열이 바뀌었어요. 최신 목록을 다시 확인해 주세요.' : '',
      });
      if (isStale && retry) this.refreshAgain = true;
    } catch (error) {
      if (!this.owns(generation) || serial !== this.queueSerial) return;
      if (
        retry &&
        error instanceof ChatMusicError &&
        ['QUEUE_CHANGED', 'CURSOR_EXPIRED'].includes(error.code)
      ) {
        this.queueRequest = undefined;
        await this.loadQueue(false, false);
        return;
      }
      this.update({
        queueError:
          error instanceof ChatMusicError
            ? error.message
            : '대기열을 불러오지 못했어요. 다시 확인해 주세요.',
        isQueueStale: true,
      });
    } finally {
      clearTimeout(timeout);
      if (this.owns(generation) && serial === this.queueSerial) {
        this.queueRequest = undefined;
        this.update({ queueLoading: false });
        if (this.refreshAgain) {
          this.refreshAgain = false;
          if (retry) this.scheduleRefresh();
        }
      }
    }
  }
  async search(query: string, more = false, retry = true): Promise<void> {
    if (!this.owns()) return;
    const normalized = normalizedQuery(query);
    if (normalized.length > 100) {
      this.update({ searchError: '검색어는 100자까지 입력해 주세요.' });
      return;
    }
    const previous = this.state.search;
    const cursor = more ? previous?.nextCursor : null;
    if (more && (!cursor || normalized !== this.state.searchQuery || this.state.searchLoading))
      return;
    if (!more) this.searchCursors.clear();
    this.searchRequest?.abort();
    const controller = new AbortController();
    this.searchRequest = controller;
    const serial = ++this.searchSerial;
    const generation = this.generation;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    this.update({
      searchLoading: true,
      searchError: '',
      searchQuery: normalized,
      ...(!more ? { search: null } : {}),
    });
    try {
      const page = await searchChatMusic(
        this.session,
        normalized,
        cursor ?? null,
        controller.signal,
      );
      if (!this.owns(generation) || serial !== this.searchSerial) return;
      if (
        (page.nextCursor &&
          (page.nextCursor === cursor || this.searchCursors.has(page.nextCursor))) ||
        (page.items.length === 0 && page.nextCursor)
      )
        throw new ChatMusicError(502, 'INVALID_RESPONSE');
      if (cursor) this.searchCursors.add(cursor);
      const items =
        more && previous
          ? [
              ...previous.items,
              ...page.items.filter(
                (item) => !previous.items.some((old) => old.musicId === item.musicId),
              ),
            ]
          : page.items;
      this.update({ search: { ...page, items } });
    } catch (error) {
      if (!this.owns(generation) || serial !== this.searchSerial) return;
      if (retry && error instanceof ChatMusicError && error.code === 'CURSOR_EXPIRED') {
        await this.search(normalized, false, false);
        return;
      }
      this.update({
        searchError:
          error instanceof ChatMusicError
            ? error.message
            : '검색 결과를 불러오지 못했어요. 다시 검색해 주세요.',
      });
    } finally {
      clearTimeout(timeout);
      if (this.owns(generation) && serial === this.searchSerial) {
        this.searchRequest = undefined;
        this.update({ searchLoading: false });
      }
    }
  }
  cancelSearch() {
    this.searchSerial += 1;
    this.searchRequest?.abort();
    this.searchRequest = undefined;
    this.update({ searchLoading: false });
  }
  add(song: RequestableMusic) {
    if (!this.canMutate()) return;
    const id = crypto.randomUUID();
    void this.runMutation({ id, kind: 'add', musicId: song.musicId, label: song.title });
  }
  cancel(item: MusicQueueItem) {
    if (!this.canMutate() || !this.state.queue || this.state.isQueueStale) return;
    void this.runMutation({
      id: crypto.randomUUID(),
      kind: 'cancel',
      queueItemId: item.queueItemId,
      expectedVersion: this.state.queue.version,
      label: item.title,
    });
  }
  retryMutation() {
    if (this.owns() && this.state.pending && !this.state.isMutating && !this.state.isCoolingDown)
      void this.runMutation(this.state.pending);
  }
  private canMutate() {
    return this.owns() && !this.state.pending && !this.state.isCoolingDown;
  }
  private async runMutation(mutation: MusicMutation) {
    const controller = new AbortController();
    this.mutationRequest = controller;
    const serial = ++this.mutationSerial;
    const generation = this.generation;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    this.update({ pending: mutation, isMutating: true, notice: '' });
    try {
      const status = await mutateMusicQueue(this.session, mutation, controller.signal);
      if (!this.owns(generation) || serial !== this.mutationSerial) return;
      this.update({
        pending: null,
        notice:
          mutation.kind === 'cancel'
            ? '대기 곡 신청을 취소했어요.'
            : status === 'CANCELED'
              ? '재생할 수 없는 곡이라 신청이 취소됐어요.'
              : '곡 신청을 확인했어요.',
      });
      this.cooldown(1);
      void this.loadQueue();
    } catch (error) {
      if (!this.owns(generation) || serial !== this.mutationSerial) return;
      const uncertain = !(error instanceof ChatMusicError) || error.isUncertain;
      this.update({
        pending: uncertain ? mutation : null,
        notice: uncertain
          ? '처리 결과를 확인하지 못했어요. 같은 요청으로 결과를 다시 확인해 주세요.'
          : error.message,
      });
      if (error instanceof ChatMusicError && error.status === 429)
        this.cooldown(error.retryAfter || 1);
      if (error instanceof ChatMusicError && error.status === 409) {
        void this.loadQueue();
        if (error.code === 'MUSIC_NOT_REQUESTABLE') void this.search(this.state.searchQuery);
      }
    } finally {
      clearTimeout(timeout);
      if (this.owns(generation) && serial === this.mutationSerial) {
        this.mutationRequest = undefined;
        this.update({ isMutating: false });
      }
    }
  }
}
