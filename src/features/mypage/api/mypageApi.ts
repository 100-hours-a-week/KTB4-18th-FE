type ApiResponse<T> = {
  message: string;
  data: T;
};

export type UserProfile = {
  user_id: number;
  email: string;
  nickname: string;
  birth_year: number | null;
  gender: string | null;
  profile_image_url: string | null;
  created_at: string;
};

export type UserSettings = {
  map_visibility: 'PUBLIC' | 'PRIVATE';
  is_unrecorded_dot_recommendation_enabled: boolean;
};

type UpdatedUserSettings = UserSettings & {
  updated_at: string;
};

export type RecommendationHistoryItem = {
  rank_no: number;
  music_id: number;
  title: string;
  artist_name: string;
};

export type RecommendationHistory = {
  groups: Array<{
    date: string;
    recommendations: Array<{
      items: RecommendationHistoryItem[];
    }>;
  }>;
  next_cursor: string | null;
  has_next: boolean;
};

type CsrfResponse = { csrf_token: string };

export class MyPageRequestError extends Error {
  readonly status: number | null;
  readonly messageFromServer: string | null;

  constructor(status: number | null, messageFromServer: string | null = null) {
    super('My page request failed');
    this.status = status;
    this.messageFromServer = messageFromServer;
  }
}

function authorization(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

async function readError(response: Response): Promise<MyPageRequestError> {
  const payload = (await response.json().catch(() => null)) as ApiResponse<null> | null;
  return new MyPageRequestError(response.status, payload?.message ?? null);
}

async function request<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(
      `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}${path}`,
      {
        ...init,
        headers: { ...authorization(accessToken), ...init?.headers },
        credentials: 'include',
      },
    );
  } catch {
    throw new MyPageRequestError(null);
  }

  if (response.status === 401) {
    let refreshedAccessToken: string;
    try {
      refreshedAccessToken = await refreshAccessToken();
    } catch {
      // authSession dispatches the global expiry event for an expired refresh session.
      throw await readError(response);
    }
    return requestWithRefreshedToken(path, refreshedAccessToken, init);
  }

  if (!response.ok) {
    throw await readError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json()) as ApiResponse<T>;
  return payload.data;
}

async function requestWithRefreshedToken<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}${path}`,
      {
        ...init,
        headers: { ...authorization(accessToken), ...init?.headers },
        credentials: 'include',
      },
    );
  } catch {
    throw new MyPageRequestError(null);
  }
  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;
  return ((await response.json()) as ApiResponse<T>).data;
}

export async function issueCsrfToken(accessToken: string): Promise<string> {
  const data = await request<CsrfResponse>('/api/v1/auth/token/csrf', accessToken);
  return data.csrf_token;
}

async function mutation<T>(
  path: string,
  method: 'PATCH' | 'POST' | 'DELETE',
  accessToken: string,
  body?: unknown,
): Promise<T> {
  const csrfToken = await issueCsrfToken(accessToken);
  return request<T>(path, accessToken, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const getMyProfile = (accessToken: string) =>
  request<UserProfile>('/api/v1/users/me', accessToken);

export const updateMyProfile = (
  accessToken: string,
  profile: Partial<Pick<UserProfile, 'nickname' | 'birth_year' | 'gender' | 'profile_image_url'>>,
) =>
  mutation<{ user_id: number; updated_at: string }>(
    '/api/v1/users/me',
    'PATCH',
    accessToken,
    profile,
  );

export const getMySettings = (accessToken: string) =>
  request<UserSettings>('/api/v1/users/me/settings', accessToken);

export const updateMySettings = (accessToken: string, settings: UserSettings) =>
  mutation<UpdatedUserSettings>('/api/v1/users/me/settings', 'PATCH', accessToken, settings);

export const changeMyPassword = (
  accessToken: string,
  currentPassword: string,
  newPassword: string,
) =>
  mutation<void>('/api/v1/users/me/password', 'PATCH', accessToken, {
    current_password: currentPassword,
    new_password: newPassword,
  });

export const withdrawMyAccount = (accessToken: string, password: string) =>
  mutation<void>('/api/v1/users/me', 'DELETE', accessToken, { password });

export async function getAllRecommendationHistory(
  accessToken: string,
): Promise<RecommendationHistoryItem[]> {
  const collected: RecommendationHistoryItem[] = [];
  let cursor: string | null = null;

  do {
    const query = new URLSearchParams({ size: '100' });
    if (cursor) {
      query.set('cursor', cursor);
    }
    const page = await request<RecommendationHistory>(
      `/api/v1/users/me/recommendations?${query.toString()}`,
      accessToken,
    );
    for (const group of page.groups) {
      for (const recommendation of group.recommendations) {
        collected.push(...recommendation.items);
      }
    }
    cursor = page.next_cursor;
  } while (cursor !== null);

  return collected;
}

export const getRecommendationHistoryPage = (accessToken: string, cursor?: string | null) => {
  const query = new URLSearchParams({ size: '16' });
  if (cursor) query.set('cursor', cursor);
  return request<RecommendationHistory>(
    `/api/v1/users/me/recommendations?${query.toString()}`,
    accessToken,
  );
};
import { refreshAccessToken } from '../../auth-login/api/authSession';
