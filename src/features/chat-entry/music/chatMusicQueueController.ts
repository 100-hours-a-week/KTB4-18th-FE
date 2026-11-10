import { getAccessToken } from '../../auth-login/api/authSession';
import { chatAuthContext, sameChatAuthContext } from '../services/chatAuthContext';
import {
  ChatMusicError,
  fetchMusicQueue,
  mutateMusicQueue,
  searchChatMusic,
  type MusicMutation,
  type PlaybackAction,
} from './chatMusicApi';
import type {
  ChatMusicEvent,
  ChatMusicSession,
  MusicPlayback,
  MusicQueueItem,
  MusicQueuePage,
  RequestableMusic,
  RequestableMusicPage,
} from './chatMusicTypes';

export type MusicRecoveryStatus =
  'waiting' | 'loading' | 'ready' | 'recovering' | 'error' | 'denied';
export interface MusicQueueState {
  recoveryStatus: MusicRecoveryStatus;
  recoveryMessage: string;
  queue: MusicQueuePage | null;
  playback: { snapshot: MusicPlayback; receivedAt: number } | null;
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
  recoveryStatus: 'waiting',
  recoveryMessage: '음악 연결을 확인하고 있어요.',
  queue: null,
  playback: null,
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
  private transportReady = false;
  private isNetworkAvailable = typeof navigator === 'undefined' || navigator.onLine !== false;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private readRetry: ReturnType<typeof setTimeout> | undefined;
  private readFailures = 0;
  private lastEventTime = -Infinity;
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
      this.isNetworkAvailable &&
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
    this.transportReady = isReady;
    if (!isReady || !this.isNetworkAvailable) return;
    this.generation += 1;
    this.isActive = true;
    this.maxVersion = -1;
    this.lastEventTime = -Infinity;
    this.readFailures = 0;
    this.epoch = undefined;
    this.queueCursors.clear();
    this.searchCursors.clear();
    this.update({
      queue: null,
      search: null,
      isQueueStale: true,
      queueError: '',
      searchError: '',
      recoveryStatus: 'loading',
      recoveryMessage: '최신 음악 상태를 확인하고 있어요.',
    });
    void this.loadQueue();
  }
  pause() {
    this.isActive = false;
    clearTimeout(this.watchdog);
    clearTimeout(this.readRetry);
    this.watchdog = undefined;
    this.readRetry = undefined;
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
      playback: null,
      recoveryStatus: 'waiting',
      recoveryMessage: '연결 후 최신 음악 상태를 확인해요.',
      queueLoading: false,
      searchLoading: false,
      isMutating: false,
      isQueueStale: true,
      ...(this.state.pending
        ? { notice: '처리 결과를 확인하지 못했어요. 연결 후 같은 요청으로 결과를 확인해 주세요.' }
        : {}),
    });
  }
  setNetworkAvailable(isAvailable: boolean) {
    if (this.isNetworkAvailable === isAvailable) return;
    this.isNetworkAvailable = isAvailable;
    if (!isAvailable) {
      this.pause();
      this.update({
        recoveryMessage: '인터넷 연결이 끊겼어요. 연결 후 음악 상태를 다시 확인해요.',
      });
    } else this.connect(this.session, this.transportReady);
  }
  recover() {
    if (!this.owns()) return;
    this.readFailures = 0;
    clearTimeout(this.readRetry);
    this.readRetry = undefined;
    this.update({
      recoveryStatus: 'recovering',
      recoveryMessage: '최신 음악 상태를 다시 확인하고 있어요.',
      playback: null,
      isQueueStale: true,
    });
    if (!this.queueRequest) void this.loadQueue();
  }
  private armWatchdog() {
    clearTimeout(this.watchdog);
    if (!this.owns() || this.state.recoveryStatus !== 'ready') return;
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined;
      if (this.queueRequest) this.armWatchdog();
      else this.recover();
    }, 15000);
  }
  private readFailed(error: unknown) {
    clearTimeout(this.watchdog);
    clearTimeout(this.readRetry);
    this.readRetry = undefined;
    const denied = error instanceof ChatMusicError && [401, 403, 404].includes(error.status ?? 0);
    this.readFailures++;
    const canRetry = !denied && this.readFailures <= 3;
    this.update({
      playback: null,
      isQueueStale: true,
      recoveryStatus: denied ? 'denied' : canRetry ? 'recovering' : 'error',
      recoveryMessage: denied
        ? '현재 이야기방 참여와 음악 이용 권한을 확인해 주세요.'
        : canRetry
          ? '음악 상태를 확인하지 못했어요. 잠시 후 다시 확인해요.'
          : '음악 연결을 복구하지 못했어요. 다시 확인해 주세요.',
    });
    if (canRetry)
      this.readRetry = setTimeout(
        () => {
          this.readRetry = undefined;
          if (this.owns()) void this.loadQueue(false, false);
        },
        1000 * 2 ** (this.readFailures - 1) + Math.floor(Math.random() * 250),
      );
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
      this.state.recoveryStatus === 'denied' ||
      event.roomId !== this.session.roomId ||
      (this.epoch !== undefined && event.epoch !== this.epoch) ||
      event.version < this.maxVersion
    )
      return;
    if (this.state.recoveryStatus === 'ready') this.acceptPlayback(event.playback);
    if (Date.parse(event.playback.serverTime) > this.lastEventTime) {
      this.lastEventTime = Date.parse(event.playback.serverTime);
      this.armWatchdog();
    }
    this.epoch = event.epoch;
    this.maxVersion = event.version;
    if (
      this.state.recoveryStatus !== 'ready' ||
      !this.state.queue ||
      this.state.queue.version < event.version
    ) {
      this.update({ isQueueStale: true });
      if (this.queueRequest) this.refreshAgain = true;
      else if (!this.readRetry && this.state.recoveryStatus !== 'error') this.scheduleRefresh();
    }
  }
  private acceptPlayback(snapshot: MusicPlayback) {
    const old = this.state.playback?.snapshot;
    if (
      snapshot.version < this.maxVersion ||
      (old &&
        (snapshot.version < old.version ||
          (snapshot.version === old.version &&
            Date.parse(snapshot.serverTime) <= Date.parse(old.serverTime))))
    )
      return;
    this.update({ playback: { snapshot, receivedAt: performance.now() } });
  }
  control(action: PlaybackAction) {
    const snapshot = this.state.playback?.snapshot;
    if (!this.canMutate() || !snapshot || snapshot.version < this.maxVersion) return;
    const allowed =
      action === 'PLAY'
        ? snapshot.state === 'IDLE'
        : action === 'PAUSE'
          ? snapshot.state === 'PLAYING'
          : action === 'RESUME'
            ? snapshot.state === 'PAUSED'
            : snapshot.current !== null;
    if (!allowed) return;
    void this.runMutation({
      id: crypto.randomUUID(),
      kind: 'playback',
      action,
      queueItemId: snapshot.current?.queueItemId ?? null,
      expectedVersion: snapshot.version,
      label: '공동 재생',
    });
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
    clearTimeout(this.readRetry);
    this.readRetry = undefined;
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
      if (page.epoch !== undefined) {
        if (this.epoch !== undefined && this.epoch !== page.epoch)
          throw new ChatMusicError(409, 'EPOCH_CHANGED');
        this.epoch = page.epoch;
      }
      if (cursor && (!previous || page.version !== previous.version))
        throw new ChatMusicError(409, 'QUEUE_CHANGED');
      if (
        (page.nextCursor &&
          (page.nextCursor === cursor || this.queueCursors.has(page.nextCursor))) ||
        (page.items.length === 0 && page.nextCursor)
      )
        throw new ChatMusicError(502, 'INVALID_RESPONSE');
      if (this.state.queue && page.version < this.state.queue.version)
        throw new ChatMusicError(409, 'QUEUE_CHANGED');
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
      if (!isStale) {
        this.maxVersion = Math.max(this.maxVersion, page.version);
        this.readFailures = 0;
        this.update({ recoveryStatus: 'ready', recoveryMessage: '' });
        this.acceptPlayback(page);
        this.armWatchdog();
      }
      this.update({
        queue: {
          ...page,
          items: more && previous ? [...previous.items, ...page.items] : page.items,
        },
        isQueueStale: isStale,
        queueError: isStale ? '대기열이 바뀌었어요. 최신 목록을 다시 확인해 주세요.' : '',
      });
      if (isStale) this.readFailed(new ChatMusicError(409, 'QUEUE_CHANGED'));
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
      this.readFailed(error);
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
          if (retry && !this.readRetry) this.scheduleRefresh();
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
    if (
      this.owns() &&
      this.state.recoveryStatus === 'ready' &&
      this.state.pending &&
      !this.state.isMutating &&
      !this.state.isCoolingDown
    )
      void this.runMutation(this.state.pending);
  }
  private canMutate() {
    return (
      this.owns() &&
      this.state.recoveryStatus === 'ready' &&
      !this.state.pending &&
      !this.state.isCoolingDown
    );
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
          mutation.kind === 'playback'
            ? '공동 재생 요청을 확인했어요.'
            : mutation.kind === 'cancel'
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
      if (
        uncertain ||
        (error instanceof ChatMusicError && [401, 403, 404].includes(error.status ?? 0))
      ) {
        this.recover();
      }
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
