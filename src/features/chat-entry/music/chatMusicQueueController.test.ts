import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetchWithCurrentToken } from '../../auth-login/api/authSession';
import { ChatMusicQueueController } from './chatMusicQueueController';
import {
  added,
  candidate,
  videoPage,
  deferred,
  musicEvent,
  musicResponse,
  musicSession,
  musicToken,
  queueItem,
  queuePage,
} from './chatMusicTestHelpers';
import { parseMusicEvent, parseRequestableMusic } from './chatMusicTypes';
const auth = vi.hoisted(() => ({ token: '' }));
vi.mock('../../auth-login/api/authSession', async (original) => ({
  ...(await original<typeof import('../../auth-login/api/authSession')>()),
  getAccessToken: () => auth.token,
  authenticatedFetchWithCurrentToken: vi.fn(),
}));
let controller: ChatMusicQueueController;
const settle = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
beforeEach(async () => {
  vi.resetAllMocks();
  auth.token = musicToken();
  vi.mocked(authenticatedFetchWithCurrentToken).mockImplementation(async () =>
    musicResponse(queuePage()),
  );
  controller = new ChatMusicQueueController(musicSession());
  controller.connect(musicSession(), true);
  await settle();
});
afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});
const song = () => parseRequestableMusic({ items: [candidate()], next_cursor: null })!.items[0];

describe('music queue state and concurrency', () => {
  it('keeps newer search and drops delayed results for another query or old generation', async () => {
    const old = deferred<Response>();
    vi.mocked(authenticatedFetchWithCurrentToken)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(musicResponse({ items: [candidate(2)], next_cursor: null }));
    const slow = controller.search('옛 검색');
    await controller.search('새 검색');
    old.resolve(musicResponse({ items: [candidate(1)], next_cursor: null }));
    await slow;
    expect(controller.getSnapshot().search?.items.map((x) => x.musicId)).toEqual([2]);
    const late = deferred<Response>();
    vi.mocked(authenticatedFetchWithCurrentToken).mockReturnValueOnce(late.promise);
    const pending = controller.search('다른 세대');
    controller.pause();
    late.resolve(musicResponse({ items: [candidate(3)], next_cursor: null }));
    await pending;
    expect(controller.getSnapshot().search).toBeNull();
  });
  it('does not accept a response after auth sid changes while a request is in flight', async () => {
    const late = deferred<Response>();
    vi.mocked(authenticatedFetchWithCurrentToken).mockReturnValueOnce(late.promise);
    const pending = controller.search('검색');
    auth.token = musicToken('550e8400-e29b-41d4-a716-446655440099');
    late.resolve(musicResponse({ items: [candidate()], next_cursor: null }));
    await pending;
    expect(controller.getSnapshot().search).toBeNull();
  });
  it('guards rapid double click and retries unknown ADD with exactly the same UUID', async () => {
    vi.mocked(authenticatedFetchWithCurrentToken).mockRejectedValueOnce(
      new TypeError('synthetic network'),
    );
    controller.add(song());
    controller.add(song());
    await settle();
    const first = vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.find(([, init]) => init?.method === 'POST')![1];
    expect(controller.getSnapshot().pending?.kind).toBe('add');
    expect(controller.getSnapshot().isMutating).toBe(false);
    vi.mocked(authenticatedFetchWithCurrentToken)
      .mockResolvedValueOnce(musicResponse(added(), 201))
      .mockResolvedValueOnce(musicResponse(queuePage(2)));
    controller.retryMutation();
    await settle();
    const writes = vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(writes).toHaveLength(2);
    expect(writes[1][1]?.headers).toEqual(first?.headers);
    expect(writes[1][1]?.body).toEqual(first?.body);
    expect(controller.getSnapshot().pending).toBeNull();
  });
  it('preserves uncertain cancellation tuple across reconnect without automatic mutation replay', async () => {
    const lost = deferred<Response>();
    vi.mocked(authenticatedFetchWithCurrentToken).mockReturnValueOnce(lost.promise);
    controller.cancel(controller.getSnapshot().queue!.items[0]);
    const original = controller.getSnapshot().pending!;
    controller.pause();
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(
      musicResponse(queuePage(3, [])),
    );
    controller.connect({ ...musicSession(), generation: 2 }, true);
    await settle();
    lost.resolve(musicResponse(null, 204));
    await settle();
    expect(controller.getSnapshot().pending).toEqual(original);
    expect(
      vi
        .mocked(authenticatedFetchWithCurrentToken)
        .mock.calls.filter(([, i]) => i?.method === 'DELETE'),
    ).toHaveLength(1);
    vi.mocked(authenticatedFetchWithCurrentToken)
      .mockResolvedValueOnce(musicResponse(null, 204))
      .mockResolvedValueOnce(musicResponse(queuePage(3, [])));
    controller.retryMutation();
    await settle();
    const writes = vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.filter(([, i]) => i?.method === 'DELETE');
    expect(writes[1][0]).toEqual(writes[0][0]);
    expect(writes[1][1]?.headers).toEqual(writes[0][1]?.headers);
    expect(controller.getSnapshot().pending).toBeNull();
  });
  it('restarts stale cursor once and never appends pages from a different queue version', async () => {
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(
      musicResponse(queuePage(1, [queueItem(1)], 'cursor1')),
    );
    await controller.loadQueue();
    vi.mocked(authenticatedFetchWithCurrentToken)
      .mockResolvedValueOnce(musicResponse({ code: 'QUEUE_CHANGED' }, 409))
      .mockResolvedValueOnce(musicResponse(queuePage(2, [queueItem(2)])));
    await controller.loadQueue(true);
    expect(controller.getSnapshot().queue?.items.map((x) => x.queueItemId)).toEqual([2]);
    expect(controller.getSnapshot().queue?.version).toBe(2);
  });
  it('coalesces hints and rejects old epochs and versions, allowing equal-version event pairs', async () => {
    vi.useFakeTimers();
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValue(
      musicResponse(queuePage(4, [queueItem(4)])),
    );
    const calls = vi.mocked(authenticatedFetchWithCurrentToken).mock.calls.length;
    for (let i = 0; i < 20; i++)
      controller.hint(
        parseMusicEvent(musicEvent(4, i % 2 ? 'QUEUE_UPDATED' : 'PLAYBACK_UPDATED'))!,
      );
    await vi.advanceTimersByTimeAsync(201);
    expect(vi.mocked(authenticatedFetchWithCurrentToken).mock.calls.length).toBe(calls + 1);
    expect(controller.getSnapshot().queue?.version).toBe(4);
    controller.hint(parseMusicEvent(musicEvent(2))!);
    controller.hint(parseMusicEvent(musicEvent(8, 'QUEUE_UPDATED', 2))!);
    await vi.advanceTimersByTimeAsync(201);
    expect(vi.mocked(authenticatedFetchWithCurrentToken).mock.calls.length).toBe(calls + 1);
  });
  it('respects Retry-After without auto-resubmission and refreshes on cancellation conflict', async () => {
    vi.useFakeTimers();
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(
      musicResponse({ code: 'COMMAND_RATE_LIMITED' }, 429, { 'Retry-After': '3' }),
    );
    controller.add(song());
    await settle();
    expect(controller.getSnapshot().isCoolingDown).toBe(true);
    controller.add(song());
    await settle();
    await vi.advanceTimersByTimeAsync(3001);
    expect(controller.getSnapshot().isCoolingDown).toBe(false);
    vi.mocked(authenticatedFetchWithCurrentToken)
      .mockResolvedValueOnce(musicResponse({ code: 'VERSION_CONFLICT' }, 409))
      .mockResolvedValueOnce(musicResponse(queuePage(2, [])));
    controller.cancel(controller.getSnapshot().queue!.items[0]);
    await settle();
    expect(controller.getSnapshot().pending).toBeNull();
    expect(controller.getSnapshot().queue?.items).toEqual([]);
  });
});

it('applies same-version newer sync, refuses stale snapshot regression and retains original playback tuple on retry', async () => {
  vi.useFakeTimers();
  const first = musicEvent(4, 'PLAYBACK_SYNC');
  controller.hint(parseMusicEvent(first)!);
  const newer = {
    ...first,
    data: {
      ...first.data,
      playback: { ...first.data.playback, server_time: '2026-11-09T05:00:10Z' },
    },
  };
  controller.hint(parseMusicEvent(newer)!);
  expect(controller.getSnapshot().playback?.snapshot.serverTime).toBe('2026-11-09T05:00:10Z');
  await controller.loadQueue();
  expect(controller.getSnapshot().playback).toBeNull();
  expect(controller.getSnapshot().recoveryStatus).toBe('recovering');
  vi.mocked(authenticatedFetchWithCurrentToken).mockImplementation(async () =>
    musicResponse({ ...queuePage(4), server_time: '2026-11-09T05:00:11Z' }),
  );
  controller.recover();
  await settle();
  expect(controller.getSnapshot().playback?.snapshot.version).toBe(4);
  vi.mocked(authenticatedFetchWithCurrentToken).mockRejectedValueOnce(new TypeError('lost'));
  controller.control('PAUSE');
  await settle();
  const pending = controller.getSnapshot().pending;
  expect(pending).toMatchObject({
    kind: 'playback',
    action: 'PAUSE',
    queueItemId: 99,
    expectedVersion: 4,
  });
  controller.control('SKIP');
  expect(controller.getSnapshot().pending).toEqual(pending);
  vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse(queuePage(5)));
  controller.retryMutation();
  await settle();
  const posts = vi
    .mocked(authenticatedFetchWithCurrentToken)
    .mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts[0][1]?.body).toEqual(posts[1][1]?.body);
  expect(posts[0][1]?.headers).toEqual(posts[1][1]?.headers);
  controller.pause();
  expect(controller.getSnapshot().playback).toBeNull();
});

describe('selected video request lifecycle', () => {
  it('drops video results after back navigation, another song, or disconnect', async () => {
    const late = deferred<Response>();
    vi.mocked(authenticatedFetchWithCurrentToken).mockReturnValueOnce(late.promise);
    const waiting = controller.selectSong(song());
    controller.cancelVideos();
    late.resolve(musicResponse(videoPage()));
    await waiting;
    expect(controller.getSnapshot().videos).toBeNull();
    expect(controller.getSnapshot().selectedSong).toBeNull();
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse(videoPage()));
    await controller.selectSong(song());
    expect(controller.getSnapshot().videos?.items).toHaveLength(2);
    controller.pause();
    expect(controller.getSnapshot().videos).toBeNull();
  });
  it('retries an uncertain selected ADD with its original candidate even after candidate expiry', async () => {
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse(videoPage()));
    await controller.selectSong(song());
    const selected = controller.getSnapshot().videos!.items[0];
    vi.mocked(authenticatedFetchWithCurrentToken).mockRejectedValueOnce(
      new TypeError('lost response'),
    );
    controller.add(song(), selected);
    await settle();
    const original = controller.getSnapshot().pending;
    expect(original).toMatchObject({ kind: 'add', candidateId: selected.candidateId });
    selected.expiresAt = '2020-01-01T00:00:00Z';
    vi.mocked(authenticatedFetchWithCurrentToken)
      .mockResolvedValueOnce(musicResponse(added(), 201))
      .mockResolvedValueOnce(musicResponse(queuePage(2)));
    controller.retryMutation();
    await settle();
    const writes = vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.filter(
        ([path, init]) => String(path).includes('queue-items') && init?.method === 'POST',
      );
    expect(writes).toHaveLength(2);
    expect(writes[0][1]?.body).toBe(writes[1][1]?.body);
    expect(writes[0][1]?.headers).toEqual(writes[1][1]?.headers);
  });
  it('refuses an expired candidate before sending and preserves the regional list on page failure', async () => {
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(
      musicResponse({ items: [candidate()], next_cursor: 'page-2' }),
    );
    await controller.search('');
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse(null, 503));
    await controller.search('', true);
    expect(controller.getSnapshot().search?.items).toHaveLength(1);
    expect(controller.getSnapshot().searchError).toBeTruthy();
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse(videoPage()));
    await controller.selectSong(song());
    const selected = controller.getSnapshot().videos!.items[0];
    selected.expiresAt = '2020-01-01T00:00:00Z';
    const before = vi.mocked(authenticatedFetchWithCurrentToken).mock.calls.length;
    controller.add(song(), selected);
    expect(vi.mocked(authenticatedFetchWithCurrentToken).mock.calls).toHaveLength(before);
    expect(controller.getSnapshot().videoError).toContain('기한');
    expect(controller.getSnapshot().pending).toBeNull();
  });
});

it('rejects late video results after a newer song or a changed auth sid', async () => {
  const late = deferred<Response>();
  vi.mocked(authenticatedFetchWithCurrentToken)
    .mockReturnValueOnce(late.promise)
    .mockResolvedValueOnce(musicResponse(videoPage(2)));
  const first = controller.selectSong(song());
  const secondSong = { ...song(), musicId: 2, title: '다른 지역 곡' };
  await controller.selectSong(secondSong);
  late.resolve(musicResponse(videoPage()));
  await first;
  expect(controller.getSnapshot().videos?.musicId).toBe(2);
  const old = deferred<Response>();
  vi.mocked(authenticatedFetchWithCurrentToken).mockReturnValueOnce(old.promise);
  const pending = controller.selectSong(song());
  auth.token = musicToken('550e8400-e29b-41d4-a716-446655440099');
  old.resolve(musicResponse(videoPage()));
  await pending;
  expect(controller.getSnapshot().videos).toBeNull();
});
it('keeps confirmed candidate expiry distinct from an uncertain write', async () => {
  vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse(videoPage()));
  await controller.selectSong(song());
  const selected = controller.getSnapshot().videos!.items[0];
  vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(
    musicResponse({ code: 'CANDIDATE_EXPIRED' }, 410),
  );
  controller.add(song(), selected);
  await settle();
  expect(controller.getSnapshot().pending).toBeNull();
  expect(controller.getSnapshot().videos).toBeNull();
  expect(controller.getSnapshot().videoError).toContain('기한');
});

it('keeps playback controls usable when the video provider daily budget is exhausted', async () => {
  vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(
    musicResponse({ code: 'VIDEO_REQUEST_RATE_LIMITED' }, 429, { 'Retry-After': '86400' }),
  );
  await controller.selectSong(song());
  expect(controller.getSnapshot().isVideoCoolingDown).toBe(true);
  expect(controller.getSnapshot().isCoolingDown).toBe(false);
  vi.mocked(authenticatedFetchWithCurrentToken).mockImplementation(async (path, init) =>
    String(path).includes('playback/commands') && init?.method === 'POST'
      ? musicResponse(queuePage(2))
      : musicResponse(queuePage(2)),
  );
  controller.control('PAUSE');
  await settle();
  expect(
    vi
      .mocked(authenticatedFetchWithCurrentToken)
      .mock.calls.some(
        ([path, init]) => String(path).includes('playback/commands') && init?.method === 'POST',
      ),
  ).toBe(true);
});
