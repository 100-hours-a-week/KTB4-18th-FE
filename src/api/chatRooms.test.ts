import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ChatRoomRequestError,
  getRegionChatRoom,
  joinChatRoom,
} from './chatRooms';

describe('chat room API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
            capacity: 25,
            status: 'ACTIVE',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const room = await getRegionChatRoom(25, 'access-token', new AbortController().signal);

    expect(room).toEqual({
      roomId: 700,
      regionId: 25,
      regionName: '성남시 분당구',
      capacity: 25,
      status: 'ACTIVE',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/regions/25/chat-room',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer access-token' },
      }),
    );
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
          },
        }),
        { status, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const membership = await joinChatRoom(
      700,
      'location-token',
      'access-token',
      new AbortController().signal,
    );

    expect(membership).toEqual({
      membershipId: 900,
      roomId: 700,
      regionId: 25,
      joinedAt: '2026-09-23T08:00:00Z',
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

    const error = await joinChatRoom(
      700,
      'location-token',
      'access-token',
      new AbortController().signal,
    ).catch((caught: unknown) => caught);

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

    const error = await joinChatRoom(
      700,
      'location-token',
      'access-token',
      new AbortController().signal,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ChatRoomRequestError);
    expect((error as Error).message).toContain(expectedMessage);
  });

  it('네트워크 실패를 재시도 안내로 변환한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));

    const error = await getRegionChatRoom(
      25,
      'access-token',
      new AbortController().signal,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ChatRoomRequestError);
    expect(error).toMatchObject({ status: null });
    expect((error as Error).message).toContain('연결 상태');
  });
});
