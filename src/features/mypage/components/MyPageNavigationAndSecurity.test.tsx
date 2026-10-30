import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MyPage } from './MyPage';
import { changeMyPassword, verifyMyCurrentPassword } from '../api/mypageApi';

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

import { setupMyPageTestSupport } from './MyPageTestSupport';
describe('MyPage navigation and security', () => {
  setupMyPageTestSupport();

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
    await user.click(screen.getByRole('button', { name: '내 공간으로 돌아가기' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows this user’s active device sessions in MyPage', async () => {
    const user = userEvent.setup();
    render(<MyPage onLogin={vi.fn()} onBack={vi.fn()} onLogout={vi.fn()} onWithdrawn={vi.fn()} />);
    await screen.findByText('기존닉');
    await user.click(screen.getByText('로그인된 기기'));
    expect(await screen.findByRole('heading', { name: '로그인된 기기' })).toBeTruthy();
    expect(await screen.findByText('Chrome · macOS')).toBeTruthy();
    expect(screen.getByText(/현재 기기/)).toBeTruthy();
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
});
