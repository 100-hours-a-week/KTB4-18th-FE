import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { authenticatedFetchWithCurrentToken } from '../../auth-login/api/authSession';
import { ChatMusicQueueController } from './chatMusicQueueController';
import {
  musicResponse,
  musicSession,
  musicToken,
  musicEvent,
  queuePage,
  deferred,
} from './chatMusicTestHelpers';
import { parseMusicEvent } from './chatMusicTypes';
const auth = vi.hoisted(() => ({ token: '' }));
vi.mock('../../auth-login/api/authSession', async (original) => ({
  ...(await original<typeof import('../../auth-login/api/authSession')>()),
  getAccessToken: () => auth.token,
  authenticatedFetchWithCurrentToken: vi.fn(),
}));
let controller: ChatMusicQueueController;
const settle = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};
const fetcher = vi.mocked(authenticatedFetchWithCurrentToken);
const hint = (version: number, second: number) => {
  const wire = musicEvent(version, 'PLAYBACK_SYNC');
  wire.data.playback.server_time = `2026-11-09T05:00:${String(second).padStart(2, '0')}Z`;
  return parseMusicEvent(wire)!;
};
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  auth.token = musicToken();
  fetcher.mockImplementation(async () => musicResponse(queuePage()));
  controller = new ChatMusicQueueController(musicSession());
  controller.connect(musicSession(), true);
  await settle();
});
afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});
it('waits for fresh initial/reconnect snapshot, preserves pending UUID and never auto replays', async () => {
  fetcher.mockRejectedValueOnce(new TypeError('lost'));
  controller.control('PAUSE');
  await settle();
  const pending = controller.getSnapshot().pending;
  const read = deferred<Response>();
  fetcher.mockReturnValueOnce(read.promise);
  controller.connect({ ...musicSession(), generation: 2 }, false);
  controller.connect({ ...musicSession(), generation: 3 }, true);
  expect(controller.getSnapshot().playback).toBeNull();
  expect(controller.getSnapshot().recoveryStatus).toBe('loading');
  controller.retryMutation();
  expect(controller.getSnapshot().pending).toEqual(pending);
  read.resolve(musicResponse(queuePage(2)));
  await settle();
  expect(controller.getSnapshot().recoveryStatus).toBe('ready');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
it('uses SYNC to repair a missing change and watchdog GET to repair total silence', async () => {
  fetcher.mockImplementation(async () => musicResponse(queuePage(3)));
  controller.hint(hint(3, 5));
  await vi.advanceTimersByTimeAsync(201);
  expect(controller.getSnapshot().queue?.version).toBe(3);
  const calls = fetcher.mock.calls.length;
  controller.hint(hint(3, 10));
  await vi.advanceTimersByTimeAsync(14000);
  expect(fetcher).toHaveBeenCalledTimes(calls);
  await vi.advanceTimersByTimeAsync(1100);
  expect(fetcher).toHaveBeenCalledTimes(calls + 1);
  expect(controller.getSnapshot().recoveryStatus).toBe('ready');
});
it('suspends on failed read, retries at most3 times and only a manual check reopens an exhausted recovery', async () => {
  fetcher.mockImplementation(async () => musicResponse({ code: 'SERVICE_UNAVAILABLE' }, 503));
  controller.recover();
  await settle();
  expect(controller.getSnapshot().playback).toBeNull();
  expect(controller.getSnapshot().recoveryStatus).toBe('recovering');
  controller.control('SKIP');
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher).toHaveBeenCalledTimes(5); // initial + failed read + three retries
  expect(controller.getSnapshot().recoveryStatus).toBe('error');
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(5);
  fetcher.mockImplementation(async () => musicResponse(queuePage(4)));
  controller.recover();
  await settle();
  expect(controller.getSnapshot().recoveryStatus).toBe('ready');
  expect(controller.getSnapshot().queue?.version).toBe(4);
});
it('does not auto retry permission failures or accept a live event as reauthorization', async () => {
  fetcher.mockResolvedValueOnce(musicResponse({ code: 'CHAT_VIEW_NOT_CONNECTED' }, 403));
  controller.recover();
  await settle();
  const calls = fetcher.mock.calls.length;
  expect(controller.getSnapshot().recoveryStatus).toBe('denied');
  controller.hint(hint(9, 20));
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(controller.getSnapshot().playback).toBeNull();
});
it('keeps offline requests and callbacks fenced, revalidates online and drops old generation reads', async () => {
  const late = deferred<Response>();
  fetcher.mockReturnValueOnce(late.promise);
  const work = controller.loadQueue();
  controller.setNetworkAvailable(false);
  expect(controller.getSnapshot().playback).toBeNull();
  controller.control('PAUSE');
  controller.setNetworkAvailable(true);
  await settle();
  late.resolve(musicResponse(queuePage(100)));
  await work;
  expect(controller.getSnapshot().queue?.version).toBe(1);
  expect(controller.getSnapshot().recoveryStatus).toBe('ready');
  auth.token = musicToken('550e8400-e29b-41d4-a716-446655440099');
  const calls = fetcher.mock.calls.length;
  controller.recover();
  await vi.advanceTimersByTimeAsync(20000);
  expect(fetcher).toHaveBeenCalledTimes(calls);
});
it('coalesces recovery triggers and cancels all delayed work on disposal', async () => {
  const late = deferred<Response>();
  fetcher.mockReturnValueOnce(late.promise);
  controller.recover();
  controller.recover();
  const calls = fetcher.mock.calls.length;
  expect(fetcher).toHaveBeenCalledTimes(calls);
  controller.dispose();
  late.resolve(musicResponse(queuePage(7)));
  await settle();
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(controller.getSnapshot().playback).toBeNull();
});

it('pins REST epoch before the first event and rejects a different epoch until reconnect', async () => {
  fetcher.mockImplementation(async () => musicResponse({ ...queuePage(4), epoch: 2 }));
  controller.recover();
  await settle();
  controller.hint(hint(9, 20)); // old epoch1, cannot raise the version floor
  expect(controller.getSnapshot().playback?.snapshot.version).toBe(4);
  fetcher.mockImplementation(async () => musicResponse({ ...queuePage(5), epoch: 3 }));
  controller.recover();
  await settle();
  expect(controller.getSnapshot().playback).toBeNull();
  controller.connect({ ...musicSession(), generation: 2 }, true);
  await settle();
  expect(controller.getSnapshot().playback?.snapshot.version).toBe(5);
});
