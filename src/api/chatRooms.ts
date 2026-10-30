import { chatSessionFetch } from '../features/chat-entry/services/chatSessionFetch';
import {
  AuthRequestError,
  authenticatedFetch,
  authenticatedFetchWithCurrentToken,
  getAccessToken,
} from '../features/auth-login/api/authSession';

import { chatBanNotice } from '../features/chat-entry/services/chatMessages';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

interface ApiBody<T> {
  message?: string;
  data?: T | null;
}

interface ChatRoomBody {
  room_id?: number;
  region_id?: number;
  region_name?: string;
  capacity?: number;
  status?: string;
}

interface ChatRoomMembershipBody {
  membership_id?: number;
  room_id?: number;
  region_id?: number;
  joined_at?: string;
  view_session_id?: string;
}

export interface ChatRoomSummary {
  roomId: number;
  regionId: number;
  regionName: string;
  capacity: number;
  status: string;
}

export interface ChatRoomMembership {
  membershipId: number;
  roomId: number;
  regionId: number;
  joinedAt: string;
  viewSessionId: string;
}

export class ChatRoomRequestError extends Error {
  readonly status: number | null;
  readonly isBanned: boolean;

  constructor(message: string, status: number | null, isBanned = false) {
    super(message);
    this.name = 'ChatRoomRequestError';
    this.status = status;
    this.isBanned = isBanned;
  }
}

function errorMessage(status: number, serverMessage?: string) {
  switch (status) {
    case 400: {
      const normalizedMessage = serverMessage?.toLowerCase() ?? '';
      if (normalizedMessage.includes('mismatch') || normalizedMessage.includes('region')) {
        return '요청한 이야기방이 현재 지역과 일치하지 않습니다. 위치를 다시 확인해 주세요.';
      }
      if (normalizedMessage.includes('expired')) {
        return '위치 정보가 만료되었습니다. 현재 위치를 다시 확인해 주세요.';
      }
      return '위치 정보를 확인할 수 없습니다. 현재 위치를 다시 확인해 주세요.';
    }
    case 401:
      return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
    case 403:
      if (serverMessage === 'chat use banned')
        return '동네 이야기 이용이 일주일간 제한되어 입장할 수 없습니다.';
      return '현재 계정은 이야기방을 이용할 수 없습니다.';
    case 404:
      return '현재 지역의 이야기방을 찾지 못했습니다.';
    case 409:
      return '현재 지역 이야기방의 정원이 가득 찼습니다. 잠시 후 다시 시도해 주세요.';
    case 503:
      return '채팅 서비스가 일시 중단됐어요. 잠시 후 다시 시도해 주세요.';
    default:
      return serverMessage ?? '이야기방에 입장하지 못했습니다. 다시 시도해 주세요.';
  }
}

async function request<T>(
  url: string,
  options: RequestInit,
  ownerToken?: string,
): Promise<ApiBody<T>> {
  let response: Response;
  try {
    const init = { ...options, credentials: 'include' as const };
    response = ownerToken
      ? await chatSessionFetch(`${baseUrl}${url}`, init, ownerToken)
      : await authenticatedFetch(`${baseUrl}${url}`, init);
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') {
      throw caught;
    }
    if (caught instanceof AuthRequestError) {
      throw new ChatRoomRequestError(
        caught.status === null
          ? '로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.'
          : errorMessage(caught.status),
        caught.status,
      );
    }
    throw new ChatRoomRequestError(
      '서버에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.',
      null,
    );
  }

  const body = (await response.json().catch(() => null)) as ApiBody<T> | null;
  if (!response.ok) {
    const errorData: unknown = body?.data;
    const bannedUntil =
      errorData &&
      typeof errorData === 'object' &&
      'banned_until' in errorData &&
      typeof errorData.banned_until === 'string'
        ? errorData.banned_until
        : undefined;
    throw new ChatRoomRequestError(
      response.status === 403 && body?.message === 'chat use banned'
        ? chatBanNotice(bannedUntil)
        : errorMessage(response.status, body?.message),
      response.status,
      response.status === 403 && body?.message === 'chat use banned',
    );
  }
  if (!body) {
    throw new ChatRoomRequestError('이야기방 응답을 확인할 수 없습니다.', 502);
  }
  return body;
}

export async function getRegionChatRoom(
  regionId: number,
  signal: AbortSignal,
): Promise<ChatRoomSummary> {
  const body = await request<ChatRoomBody>(`/api/v1/regions/${regionId}/chat-room`, {
    method: 'GET',
    signal,
  });
  const data = body.data;
  if (
    typeof data?.room_id !== 'number' ||
    typeof data.region_id !== 'number' ||
    typeof data.region_name !== 'string' ||
    typeof data.capacity !== 'number' ||
    typeof data.status !== 'string'
  ) {
    throw new ChatRoomRequestError('이야기방 정보를 확인할 수 없습니다.', 502);
  }

  return {
    roomId: data.room_id,
    regionId: data.region_id,
    regionName: data.region_name,
    capacity: data.capacity,
    status: data.status,
  };
}

export async function joinChatRoom(
  roomId: number,
  locationResolutionToken: string,
  signal: AbortSignal,
  ownerToken?: string,
): Promise<ChatRoomMembership> {
  const body = await request<ChatRoomMembershipBody>(
    `/api/v1/chat-rooms/${roomId}/members`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ location_resolution_token: locationResolutionToken }),
      signal,
    },
    ownerToken,
  );
  const data = body.data;
  if (
    typeof data?.membership_id !== 'number' ||
    typeof data.room_id !== 'number' ||
    typeof data.region_id !== 'number' ||
    typeof data.joined_at !== 'string' ||
    typeof data.view_session_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(data.view_session_id)
  ) {
    throw new ChatRoomRequestError('이야기방 입장 결과를 확인할 수 없습니다.', 502);
  }

  return {
    membershipId: data.membership_id,
    roomId: data.room_id,
    regionId: data.region_id,
    joinedAt: data.joined_at,
    viewSessionId: data.view_session_id,
  };
}

// Capture the joining account's token; teardown must never refresh as another account.
export async function leaveChatRoom(membership: ChatRoomMembership, token = getAccessToken()) {
  return departChatRoom(membership, token);
}

export async function leaveChatRoomForRegionChange(
  membership: ChatRoomMembership,
  locationResolutionToken: string,
  token = getAccessToken(),
) {
  return departChatRoom(membership, token, locationResolutionToken);
}

async function departChatRoom(
  membership: ChatRoomMembership,
  token: string | null,
  locationResolutionToken?: string,
) {
  if (!token) return;
  const current = getAccessToken();
  if (!current) return;
  try {
    const identity = (value: string) =>
      JSON.parse(atob(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
        sub?: string;
        sid?: string;
      };
    const previous = identity(token);
    const next = identity(current);
    if (!previous.sub || previous.sub !== next.sub || previous.sid !== next.sid) return;
    token = current;
  } catch {
    return;
  }
  const path = locationResolutionToken
    ? `/api/v1/chat-rooms/${membership.roomId}/region-departures?membership_id=${membership.membershipId}`
    : `/api/v1/chat-rooms/${membership.roomId}/members/me?membership_id=${membership.membershipId}&view_session_id=${encodeURIComponent(membership.viewSessionId)}`;
  const response = await authenticatedFetchWithCurrentToken(
    `${baseUrl}${path}`,
    {
      method: locationResolutionToken ? 'POST' : 'DELETE',
      ...(locationResolutionToken
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ location_resolution_token: locationResolutionToken }),
          }
        : {}),
      credentials: 'include',
      keepalive: true,
    },
    token,
  );
  if (!response.ok && response.status !== 401 && response.status !== 403) {
    throw new ChatRoomRequestError(
      '이야기방 퇴장을 확인하지 못했습니다. 다시 시도해 주세요.',
      response.status,
    );
  }
}
