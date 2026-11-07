import { Menu } from '@seed-design/react';

import type { UserProfile } from '../../api/mypageApi';
import {
  MyPageOverviewSkeleton,
  MyPageSavedCountSkeleton,
} from '../../../../components/RouteLoadSkeleton';
import { ProfileImage } from '../ProfileImage';
import { MyPageHeader } from './MyPageHeader';

export type MyPageView =
  'overview' | 'profile' | 'settings' | 'sessions' | 'password' | 'terms' | 'recommendations';

type MyPageOverviewProps = {
  profile: UserProfile | null;
  joinedDate: string;
  error: string;
  onReload: () => void;
  isProfileSkeletonVisible: boolean;
  savedSongCount: number | null;
  isSavedSongCountLoading: boolean;
  isCountSkeletonVisible: boolean;
  savedSongError: string;
  onRetrySavedCount: () => void;
  onNavigate: (view: MyPageView) => void;
  isLogoutPending: boolean;
  logoutError: string;
  onBack: () => void;
  onLogout: () => void;
  onWithdraw: () => void;
};

export function MyPageOverview({
  profile,
  joinedDate,
  error,
  onReload,
  isProfileSkeletonVisible,
  savedSongCount,
  isSavedSongCountLoading,
  isCountSkeletonVisible,
  savedSongError,
  onRetrySavedCount,
  onNavigate,
  isLogoutPending,
  logoutError,
  onBack,
  onLogout,
  onWithdraw,
}: MyPageOverviewProps) {
  return (
    <>
      <MyPageHeader title="내 공간" onBack={onBack} className="mypage-overview-header">
        <Menu.Root placement="bottom-end">
          <Menu.Trigger
            className="mypage-icon-button"
            aria-label="더보기"
            disabled={isLogoutPending}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </Menu.Trigger>
          <Menu.Positioner>
            <Menu.Content>
              <Menu.Item onClick={() => onNavigate('profile')}>프로필 수정</Menu.Item>
              <Menu.Item disabled={isLogoutPending} onClick={onWithdraw}>
                회원 탈퇴
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Menu.Root>
      </MyPageHeader>
      {error && (
        <p className="mypage-page-error" role="alert">
          {error}{' '}
          <button className="mypage-inline-button" type="button" onClick={onReload}>
            다시 시도
          </button>
        </p>
      )}
      {!profile && !error && isProfileSkeletonVisible && <MyPageOverviewSkeleton />}
      {profile && (
        <section className="mypage-summary">
          <div className="mypage-avatar">
            <ProfileImage
              source={profile.profile_image_url}
              userId={profile.user_id}
              placeholder={
                <span className="mypage-avatar-placeholder" aria-label="기본 프로필 이미지">
                  <img src="/icons/mypage/Profile.svg" alt="" />
                </span>
              }
            />
          </div>
          <div>
            <strong>{profile.nickname}</strong>
            <span className="mypage-summary-email">{profile.email}</span>
            <small className="mypage-summary-joined-date">{joinedDate} 가입</small>
          </div>
          <div className="mypage-song-count" aria-busy={isSavedSongCountLoading}>
            {isCountSkeletonVisible ? (
              <MyPageSavedCountSkeleton />
            ) : (
              <strong>{savedSongCount ?? '—'}</strong>
            )}
            <span>남긴 곡</span>
            {savedSongError && (
              <button className="mypage-inline-button" type="button" onClick={onRetrySavedCount}>
                재시도
              </button>
            )}
          </div>
        </section>
      )}
      {savedSongError && (
        <p className="mypage-page-error" role="alert">
          {savedSongError}
        </p>
      )}
      <div className="diary-section-label">나의 음악과 설정</div>
      <nav className="mypage-navigation" aria-label="마이페이지 메뉴">
        <button
          className="mypage-navigation-row"
          type="button"
          onClick={() => onNavigate('recommendations')}
        >
          <span>지난 선곡</span>
          <img src="/icons/mypage/arrow-right.svg" alt="" />
        </button>
        <button
          className="mypage-navigation-row"
          type="button"
          onClick={() => onNavigate('sessions')}
        >
          <span>로그인된 기기</span>
          <img src="/icons/mypage/arrow-right.svg" alt="" />
        </button>
        <button
          className="mypage-navigation-row"
          type="button"
          onClick={() => onNavigate('password')}
        >
          <span>비밀번호 재설정</span>
          <img src="/icons/mypage/arrow-right.svg" alt="" />
        </button>
        <button className="mypage-navigation-row" type="button" onClick={() => onNavigate('terms')}>
          <span>약관 및 정책</span>
          <img src="/icons/mypage/arrow-right.svg" alt="" />
        </button>
      </nav>
      {isLogoutPending && (
        <p role="status" aria-live="polite">
          로그아웃 중…
        </p>
      )}
      {logoutError && (
        <p className="mypage-page-error" role="alert">
          {logoutError}
        </p>
      )}
      <button
        className="mypage-logout-button"
        type="button"
        onClick={onLogout}
        disabled={isLogoutPending}
      >
        로그아웃
      </button>
    </>
  );
}
