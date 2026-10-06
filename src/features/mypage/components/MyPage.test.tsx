import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMyProfile,
  getMySettings,
  MyPageRequestError,
  verifyMyCurrentPassword,
  changeMyPassword,
  updateMyProfile,
  withdrawMyAccount,
} from '../api/mypageApi';
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
    render(<MyPage onLogin={vi.fn()} onBack={vi.fn()} onLogout={vi.fn()} onWithdrawn={vi.fn()} />);
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

  it('hides settings from the MyPage more menu', async () => {
    const user = userEvent.setup();
    render(<MyPage onLogin={vi.fn()} onBack={vi.fn()} onLogout={vi.fn()} onWithdrawn={vi.fn()} />);
    await screen.findByText('기존닉');

    await user.click(screen.getByRole('button', { name: '더보기' }));

    expect(screen.queryByRole('menuitem', { name: '설정' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: '프로필 수정' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '회원 탈퇴' })).toBeTruthy();
  });

  it('shows the overview back button and returns to the main page when clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<MyPage onLogin={vi.fn()} onBack={onBack} onLogout={vi.fn()} onWithdrawn={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '마이페이지로 돌아가기' }));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it('verifies the current password on blur and enables save only after all password rules pass', async () => {
    const user = userEvent.setup();
    const onPasswordChanged = vi.fn();
    vi.mocked(verifyMyCurrentPassword).mockResolvedValue({ valid: false });
    render(
      <MyPage
        onLogin={vi.fn()}
        onBack={vi.fn()}
        onLogout={vi.fn()}
        onWithdrawn={vi.fn()}
        onPasswordChanged={onPasswordChanged}
      />,
    );
    await screen.findByText('기존닉');
    await user.click(screen.getByRole('button', { name: '비밀번호 재설정' }));
    expect(
      screen.getByText(
        '새 비밀번호는 8~64자이며, 숫자와 특수문자를 각각 1개 이상 포함해야 합니다.',
      ),
    ).toBeTruthy();
    const current = screen.getByLabelText('현재 비밀번호');
    expect(screen.queryByText(/현재 사용 중인 비밀번호를 입력해 주세요/)).toBeNull();
    await user.click(current);
    const currentHelp = await screen.findByText(/현재 사용 중인 비밀번호를 입력해 주세요/);
    expect(currentHelp).toHaveClass('mypage-notice');
    await user.type(current, 'old-password');
    await user.tab();
    expect(await screen.findByText('현재 비밀번호가 틀립니다.')).toBeTruthy();
    expect(changeMyPassword).not.toHaveBeenCalled();

    vi.mocked(verifyMyCurrentPassword).mockResolvedValue({ valid: true });
    await user.clear(current);
    await user.type(current, 'old-password');
    await user.tab();
    expect(screen.queryByText(/현재 사용 중인 비밀번호를 입력해 주세요/)).toBeNull();
    const next = screen.getByLabelText('새 비밀번호');
    await user.click(next);
    expect(
      screen.getByText(
        '새 비밀번호는 8~64자이며, 숫자와 특수문자를 각각 1개 이상 포함해야 합니다.',
      ),
    ).toBeTruthy();
    await user.type(next, 'Newpass1!');
    const confirmation = screen.getByLabelText('새 비밀번호 확인');
    await user.click(confirmation);
    expect(screen.queryByText('새 비밀번호와 같은 값을 입력해 주세요.')).toBeNull();
    await user.tab();
    expect(await screen.findByText('새 비밀번호와 같은 값을 입력해 주세요.')).toBeTruthy();
    await user.type(confirmation, 'Newpass1!');
    await user.tab();
    expect(screen.queryByText('새 비밀번호와 같은 값을 입력해 주세요.')).toBeNull();
    expect(screen.getByRole('button', { name: '변경하기' })).toBeEnabled();
  });

  it('shows the Figma withdrawal warning first and preserves password confirmation before deletion', async () => {
    const user = await openProfileEditor();
    await user.click(screen.getByRole('button', { name: '더보기' }));
    await user.click(screen.getByText('마이페이지로 돌아가기'));
    await user.click(screen.getByRole('button', { name: '더보기' }));
    await user.click(screen.getByText('회원 탈퇴'));

    expect(await screen.findByRole('heading', { name: '회원 탈퇴하시겠습니까?' })).toBeTruthy();
    expect(screen.queryByLabelText('현재 비밀번호')).toBeNull();
    expect(withdrawMyAccount).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '탈퇴' }));
    expect(screen.queryByRole('heading', { name: '회원 탈퇴하시겠습니까?' })).toBeNull();
    expect(
      await screen.findByRole('heading', { name: '현재 비밀번호를 입력해주세요' }),
    ).toBeTruthy();
    await user.type(screen.getByLabelText('현재 비밀번호'), 'valid-password');
    await user.click(screen.getByRole('button', { name: '탈퇴하기' }));

    expect(withdrawMyAccount).toHaveBeenCalledWith('valid-password');
  });

  it('shows the Figma app version and opens open-source licenses in the terms bottom sheet', async () => {
    const user = await openProfileEditor();
    await user.click(screen.getByRole('button', { name: '더보기' }));
    await user.click(screen.getByText('마이페이지로 돌아가기'));
    await user.click(screen.getByText('약관 및 정책'));

    expect(await screen.findByText('서비스 이용약관')).toBeTruthy();
    expect(screen.getByText('오픈소스 라이선스')).toBeTruthy();
    expect(screen.getByText('앱 버전 1.0.0 (Build 24)')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '오픈소스 라이선스' }));

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.getByText('@seed-design/react')).toBeTruthy();
  });
});
