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
}

export class ChatRoomRequestError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'ChatRoomRequestError';
    this.status = status;
  }
}

function errorMessage(status: number, serverMessage?: string) {
  switch (status) {
    case 400: {
      const normalizedMessage = serverMessage?.toLowerCase() ?? '';
      if (normalizedMessage.includes('mismatch') || normalizedMessage.includes('region')) {
        return '요청한 채팅방이 현재 지역과 일치하지 않습니다. 위치를 다시 확인해 주세요.';
      }
      if (normalizedMessage.includes('expired')) {
        return '위치 정보가 만료되었습니다. 현재 위치를 다시 확인해 주세요.';
      }
      return '위치 정보를 확인할 수 없습니다. 현재 위치를 다시 확인해 주세요.';
    }
    case 401:
      return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
    case 403:
      return '현재 계정은 채팅방을 이용할 수 없습니다.';
    case 404:
      return '현재 지역의 채팅방을 찾지 못했습니다.';
    case 409:
      return '현재 지역 채팅방의 정원이 가득 찼습니다. 잠시 후 다시 시도해 주세요.';
    default:
      return serverMessage ?? '채팅방에 입장하지 못했습니다. 다시 시도해 주세요.';
  }
}

async function request<T>(url: string, options: RequestInit): Promise<ApiBody<T>> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${url}`, {
      ...options,
      credentials: 'include',
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') {
      throw caught;
    }
    throw new ChatRoomRequestError(
      '서버에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.',
      null,
    );
  }

  const body = (await response.json().catch(() => null)) as ApiBody<T> | null;
  if (!response.ok) {
    throw new ChatRoomRequestError(errorMessage(response.status, body?.message), response.status);
  }
  if (!body) {
    throw new ChatRoomRequestError('채팅방 응답을 확인할 수 없습니다.', 502);
  }
  return body;
}

export async function getRegionChatRoom(
  regionId: number,
  accessToken: string,
  signal: AbortSignal,
): Promise<ChatRoomSummary> {
  const body = await request<ChatRoomBody>(`/api/v1/regions/${regionId}/chat-room`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
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
    throw new ChatRoomRequestError('채팅방 정보를 확인할 수 없습니다.', 502);
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
  accessToken: string,
  signal: AbortSignal,
): Promise<ChatRoomMembership> {
  const body = await request<ChatRoomMembershipBody>(`/api/v1/chat-rooms/${roomId}/members`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ location_resolution_token: locationResolutionToken }),
    signal,
  });
  const data = body.data;
  if (
    typeof data?.membership_id !== 'number' ||
    typeof data.room_id !== 'number' ||
    typeof data.region_id !== 'number' ||
    typeof data.joined_at !== 'string'
  ) {
    throw new ChatRoomRequestError('채팅방 입장 결과를 확인할 수 없습니다.', 502);
  }

  return {
    membershipId: data.membership_id,
    roomId: data.room_id,
    regionId: data.region_id,
    joinedAt: data.joined_at,
  };
}
