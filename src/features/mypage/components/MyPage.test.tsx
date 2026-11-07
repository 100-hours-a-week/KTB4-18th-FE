import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MyPage } from './MyPage';
import { getMyProfile, getMySettings } from '../api/mypageApi';
import { getAllMusicRecords } from '../../music-record/api/musicRecordsApi';

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

import { deferred, profile, setupMyPageTestSupport } from './MyPageTestSupport';
describe('MyPage profile validation', () => {
  setupMyPageTestSupport();

  it('publishes profile independently and starts the count delay only with its request', async () => {
    vi.useFakeTimers();
    const profileRequest = deferred<Awaited<ReturnType<typeof getMyProfile>>>();
    const settingsRequest = deferred<Awaited<ReturnType<typeof getMySettings>>>();
    const countRequest = deferred<Awaited<ReturnType<typeof getAllMusicRecords>>>();
    vi.mocked(getMyProfile).mockReturnValueOnce(profileRequest.promise);
    vi.mocked(getMySettings).mockReturnValueOnce(settingsRequest.promise);
    vi.mocked(getAllMusicRecords).mockReturnValueOnce(countRequest.promise);
    render(<MyPage onLogin={vi.fn()} onBack={vi.fn()} onLogout={vi.fn()} onWithdrawn={vi.fn()} />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(getMyProfile).toHaveBeenCalledOnce();
    expect(getMySettings).toHaveBeenCalledOnce();
    expect(getAllMusicRecords).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(299));
    expect(screen.queryByText('프로필을 불러오는 중')).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('status')).toHaveTextContent('프로필을 불러오는 중');
    await act(async () => profileRequest.resolve(profile));
    expect(screen.getByText('기존닉')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '마이페이지 메뉴' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeEnabled();
    expect(getAllMusicRecords).toHaveBeenCalledOnce();
    expect(screen.queryByText('저장한 곡 수를 불러오는 중')).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(screen.getByRole('status')).toHaveTextContent('저장한 곡 수를 불러오는 중');
    await act(async () => countRequest.resolve([]));
    expect(screen.queryByText('저장한 곡 수를 불러오는 중')).not.toBeInTheDocument();
    await act(async () =>
      settingsRequest.resolve({
        map_visibility: 'PUBLIC',
        is_unrecorded_dot_recommendation_enabled: false,
      }),
    );
  });
});
