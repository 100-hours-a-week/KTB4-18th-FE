import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MyPageRequestError, updateMyProfile } from '../api/mypageApi';

vi.mock('../api/mypageApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/mypageApi')>()),
  getMyProfile: vi.fn(),
  getMyAuthSessions: vi.fn(),
  getMySettings: vi.fn(),
  getRecommendationHistoryPage: vi.fn().mockResolvedValue({
    groups: [],
    next_cursor: null,
    has_next: false,
  }),
  updateMyProfile: vi.fn(),
  uploadMyProfileImage: vi.fn(),
  getMyProfileImage: vi.fn(),
  withdrawMyAccount: vi.fn(),
  verifyMyCurrentPassword: vi.fn(),
  changeMyPassword: vi.fn(),
}));

vi.mock('../../music-record/api/musicRecordsApi', () => ({
  getAllMusicRecords: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../user-signup/api/termsApi', () => ({
  getCurrentTerms: vi.fn().mockResolvedValue([
    {
      terms_id: 1,
      type: 'SERVICE',
      version: '1.0.0',
      title: '서비스 이용약관',
      is_required: true,
      effective_at: '2026-01-01T00:00:00Z',
    },
  ]),
  getTermDetail: vi.fn().mockResolvedValue({
    terms_id: 1,
    type: 'SERVICE',
    version: '1.0.0',
    title: '서비스 이용약관',
    is_required: true,
    effective_at: '2026-01-01T00:00:00Z',
    content: '| 항목 | 내용 |\n| --- | --- |\n| 서비스 | 음악 추천 |',
  }),
}));

import { openProfileEditor, setupMyPageTestSupport } from './MyPageTestSupport';
describe('MyPage profile validation', () => {
  setupMyPageTestSupport();

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

  it('allows changing and clearing an optional gender selection', async () => {
    const user = await openProfileEditor();
    const selectedGender = screen.getByRole('checkbox', { name: '여성' });
    const otherGender = screen.getByRole('checkbox', { name: '남성' });
    expect(selectedGender).toBeChecked();
    await user.click(otherGender);
    expect(selectedGender).not.toBeChecked();
    expect(otherGender).toBeChecked();
    await user.click(otherGender);
    expect(otherGender).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        gender: null,
      }),
    );
  });
});
