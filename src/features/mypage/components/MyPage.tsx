import { ActionButton } from '@seed-design/react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { MyPageSettingsSkeleton } from '../../../components/RouteLoadSkeleton';
import { MyPageOverview, type MyPageView } from './myPage/MyPageOverview';
import { PasswordPage as MyPagePasswordPage } from './myPage/MyPagePasswordPage';
import { ProfilePage as MyPageProfilePage } from './myPage/MyPageProfilePage';
import { RecommendationPage as MyPageRecommendationsPage } from './myPage/MyPageRecommendationsPage';
import { SettingsPage as MyPageSettingsPage } from './myPage/MyPageSettingsPage';
import { DeviceSessionsPage as MyPageDeviceSessionsPage } from './myPage/MyPageDeviceSessionsPage';
import { TermsPage as MyPageTermsPage } from './myPage/MyPageTermsPage';
import { WithdrawalDialog as MyPageWithdrawalDialog } from './myPage/MyPageWithdrawalDialog';
import { MyPageHeader } from './myPage/MyPageHeader';
import { useMyPageOverview } from './myPage/useMyPageOverview';

type MyPageProps = {
  onLogin: () => void;
  onBack: () => void;
  onLogout: () => void;
  isLogoutPending?: boolean;
  logoutError?: string;
  onWithdrawn: () => void | Promise<void>;
  onPasswordChanged?: () => void;
};

export function MyPage({
  onLogin,
  onBack,
  onLogout,
  isLogoutPending = false,
  logoutError = '',
  onWithdrawn,
  onPasswordChanged,
}: MyPageProps) {
  const [view, setView] = useState<MyPageView>('overview');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const overview = useMyPageOverview();

  if (overview.isAuthenticated === false) {
    return (
      <main className="mypage-screen">
        <section className="mypage-empty">
          <h1>내 공간</h1>
          <p>내 정보와 음악 활동을 보려면 로그인이 필요해요.</p>
          <ActionButton type="button" variant="brandSolid" size="large" onClick={onLogin}>
            로그인
          </ActionButton>
        </section>
      </main>
    );
  }

  let content: ReactNode;
  if (view === 'profile' && overview.profile) {
    content = (
      <MyPageProfilePage
        key={overview.profile.user_id}
        profile={overview.profile}
        onImageSaved={(url) =>
          overview.setProfile((current) =>
            current && current.user_id === overview.profile?.user_id
              ? { ...current, profile_image_url: url }
              : current,
          )
        }
        reload={() => void overview.reload()}
        back={() => setView('overview')}
      />
    );
  } else if (view === 'settings') {
    content = overview.isSettingsLoading ? (
      <>
        <MyPageHeader title="설정" onBack={() => setView('overview')} />
        {overview.isSettingsSkeletonVisible && <MyPageSettingsSkeleton />}
      </>
    ) : overview.settingsError ? (
      <>
        <MyPageHeader title="설정" onBack={() => setView('overview')} />
        <p className="mypage-page-error" role="alert">
          {overview.settingsError}{' '}
          <button
            className="mypage-inline-button"
            type="button"
            onClick={() => void overview.reload()}
          >
            다시 시도
          </button>
        </p>
      </>
    ) : (
      <MyPageSettingsPage
        settings={overview.settings}
        reload={() => void overview.reload()}
        back={() => setView('overview')}
      />
    );
  } else if (view === 'password') {
    content = (
      <MyPagePasswordPage back={() => setView('overview')} onPasswordChanged={onPasswordChanged} />
    );
  } else if (view === 'sessions') {
    content = <MyPageDeviceSessionsPage back={() => setView('overview')} />;
  } else if (view === 'terms') {
    content = <MyPageTermsPage back={() => setView('overview')} />;
  } else if (view === 'recommendations') {
    content = <MyPageRecommendationsPage back={() => setView('overview')} />;
  } else {
    content = (
      <MyPageOverview
        profile={overview.profile}
        joinedDate={overview.joinedDate}
        error={overview.error}
        onReload={() => void overview.reload()}
        isProfileSkeletonVisible={overview.isProfileSkeletonVisible}
        savedSongCount={overview.savedSongCount}
        isSavedSongCountLoading={overview.isSavedSongCountLoading}
        isCountSkeletonVisible={overview.isCountSkeletonVisible}
        savedSongError={overview.savedSongError}
        onRetrySavedCount={overview.retrySavedSongCount}
        onNavigate={setView}
        isLogoutPending={isLogoutPending}
        logoutError={logoutError}
        onBack={onBack}
        onLogout={() => void onLogout()}
        onWithdraw={() => setWithdrawOpen(true)}
      />
    );
  }

  return (
    <main className="mypage-screen">
      {content}
      <MyPageWithdrawalDialog
        open={withdrawOpen}
        setOpen={setWithdrawOpen}
        onWithdrawn={onWithdrawn}
      />
    </main>
  );
}
