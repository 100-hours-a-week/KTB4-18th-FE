import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAccessToken, setAccessToken } from '../features/auth-login/api/authSession';
import {
  ChatRoomRequestError,
  getRegionChatRoom,
  joinChatRoom,
  leaveChatRoom,
  leaveChatRoomForRegionChange,
} from './chatRooms';

function accessToken(sub: string, sid: string) {
  const payload = btoa(JSON.stringify({ sub, sid }));
  return `header.${payload}.signature`;
}

describe('chat room API', () => {
  beforeEach(() => setAccessToken('access-token'));
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('503은 서비스 재시도를 안내하고 로그인을 유지한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ message: 'chat authentication service unavailable', data: null }),
            { status: 503 },
          ),
        ),
    );
    await expect(getRegionChatRoom(25, new AbortController().signal)).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('일시 중단'),
      isBanned: false,
    });
    expect(getAccessToken()).toBe('access-token');
  });

  it('현재 행정구역 채팅방을 조회한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'chat room retrieved',
          data: {
            room_id: 700,
            region_id: 25,
            region_name: '성남시 분당구',
            capacity: 1000,
            status: 'ACTIVE',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const room = await getRegionChatRoom(25, new AbortController().signal);

    expect(room).toEqual({
      roomId: 700,
      regionId: 25,
      regionName: '성남시 분당구',
      capacity: 1000,
      status: 'ACTIVE',
    });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/regions/25/chat-room');
    expect(options.method).toBe('GET');
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer access-token');
  });

  it.each([200, 201])('%i 응답에서 membership을 저장 가능한 형태로 반환한다', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: status === 200 ? 'already joined' : 'chat room joined',
          data: {
            membership_id: 900,
            room_id: 700,
            region_id: 25,
            joined_at: '2026-09-23T08:00:00Z',
            view_session_id: '11111111-1111-4111-8111-111111111111',
          },
        }),
        { status, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const membership = await joinChatRoom(700, 'location-token', new AbortController().signal);

    expect(membership).toEqual({
      membershipId: 900,
      roomId: 700,
      regionId: 25,
      joinedAt: '2026-09-23T08:00:00Z',
      viewSessionId: '11111111-1111-4111-8111-111111111111',
    });
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string)).toEqual({
      location_resolution_token: 'location-token',
    });
  });

  it('정원 초과 응답을 사용자가 복구할 수 있는 안내로 변환한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'chat room capacity exceeded', data: null }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const error = await joinChatRoom(700, 'location-token', new AbortController().signal).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ChatRoomRequestError);
    expect(error).toMatchObject({ status: 409 });
    expect((error as Error).message).toContain('정원이 가득');
  });

  it.each([
    ['expired location resolution token', '만료'],
    ['location token region mismatch', '현재 지역과 일치하지 않습니다'],
  ])('위치 토큰 오류 %s를 구분하여 안내한다', async (message, expectedMessage) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message, data: null }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const error = await joinChatRoom(700, 'location-token', new AbortController().signal).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ChatRoomRequestError);
    expect((error as Error).message).toContain(expectedMessage);
  });

  it('네트워크 실패를 재시도 안내로 변환한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));

    const error = await getRegionChatRoom(25, new AbortController().signal).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ChatRoomRequestError);
    expect(error).toMatchObject({ status: null });
    expect((error as Error).message).toContain('연결 상태');
  });
  it('퇴장은 참여 이력 ID와 캡처한 계정 토큰을 보내고 204를 처리한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const currentToken = accessToken('user-1', 'session-1');
    setAccessToken(currentToken);
    await leaveChatRoom(
      {
        membershipId: 900,
        roomId: 700,
        regionId: 25,
        joinedAt: '2026-10-07T00:00:00Z',
        viewSessionId: '11111111-1111-4111-8111-111111111111',
      },
      accessToken('user-1', 'session-1'),
    );
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      '/api/v1/chat-rooms/700/members/me?membership_id=900&view_session_id=11111111-1111-4111-8111-111111111111',
    );
    expect(options).toMatchObject({ method: 'DELETE', keepalive: true });
    expect(new Headers(options.headers).get('Authorization')).toBe(`Bearer ${currentToken}`);
  });

  it('지역 이동 퇴장은 확인한 위치 증명을 별도 경로로 전달한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const token = accessToken('7', 'session-1');
    setAccessToken(token);
    await leaveChatRoomForRegionChange(
      {
        membershipId: 900,
        roomId: 700,
        regionId: 25,
        joinedAt: '2026-10-07T00:00:00Z',
        viewSessionId: '11111111-1111-4111-8111-111111111111',
      },
      'confirmed-location',
      token,
    );
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/chat-rooms/700/region-departures?membership_id=900');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({
      location_resolution_token: 'confirmed-location',
    });
  });

  it('탭 식별자가 없는 입장 응답은 사용하지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              membership_id: 900,
              room_id: 700,
              region_id: 25,
              joined_at: '2026-10-07T00:00:00Z',
            },
          }),
          { status: 201 },
        ),
      ),
    );
    await expect(joinChatRoom(700, 'location', new AbortController().signal)).rejects.toMatchObject(
      { status: 502 },
    );
  });

  it('제재된 계정의 403 응답은 일반 권한 오류와 구분한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: 'chat use banned' }), { status: 403 }),
        ),
    );
    await expect(
      joinChatRoom(700, 'location-token', new AbortController().signal),
    ).rejects.toMatchObject({ isBanned: true, status: 403 });
  });
});
