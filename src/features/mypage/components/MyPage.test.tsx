import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyProfile, getMySettings, MyPageRequestError, updateMyProfile } from '../api/mypageApi';
import { MyPage } from './MyPage';

vi.mock('../api/mypageApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/mypageApi')>()),
  getMyProfile: vi.fn(),
  getMySettings: vi.fn(),
  getRecommendationHistoryPage: vi.fn().mockResolvedValue({
    groups: [],
    next_cursor: null,
    has_next: false,
  }),
  updateMyProfile: vi.fn(),
}));

vi.mock('../../music-record/api/musicRecordsApi', () => ({
  getAllMusicRecords: vi.fn().mockResolvedValue([]),
}));

const profile = {
  user_id: 1,
  email: 'user@example.com',
  nickname: '기존닉',
  birth_year: 2000,
  gender: 'FEMALE',
  profile_image_url: null,
  created_at: '2026-01-01T00:00:00Z',
};

describe('MyPage profile validation', () => {
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
    vi.mocked(getMySettings).mockResolvedValue({
      map_visibility: 'PRIVATE',
      is_unrecorded_dot_recommendation_enabled: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  async function openProfileEditor() {
    const user = userEvent.setup();
    render(<MyPage onLogin={vi.fn()} onLogout={vi.fn()} onWithdrawn={vi.fn()} />);
    await screen.findByText('기존닉');
    await user.click(screen.getByRole('button', { name: '더보기' }));
    await user.click(screen.getByText('프로필 수정'));
    await screen.findByRole('heading', { name: '프로필 수정' });
    return user;
  }

  it('prevents invalid signup-policy nickname and birth year values from being submitted', async () => {
    const user = await openProfileEditor();
    const nicknameInput = screen.getByRole('textbox', { name: /닉네임/ });
    const birthYearInput = screen.getByRole('textbox', { name: /출생 연도/ });

    await user.clear(nicknameInput);
    await user.type(nicknameInput, '가');
    await user.clear(birthYearInput);
    await user.type(birthYearInput, '1899');
    fireEvent.submit(nicknameInput.closest('form')!);

    expect(await screen.findByText('닉네임은 2자 이상 12자 이하로 입력해 주세요.')).toBeTruthy();
    expect(screen.getByText(/출생연도는 1900년부터 .*년 사이/)).toBeTruthy();
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  it('keeps the draft visible and stays on the editor when the API rejects a duplicate nickname', async () => {
    const user = await openProfileEditor();
    vi.mocked(updateMyProfile).mockRejectedValue(
      new MyPageRequestError(409, 'nickname already exists'),
    );
    const nicknameInput = screen.getByRole('textbox', { name: /닉네임/ });
    await user.clear(nicknameInput);
    await user.type(nicknameInput, '중복닉네임');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('nickname already exists')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /닉네임/ })).toHaveValue('중복닉네임');
    expect(screen.getByRole('heading', { name: '프로필 수정' })).toBeTruthy();
    expect(updateMyProfile).toHaveBeenCalledOnce();
  });
});
