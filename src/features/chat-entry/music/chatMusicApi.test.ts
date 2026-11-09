import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthRequestError,
  authenticatedFetchWithCurrentToken,
} from '../../auth-login/api/authSession';
import { ChatMusicError, fetchMusicQueue, mutateMusicQueue, searchChatMusic } from './chatMusicApi';
import {
  added,
  candidate,
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
