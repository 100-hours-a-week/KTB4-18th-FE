import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { withdrawMyAccount } from '../api/mypageApi';

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
describe('MyPage withdrawal and terms', () => {
  setupMyPageTestSupport();

  it('shows the Figma withdrawal warning first and preserves password confirmation before deletion', async () => {
    const user = await openProfileEditor();
    await user.click(screen.getByRole('button', { name: '더보기' }));
    await user.click(screen.getByText('내 공간으로 돌아가기'));
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
    await user.click(screen.getByText('내 공간으로 돌아가기'));
    await user.click(screen.getByText('약관 및 정책'));
    expect(await screen.findByText('서비스 이용약관')).toBeTruthy();
    expect(screen.getByText('오픈소스 라이선스')).toBeTruthy();
    expect(screen.getByText('앱 버전 1.0.0 (Build 24)')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '오픈소스 라이선스' }));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.getByText('@seed-design/react')).toBeTruthy();
  });
});
