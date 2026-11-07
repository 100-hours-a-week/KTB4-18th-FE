import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';

import {
  getMyAuthSessions,
  getMyProfile,
  getMyProfileImage,
  getMySettings,
  updateMyProfile,
  uploadMyProfileImage,
} from '../api/mypageApi';
import { MyPage } from './MyPage';
import { getAllMusicRecords } from '../../music-record/api/musicRecordsApi';

export const profile = {
  user_id: 1,
  email: 'user@example.com',
  nickname: '기존닉',
  birth_year: 2000,
  gender: 'FEMALE',
  profile_image_url: null,
  created_at: '2026-01-01T00:00:00Z',
};

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function setupMyPageTestSupport() {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((media: string) => ({
        matches: false,
        media,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.mocked(getMyProfile).mockResolvedValue(profile);
    vi.mocked(getMyAuthSessions).mockResolvedValue([
      {
        sid: 'session-1',
        current: true,
        device_label: 'Chrome · macOS',
        created_at: '2026-10-01T10:00:00Z',
        last_refreshed_at: '2026-10-10T10:00:00Z',
      },
    ]);
    vi.mocked(updateMyProfile).mockResolvedValue({ user_id: 1, updated_at: '2026-10-07' });
    vi.mocked(uploadMyProfileImage).mockReset();
    vi.mocked(getMyProfileImage).mockResolvedValue(new Blob(['png']));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:preview'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.mocked(getMySettings).mockResolvedValue({
      map_visibility: 'PRIVATE',
      is_unrecorded_dot_recommendation_enabled: true,
    });
    vi.mocked(getAllMusicRecords).mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
}

export async function openProfileEditor() {
  const user = userEvent.setup();
  render(
    createElement(MyPage, {
      onLogin: vi.fn(),
      onBack: vi.fn(),
      onLogout: vi.fn(),
      onWithdrawn: vi.fn(),
    }),
  );
  await screen.findByText('기존닉');
  await user.click(screen.getByRole('button', { name: '더보기' }));
  await user.click(screen.getByText('프로필 수정'));
  await screen.findByRole('heading', { name: '프로필 수정' });
  return user;
}
