// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ token: process.env.CHAT_REGION_TOKEN_A ?? '', sent: 0 }));
vi.mock('../../auth-login/api/authSession', () => {
  class AuthRequestError extends Error {
    status = null;
    requestWasSent = false;
  }
  const send = async (input: RequestInfo | URL, init: RequestInit, token: string) => {
    auth.sent += 1;
    return fetch(input, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        Origin: 'http://localhost:5174',
      },
    });
  };
  return {
    AuthRequestError,
    getAccessToken: () => auth.token,
    authenticatedFetch: (input: RequestInfo | URL, init: RequestInit) =>
      send(input, init, auth.token),
    authenticatedFetchWithCurrentToken: (
      input: RequestInfo | URL,
      init: RequestInit,
      token: string,
    ) => {
      if (auth.token !== token) throw new AuthRequestError();
      return send(input, init, token);
    },
  };
});

describe.skipIf(!process.env.CHAT_REGION_URL)('실제 서버의 기기별 지역 이동 API 연동', () => {
  it('한 sid의 이동과 지연된 요청이 다른 sid의 참여를 변경하지 않는다', async () => {
    vi.stubEnv('VITE_API_BASE_URL', process.env.CHAT_REGION_URL!);
    const { resolveLocation } = await import('../../../api/locationResolutions');
    const { getRegionChatRoom, joinChatRoom } = await import('../../../api/chatRooms');
    const signal = new AbortController().signal;
    const tokenA = process.env.CHAT_REGION_TOKEN_A!;
    const tokenB = process.env.CHAT_REGION_TOKEN_B!;
    const origin = Number(process.env.CHAT_REGION_ORIGIN);
    const destination = Number(process.env.CHAT_REGION_DESTINATION);
    const firstPosition = { latitude: 37.3595704, longitude: 127.105399, accuracyMeters: 10 };
    const nextPosition = { ...firstPosition, latitude: 37.3595705 };
    auth.token = tokenA;
    const locationA = await resolveLocation(firstPosition, signal, tokenA);
    const roomA = await getRegionChatRoom(locationA.region.sigungu.regionId, signal);
    expect(roomA.regionId).toBe(origin);
    const first = await joinChatRoom(
      roomA.roomId,
      locationA.locationResolutionToken,
      signal,
      tokenA,
    );
    auth.token = tokenB;
    const locationB = await resolveLocation(firstPosition, signal, tokenB);
    const second = await joinChatRoom(
      roomA.roomId,
      locationB.locationResolutionToken,
      signal,
      tokenB,
    );
    expect(second.membershipId).not.toBe(first.membershipId);
    const before = auth.sent;
    await expect(resolveLocation(nextPosition, signal, tokenA)).rejects.toThrow();
    expect(auth.sent).toBe(before);
    auth.token = tokenA;
    const confirmed = await resolveLocation(nextPosition, signal, tokenA);
    expect(confirmed.region.sigungu.regionId).toBe(destination);
    const roomB = await getRegionChatRoom(destination, signal);
    auth.token = tokenB;
    await expect(
      joinChatRoom(roomB.roomId, confirmed.locationResolutionToken, signal, tokenB),
    ).rejects.toMatchObject({ status: 400 });
    auth.token = tokenA;
    const moved = await joinChatRoom(
      roomB.roomId,
      confirmed.locationResolutionToken,
      signal,
      tokenA,
    );
    expect(moved.roomId).toBe(roomB.roomId);
    auth.token = tokenB;
    const stillHere = await joinChatRoom(
      roomA.roomId,
      locationB.locationResolutionToken,
      signal,
      tokenB,
    );
    expect(stillHere.membershipId).toBe(second.membershipId);
  });
});
