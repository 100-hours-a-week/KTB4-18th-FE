import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MyPage } from './MyPage';
import {
  MyPageRequestError,
  getMyProfileImage,
  updateMyProfile,
  uploadMyProfileImage,
} from '../api/mypageApi';

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
describe('MyPage profile image', () => {
  setupMyPageTestSupport();

  it('preserves the overview placeholder and adds only the editor image controls', async () => {
    const user = userEvent.setup();
    const view = render(
      <MyPage onLogin={vi.fn()} onBack={vi.fn()} onLogout={vi.fn()} onWithdrawn={vi.fn()} />,
    );
    await screen.findByText('기존닉');
    expect(view.container.querySelector('.mypage-avatar-placeholder img')).toHaveAttribute(
      'src',
      '/icons/mypage/Profile.svg',
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
      'image/jpeg,image/png,image/webp',
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
    expect(screen.getByRole('status')).toHaveTextContent(
      'JPG, PNG, WEBP 형식의 이미지만 등록할 수 있어요.',
    );
    const oversized = new File([new Uint8Array(10000001)], 'large.jpg', {
      type: 'image/jpeg',
    });
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(screen.getByRole('status')).toHaveTextContent('10MB 이하의 이미지만 등록할 수 있어요.');
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
    await user.click(screen.getByRole('button', { name: '내 공간으로 돌아가기' }));
    expect(await screen.findByAltText('프로필')).toHaveAttribute('src', 'blob:preview');
    expect(getMyProfileImage).toHaveBeenLastCalledWith(imageUrl);
  });

  it('does not PATCH after upload failure and keeps the image for retry', async () => {
    const user = await openProfileEditor();
    vi.mocked(uploadMyProfileImage).mockRejectedValueOnce(
      new MyPageRequestError(413, '10MB 이하의 이미지만 등록할 수 있어요.'),
    );
    fireEvent.change(screen.getByLabelText('프로필 이미지 선택'), {
      target: { files: [new File(['png'], 'test.png', { type: 'image/png' })] },
    });
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('10MB 이하의 이미지만 등록할 수 있어요.')).toBeTruthy();
    expect(updateMyProfile).not.toHaveBeenCalled();
    expect(screen.getByAltText('프로필')).toHaveAttribute('src', 'blob:preview');
    expect(screen.getByRole('button', { name: '프로필 변경' })).toBeEnabled();
    vi.mocked(uploadMyProfileImage).mockResolvedValueOnce({
      profile_image_url: '/api/v1/users/me/profile-image/new.png',
    });
    await user.click(screen.getByRole('button', { name: '저장' }));
    await screen.findByText('프로필을 저장했어요.');
    expect(uploadMyProfileImage).toHaveBeenCalledTimes(2);
    expect(updateMyProfile).toHaveBeenCalledOnce();
  });

  it('opens the picker by keyboard and accepts a JPEG exactly at the size limit', async () => {
    const user = await openProfileEditor();
    const input = screen.getByLabelText('프로필 이미지 선택');
    const click = vi.spyOn(input, 'click');
    screen.getByRole('button', { name: '프로필 변경' }).focus();
    await user.keyboard('{Enter}');
    expect(click).toHaveBeenCalledOnce();
    const file = new File([new Uint8Array(10000000)], 'boundary.jpg', {
      type: 'image/jpeg',
    });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByAltText('프로필')).toHaveAttribute('src', 'blob:preview');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each([9999999, 10000000, 10000001])(
    'validates the decimal 10MB boundary at %i bytes',
    async (size) => {
      const user = await openProfileEditor();
      const file = new File([new Uint8Array(size)], 'boundary.webp', { type: 'image/webp' });
      fireEvent.change(screen.getByLabelText('프로필 이미지 선택'), {
        target: { files: [file] },
      });
      if (size > 10000000) {
        expect(screen.getByRole('status')).toHaveTextContent(
          '10MB 이하의 이미지만 등록할 수 있어요.',
        );
        expect(URL.createObjectURL).not.toHaveBeenCalled();
      } else {
        expect(await screen.findByAltText('프로필')).toHaveAttribute('src', 'blob:preview');
        vi.mocked(uploadMyProfileImage).mockResolvedValueOnce({
          profile_image_url: '/api/v1/users/me/profile-image/new.png',
        });
        await user.click(screen.getByRole('button', { name: '저장' }));
        await screen.findByText('프로필을 저장했어요.');
        expect(uploadMyProfileImage).toHaveBeenCalledWith(file);
      }
    },
  );

  it('shows the exact format message after server rejection while preserving a WEBP for retry', async () => {
    const user = await openProfileEditor();
    const file = new File(['webp'], 'avatar.webp', { type: 'image/webp' });
    fireEvent.change(screen.getByLabelText('프로필 이미지 선택'), { target: { files: [file] } });
    vi.mocked(uploadMyProfileImage).mockRejectedValueOnce(
      new MyPageRequestError(400, 'JPG, PNG, WEBP 형식의 이미지만 등록할 수 있어요.'),
    );
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'JPG, PNG, WEBP 형식의 이미지만 등록할 수 있어요.',
    );
    expect(screen.getByAltText('프로필')).toHaveAttribute('src', 'blob:preview');
    expect(updateMyProfile).not.toHaveBeenCalled();
    vi.mocked(uploadMyProfileImage).mockResolvedValueOnce({
      profile_image_url: '/api/v1/users/me/profile-image/new.png',
    });
    await user.click(screen.getByRole('button', { name: '저장' }));
    await screen.findByText('프로필을 저장했어요.');
    expect(uploadMyProfileImage).toHaveBeenNthCalledWith(2, file);
  });
});
