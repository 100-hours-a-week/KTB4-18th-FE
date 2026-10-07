import {
  AuthRequestError,
  authenticatedFetch,
  authenticatedFetchWithinAuthTransition,
  clearAccessToken,
  getAccessToken,
  runAuthTransition,
  setAccessToken,
} from '../../auth-login/api/authSession';

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

export class MyPageRequestError extends Error {
  readonly status: number | null;
  readonly messageFromServer: string | null;

  constructor(status: number | null, messageFromServer: string | null = null) {
    super('My page request failed');
    this.status = status;
    this.messageFromServer = messageFromServer;
  }
}

async function readError(response: Response): Promise<MyPageRequestError> {
  const payload = (await response.json().catch(() => null)) as ApiResponse<null> | null;
  return new MyPageRequestError(response.status, payload?.message ?? null);
}

async function request<T>(
  path: string,
  init?: RequestInit,
  transitionAccessToken?: string,
): Promise<T> {
  let response: Response;

  try {
    const input = `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}${path}`;
    const options = { ...init, credentials: 'include' as const };
    response = transitionAccessToken
      ? await authenticatedFetchWithinAuthTransition(input, options, transitionAccessToken)
      : await authenticatedFetch(input, options);
  } catch (caught) {
    if (caught instanceof AuthRequestError) throw new MyPageRequestError(caught.status);
    throw new MyPageRequestError(null);
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

async function mutation<T>(
  path: string,
  method: 'PATCH' | 'POST' | 'DELETE',
  body?: unknown,
): Promise<T> {
  return request<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const getMyProfile = () => request<UserProfile>('/api/v1/users/me');

export const updateMyProfile = (
  profile: Partial<Pick<UserProfile, 'nickname' | 'birth_year' | 'gender'>>,
) => mutation<{ user_id: number; updated_at: string }>('/api/v1/users/me', 'PATCH', profile);

export const getMySettings = () => request<UserSettings>('/api/v1/users/me/settings');

export const updateMySettings = (settings: UserSettings) =>
  mutation<UpdatedUserSettings>('/api/v1/users/me/settings', 'PATCH', settings);

export const changeMyPassword = (currentPassword: string, newPassword: string) =>
  mutation<void>('/api/v1/users/me/password', 'PATCH', {
    current_password: currentPassword,
    new_password: newPassword,
  });

export const verifyMyCurrentPassword = (currentPassword: string) =>
  mutation<{ valid: boolean }>('/api/v1/users/me/password/verification', 'POST', {
    current_password: currentPassword,
  });

export const withdrawMyAccount = (password: string) =>
  runAuthTransition(async () => {
    const accessToken = getAccessToken();
    if (!accessToken) throw new MyPageRequestError(401);
    clearAccessToken();
    try {
      await request<void>(
        '/api/v1/users/me',
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        },
        accessToken,
      );
    } catch (error) {
      setAccessToken(accessToken);
      throw error;
    }
  });

export async function getAllRecommendationHistory(): Promise<RecommendationHistoryItem[]> {
  const collected: RecommendationHistoryItem[] = [];
  let cursor: string | null = null;

  do {
    const query = new URLSearchParams({ size: '100' });
    if (cursor) {
      query.set('cursor', cursor);
    }
    const page = await request<RecommendationHistory>(
      `/api/v1/users/me/recommendations?${query.toString()}`,
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

export const getRecommendationHistoryPage = (cursor?: string | null) => {
  const query = new URLSearchParams({ size: '16' });
  if (cursor) query.set('cursor', cursor);
  return request<RecommendationHistory>(`/api/v1/users/me/recommendations?${query.toString()}`);
};

export const uploadMyProfileImage = (image: File) => {
  const body = new FormData();
  body.append('image', image);
  return request<{ profile_image_url: string }>('/api/v1/users/me/profile-image', {
    method: 'PUT',
    body,
  });
};

export const isProtectedProfileImage = (source: string) =>
  /^\/api\/v1\/users\/me\/profile-image\/[^/?#]+\.png$/.test(source);

export async function getMyProfileImage(source: string): Promise<Blob> {
  if (!isProtectedProfileImage(source)) throw new MyPageRequestError(null);
  let response: Response;
  try {
    response = await authenticatedFetch(
      `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}${source}`,
      { credentials: 'include', cache: 'no-store' },
    );
  } catch (error) {
    throw new MyPageRequestError(error instanceof AuthRequestError ? error.status : null);
  }
  if (!response.ok) throw await readError(response);
  return response.blob();
}
