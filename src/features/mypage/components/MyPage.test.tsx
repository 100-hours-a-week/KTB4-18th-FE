import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMyProfile,
  getMyProfileImage,
  uploadMyProfileImage,
  getMySettings,
  MyPageRequestError,
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
  uploadMyProfileImage: vi.fn(),
  getMyProfileImage: vi.fn(),
  withdrawMyAccount: vi.fn(),
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
  it('preserves the overview placeholder and adds only the editor image controls', async () => {
    const user = userEvent.setup();
    const view = render(
      <MyPage onLogin={vi.fn()} onBack={vi.fn()} onLogout={vi.fn()} onWithdrawn={vi.fn()} />,
    );
    await screen.findByText('기존닉');
    expect(view.container.querySelector('.mypage-avatar-placeholder img')).toHaveAttribute(
      'src',
      '/icons/mypage/profile.svg',
    );
    await user.click(screen.getByRole('button', { name: '더보기' }));
    await user.click(screen.getByText('프로필 수정'));
    expect(screen.getByAltText('기본 프로필 이미지')).toHaveAttribute(
      'src',
      '/icons/mypage/profile-image-placeholder.svg',
    );
    expect(view.container.querySelector('form')?.firstElementChild).toHaveClass(
      'mypage-profile-image-row',
    );
    expect(screen.getByLabelText('프로필 이미지 선택')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png',
    );
  });

  it('previews valid picks while cancellation and invalid picks preserve the draft and preview', async () => {
    const user = await openProfileEditor();
    const nickname = screen.getByRole('textbox', { name: /닉네임/ });
    await user.clear(nickname);
    await user.type(nickname, '새로운닉');
    const input = screen.getByLabelText('프로필 이미지 선택');
    fireEvent.change(input, {
      target: { files: [new File(['png'], 'test.png', { type: 'image/png' })] },
    });
    expect(await screen.findByAltText('프로필')).toHaveAttribute('src', 'blob:preview');
    fireEvent.change(input, { target: { files: [] } });
    fireEvent.change(input, {
      target: { files: [new File(['gif'], 'test.gif', { type: 'image/gif' })] },
    });
    expect(screen.getByRole('status')).toHaveTextContent('JPEG 또는 PNG');
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.jpg', {
      type: 'image/jpeg',
    });
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(screen.getByRole('status')).toHaveTextContent('5 MiB 이하');
    expect(screen.getByAltText('프로필')).toHaveAttribute('src', 'blob:preview');
    expect(nickname).toHaveValue('새로운닉');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('uploads before PATCH, disables controls, and never repeats the image URL in PATCH', async () => {
    const user = await openProfileEditor();
    let finish!: (result: { profile_image_url: string }) => void;
    vi.mocked(uploadMyProfileImage).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const file = new File(['png'], 'test.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('프로필 이미지 선택'), { target: { files: [file] } });
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(uploadMyProfileImage).toHaveBeenCalledWith(file);
    expect(updateMyProfile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '프로필 변경' })).toBeDisabled();
    expect(screen.getByLabelText('프로필 이미지 선택')).toBeDisabled();
    expect(screen.getByRole('button', { name: /저장/ })).toBeDisabled();
    finish({ profile_image_url: '/api/v1/users/me/profile-image/new.png' });
    await screen.findByText('프로필을 저장했어요.');
    expect(updateMyProfile).toHaveBeenCalledWith({
      nickname: '기존닉',
      birth_year: 2000,
      gender: 'FEMALE',
    });
  });

  it('retains the saved avatar and draft after partial failure and retries PATCH without another upload', async () => {
    const user = await openProfileEditor();
    vi.mocked(uploadMyProfileImage).mockResolvedValue({
      profile_image_url: '/api/v1/users/me/profile-image/new.png',
    });
    vi.mocked(updateMyProfile).mockRejectedValueOnce(
      new MyPageRequestError(409, '다른 닉네임을 선택해 주세요.'),
    );
    const nickname = screen.getByRole('textbox', { name: /닉네임/ });
    await user.clear(nickname);
    await user.type(nickname, '새로운닉');
    fireEvent.change(screen.getByLabelText('프로필 이미지 선택'), {
      target: { files: [new File(['png'], 'test.png', { type: 'image/png' })] },
    });
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText(/프로필 이미지는 저장했지만/)).toBeTruthy();
    expect(nickname).toHaveValue('새로운닉');
    expect(await screen.findByAltText('프로필')).toHaveAttribute('src', 'blob:preview');
    await user.click(screen.getByRole('button', { name: '저장' }));
    await screen.findByText('프로필을 저장했어요.');
    expect(uploadMyProfileImage).toHaveBeenCalledOnce();
    expect(updateMyProfile).toHaveBeenCalledTimes(2);
    expect(updateMyProfile).toHaveBeenLastCalledWith({
      nickname: '새로운닉',
      birth_year: 2000,
      gender: 'FEMALE',
    });
  });

  it('keeps the persisted image in overview after partial save and accepts a new selection', async () => {
    const user = await openProfileEditor();
    const imageUrl = '/api/v1/users/me/profile-image/new.png';
    vi.mocked(uploadMyProfileImage).mockResolvedValue({ profile_image_url: imageUrl });
    vi.mocked(updateMyProfile).mockRejectedValue(new MyPageRequestError(500));
    fireEvent.change(screen.getByLabelText('프로필 이미지 선택'), {
      target: { files: [new File(['png'], 'first.png', { type: 'image/png' })] },
    });
    await user.click(screen.getByRole('button', { name: '저장' }));
    await screen.findByText(/프로필 이미지는 저장했지만/);
    fireEvent.change(screen.getByLabelText('프로필 이미지 선택'), {
      target: { files: [new File(['jpg'], 'second.jpg', { type: 'image/jpeg' })] },
    });
    await user.click(screen.getByRole('button', { name: '저장' }));
    await screen.findByText(/프로필 이미지는 저장했지만/);
    expect(uploadMyProfileImage).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: '마이페이지로 돌아가기' }));
    expect(await screen.findByAltText('프로필')).toHaveAttribute('src', 'blob:preview');
    expect(getMyProfileImage).toHaveBeenLastCalledWith(imageUrl);
  });

  it('does not PATCH after upload failure and keeps the image for retry', async () => {
    const user = await openProfileEditor();
    vi.mocked(uploadMyProfileImage).mockRejectedValueOnce(
      new MyPageRequestError(413, '더 작은 이미지를 선택해 주세요.'),
    );
    fireEvent.change(screen.getByLabelText('프로필 이미지 선택'), {
      target: { files: [new File(['png'], 'test.png', { type: 'image/png' })] },
    });
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('더 작은 이미지를 선택해 주세요.')).toBeTruthy();
    expect(updateMyProfile).not.toHaveBeenCalled();
    expect(screen.getByAltText('프로필')).toHaveAttribute('src', 'blob:preview');
    expect(screen.getByRole('button', { name: '프로필 변경' })).toBeEnabled();
  });
  it('opens the picker by keyboard and accepts a JPEG exactly at the size limit', async () => {
    const user = await openProfileEditor();
    const input = screen.getByLabelText('프로필 이미지 선택');
    const click = vi.spyOn(input, 'click');
    screen.getByRole('button', { name: '프로필 변경' }).focus();
    await user.keyboard('{Enter}');
    expect(click).toHaveBeenCalledOnce();
    const file = new File([new Uint8Array(5 * 1024 * 1024)], 'boundary.jpg', {
      type: 'image/jpeg',
    });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByAltText('프로필')).toHaveAttribute('src', 'blob:preview');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
