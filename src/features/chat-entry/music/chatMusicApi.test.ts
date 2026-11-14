import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthRequestError,
  authenticatedFetchWithCurrentToken,
} from '../../auth-login/api/authSession';
import {
  ChatMusicError,
  fetchMusicQueue,
  mutateMusicQueue,
  searchChatMusic,
  searchMusicVideos,
} from './chatMusicApi';
import {
  added,
  candidate,
  videoPage,
  musicResponse,
  musicSession,
  musicToken,
  queuePage,
} from './chatMusicTestHelpers';
import { parseMusicEvent, parseMusicQueue, parseRequestableMusic } from './chatMusicTypes';
import { musicEvent } from './chatMusicTestHelpers';

const auth = vi.hoisted(() => ({ token: '' }));
vi.mock('../../auth-login/api/authSession', async (original) => ({
  ...(await original<typeof import('../../auth-login/api/authSession')>()),
  getAccessToken: () => auth.token,
  authenticatedFetchWithCurrentToken: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  auth.token = musicToken();
});
const signal = () => new AbortController().signal;

describe('music API contract and session ownership', () => {
  it('binds all paths to room/member/view, latest same-sid token and no-store', async () => {
    const session = musicSession();
    auth.token = musicToken(undefined, 2);
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(
      musicResponse({ items: [candidate()], next_cursor: null }),
    );
    const result = await searchChatMusic(session, '윤하 & 빛', null, signal());
    expect(result.items[0].sources).toEqual(['RECORDED', 'RECOMMENDED']);
    const [path, init, token] = vi.mocked(authenticatedFetchWithCurrentToken).mock.calls[0];
    const url = new URL(String(path), 'http://localhost');
    expect(url.pathname).toBe('/api/v1/chat-rooms/700/requestable-music');
    expect(url.searchParams.get('query')).toBe('윤하 & 빛');
    expect(url.searchParams.get('membership_id')).toBe('900');
    expect(url.searchParams.get('view_session_id')).toBe(session.viewSessionId);
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'include' });
    expect(token).toBe(auth.token);
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse(queuePage()));
    expect((await fetchMusicQueue(session, 'signed cursor', signal())).version).toBe(1);
  });
  it('sends original UUID/body/version and accepts empty204 and immediate PLAYING', async () => {
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(
      musicResponse(added(1, 'PLAYING'), 201),
    );
    const add = { id: crypto.randomUUID(), kind: 'add' as const, musicId: 1, label: '노래' };
    expect(await mutateMusicQueue(musicSession(), add, signal())).toBe('PLAYING');
    expect(vi.mocked(authenticatedFetchWithCurrentToken).mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'Idempotency-Key': add.id },
      body: '{"music_id":1}',
    });
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse(null, 204));
    const cancel = {
      id: crypto.randomUUID(),
      kind: 'cancel' as const,
      queueItemId: 9,
      expectedVersion: 4,
      label: '남의 곡',
    };
    await mutateMusicQueue(musicSession(), cancel, signal());
    const [path, init] = vi.mocked(authenticatedFetchWithCurrentToken).mock.calls[1];
    expect(String(path)).toContain('queue-items/9?');
    expect(String(path)).toContain('expected_version=4');
    expect(init).toMatchObject({ method: 'DELETE', headers: { 'Idempotency-Key': cancel.id } });
  });
  it('does not dispatch into another sid and never automatically replays sent requests', async () => {
    auth.token = musicToken('550e8400-e29b-41d4-a716-446655440099');
    await expect(fetchMusicQueue(musicSession(), null, signal())).rejects.toBeInstanceOf(
      ChatMusicError,
    );
    expect(authenticatedFetchWithCurrentToken).not.toHaveBeenCalled();
    auth.token = musicToken();
    vi.mocked(authenticatedFetchWithCurrentToken).mockRejectedValue(
      new AuthRequestError(null, true),
    );
    await expect(
      mutateMusicQueue(
        musicSession(),
        { id: crypto.randomUUID(), kind: 'add', musicId: 1, label: '노래' },
        signal(),
      ),
    ).rejects.toMatchObject({ isUncertain: true });
    expect(authenticatedFetchWithCurrentToken).toHaveBeenCalledTimes(1);
  });
  it('maps custom failures and Retry-After, treats malformed success as uncertain', async () => {
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(
      musicResponse({ code: 'QUEUE_FULL' }, 409),
    );
    await expect(
      mutateMusicQueue(
        musicSession(),
        { id: crypto.randomUUID(), kind: 'add', musicId: 1, label: '노래' },
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'QUEUE_FULL', isUncertain: false });
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(
      musicResponse({ code: 'COMMAND_RATE_LIMITED' }, 429, { 'Retry-After': '3' }),
    );
    await expect(fetchMusicQueue(musicSession(), null, signal())).rejects.toMatchObject({
      retryAfter: 3,
    });
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse({}, 201));
    await expect(
      mutateMusicQueue(
        musicSession(),
        { id: crypto.randomUUID(), kind: 'add', musicId: 1, label: '노래' },
        signal(),
      ),
    ).rejects.toMatchObject({ isUncertain: true, code: 'INVALID_RESPONSE' });
  });
});
describe('bounded music payload parsing', () => {
  it('rejects unsafe numbers, mixed states, duplicate IDs and unknown provenance', () => {
    expect(
      parseRequestableMusic({ items: [candidate(1), candidate(1)], next_cursor: null }),
    ).toBeNull();
    expect(
      parseRequestableMusic({
        items: [{ ...candidate(), music_id: Number.MAX_SAFE_INTEGER + 1 }],
        next_cursor: null,
      }),
    ).toBeNull();
    expect(
      parseRequestableMusic({
        items: [{ ...candidate(), sources: ['PUBLIC_RECOMMENDATION'] }],
        next_cursor: null,
      }),
    ).toBeNull();
    expect(parseMusicQueue({ ...queuePage(), items: [queuePage().current] })).toBeNull();
    expect(parseMusicQueue({ ...queuePage(), state: 'IDLE' })).toBeNull();
    expect(parseMusicQueue({ ...queuePage(), state: ['PLAYING'] })).toBeNull();
  });
  it('accepts equal-version queue/playback/sync but rejects malformed or future references', () => {
    for (const type of ['QUEUE_UPDATED', 'PLAYBACK_UPDATED', 'PLAYBACK_SYNC'])
      expect(parseMusicEvent(musicEvent(2, type))?.version).toBe(2);
    const event = musicEvent();
    expect(parseMusicEvent({ ...event, data: { ...event.data, event_version: 3 } })).toBeNull();
    expect(parseMusicEvent({ ...event, type: ['QUEUE_UPDATED'] })).toBeNull();
    expect(
      parseMusicEvent({ ...event, data: { ...event.data, playback: queuePage(1) } }),
    ).toBeNull();
  });
});

it('posts playback action with original current-item/version and validates replay snapshots', async () => {
  vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse(queuePage(4)));
  const command = {
    id: crypto.randomUUID(),
    kind: 'playback' as const,
    action: 'PAUSE' as const,
    queueItemId: 99,
    expectedVersion: 3,
    label: '공동 재생',
  };
  await mutateMusicQueue(musicSession(), command, signal());
  const [path, init] = vi.mocked(authenticatedFetchWithCurrentToken).mock.calls[0];
  expect(String(path)).toContain('/playback/commands?membership_id=900');
  expect(init).toMatchObject({
    method: 'POST',
    headers: { 'Idempotency-Key': command.id },
    body: JSON.stringify({ action: 'PAUSE', queue_item_id: 99, expected_version: 3 }),
  });
  vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(
    musicResponse({ state: 'PAUSED' }),
  );
  await expect(mutateMusicQueue(musicSession(), command, signal())).rejects.toMatchObject({
    isUncertain: true,
  });
});

it('rejects mismatched pinned item/source and unsafe duration without guessing a playable source', () => {
  const pinned = {
    ...queuePage(),
    source_video_id: 'abcdefghijk',
    current_queue_item_id: 99,
    duration_millis: 120000,
  };
  expect(parseMusicQueue(pinned)?.sourceVideoId).toBe('abcdefghijk');
  expect(parseMusicQueue({ ...pinned, current_queue_item_id: 98 })).toBeNull();
  expect(parseMusicQueue({ ...pinned, source_video_id: 'different11' })).toBeNull();
  expect(parseMusicQueue({ ...pinned, duration_millis: Number.MAX_SAFE_INTEGER })).toBeNull();
  expect(parseMusicQueue(queuePage())?.sourceVideoId).toBeNull();
});

describe('regional video selection contract', () => {
  it('accepts a regional song without video and keeps invalid metadata fail closed', async () => {
    const row = {
      ...candidate(),
      youtube_video_id: null,
      duration_millis: null,
      is_queueable: false,
    };
    expect(parseRequestableMusic({ items: [row], next_cursor: null })?.items[0]).toMatchObject({
      youtubeVideoId: null,
      durationMillis: null,
      isQueueable: false,
    });
    expect(
      parseRequestableMusic({ items: [{ ...row, youtube_video_id: 'bad' }], next_cursor: null }),
    ).toBeNull();
    const page = videoPage();
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse(page));
    expect((await searchMusicVideos(musicSession(), 1, signal())).items).toHaveLength(2);
    expect(String(vi.mocked(authenticatedFetchWithCurrentToken).mock.calls[0][0])).toContain(
      '/music/1/video-searches?',
    );
    expect(vi.mocked(authenticatedFetchWithCurrentToken).mock.calls[0][1]).toMatchObject({
      method: 'POST',
      cache: 'no-store',
    });
    for (const bad of [
      { ...page, music_id: 2 },
      { ...page, items: [page.items[0], page.items[0]] },
      { ...page, items: [{ ...page.items[0], official_status: 'VERIFIED' }] },
    ]) {
      vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse(bad));
      await expect(searchMusicVideos(musicSession(), 1, signal())).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });
  it('pins candidate in the original UUID body and distinguishes precommit verification failures', async () => {
    const mutation = {
      id: crypto.randomUUID(),
      kind: 'add' as const,
      musicId: 1,
      candidateId: videoPage().items[0].candidate_id,
      label: '곡',
    };
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(
      musicResponse(added(), 201),
    );
    await mutateMusicQueue(musicSession(), mutation, signal());
    expect(
      JSON.parse(String(vi.mocked(authenticatedFetchWithCurrentToken).mock.calls[0][1]?.body)),
    ).toEqual({ music_id: 1, candidate_id: mutation.candidateId });
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(
      musicResponse({ code: 'VIDEO_VERIFICATION_REQUIRED' }, 503),
    );
    await expect(mutateMusicQueue(musicSession(), mutation, signal())).rejects.toMatchObject({
      isUncertain: false,
    });
  });
});

it('accepts all fifty video candidates and rejects fifty-one or duplicates', async () => {
  const page = videoPage(1, 50);
  vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse(page));
  const parsed = await searchMusicVideos(musicSession(), 1, signal());
  expect(parsed.items).toHaveLength(50);
  expect(parsed.items[49].title).toBe('영상 50');
  for (const invalid of [
    videoPage(1, 51),
    { ...page, items: [...page.items.slice(0, 49), page.items[0]] },
  ]) {
    vi.mocked(authenticatedFetchWithCurrentToken).mockResolvedValueOnce(musicResponse(invalid));
    await expect(searchMusicVideos(musicSession(), 1, signal())).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  }
});
