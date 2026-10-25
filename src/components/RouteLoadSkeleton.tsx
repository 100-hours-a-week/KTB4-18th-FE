import type { ReactNode } from 'react';

import './RouteLoadSkeleton.css';

export type RouteSkeletonVariant =
  | 'login'
  | 'signup'
  | 'chat-entry'
  | 'my-page'
  | 'music-list'
  | 'music-create'
  | 'music-detail'
  | 'chatbot';

type SkeletonStatusProps = {
  children: ReactNode;
  className?: string;
  message: string;
};

export function SkeletonBone({ className = '' }: { className?: string }) {
  return <span className={`route-skeleton__bone ${className}`} />;
}

function SkeletonStatus({ children, className = '', message }: SkeletonStatusProps) {
  return (
    <div className={`route-skeleton__inline ${className}`} role="status" aria-busy="true">
      <span className="route-skeleton__sr-only">{message}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

function AuthLayout() {
  return (
    <div className="route-skeleton__auth-layout">
      <div className="route-skeleton__auth-brand">
        <SkeletonBone className="route-skeleton__auth-mark" />
        <SkeletonBone className="route-skeleton__auth-wordmark" />
      </div>
      <div className="route-skeleton__auth-divider">
        <SkeletonBone />
        <SkeletonBone className="route-skeleton__auth-divider-label" />
        <SkeletonBone />
      </div>
      <div className="route-skeleton__auth-fields">
        <SkeletonBone className="route-skeleton__auth-field" />
        <SkeletonBone className="route-skeleton__auth-field" />
        <SkeletonBone className="route-skeleton__auth-submit" />
      </div>
      <SkeletonBone className="route-skeleton__auth-signup" />
    </div>
  );
}

function SignupLayout() {
  return (
    <div className="route-skeleton__signup-shell">
      <header className="route-skeleton__signup-header">
        <SkeletonBone className="route-skeleton__signup-icon" />
        <SkeletonBone className="route-skeleton__signup-title" />
        <SkeletonBone className="route-skeleton__signup-icon" />
      </header>
      <div className="route-skeleton__signup-form">
        <div className="route-skeleton__signup-fields">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonBone className="route-skeleton__signup-field" key={index} />
          ))}
          <SkeletonBone className="route-skeleton__signup-gender" />
          <div className="route-skeleton__signup-copy">
            <SkeletonBone />
            <SkeletonBone />
          </div>
          <div className="route-skeleton__signup-terms">
            <SkeletonBone className="route-skeleton__signup-terms-heading" />
            {Array.from({ length: 5 }, (_, index) => (
              <SkeletonBone className="route-skeleton__signup-term" key={index} />
            ))}
          </div>
        </div>
        <SkeletonBone className="route-skeleton__signup-submit" />
      </div>
    </div>
  );
}

function ChatEntryLayout() {
  return (
    <div className="route-skeleton__chat-entry-shell">
      <header className="route-skeleton__chat-entry-header">
        <SkeletonBone className="route-skeleton__chat-entry-icon" />
        <SkeletonBone className="route-skeleton__chat-entry-title" />
        <SkeletonBone className="route-skeleton__chat-entry-count" />
      </header>
      <div className="route-skeleton__chat-entry-status">
        <SkeletonBone />
        <SkeletonBone />
      </div>
      <div className="route-skeleton__chat-entry-messages">
        <SkeletonBone className="route-skeleton__chat-entry-bubble route-skeleton__chat-entry-bubble--left" />
        <SkeletonBone className="route-skeleton__chat-entry-bubble route-skeleton__chat-entry-bubble--right" />
        <SkeletonBone className="route-skeleton__chat-entry-bubble route-skeleton__chat-entry-bubble--left-short" />
      </div>
      <div className="route-skeleton__chat-entry-composer">
        <SkeletonBone />
        <SkeletonBone className="route-skeleton__chat-entry-send" />
      </div>
    </div>
  );
}

function MyPageHeaderSkeleton() {
  return (
    <div className="route-skeleton__my-header">
      <SkeletonBone className="route-skeleton__my-header-icon" />
      <SkeletonBone className="route-skeleton__my-header-title" />
      <SkeletonBone className="route-skeleton__my-header-icon" />
    </div>
  );
}

function MyPageOverviewShape() {
  return (
    <>
      <div className="route-skeleton__my-summary">
        <SkeletonBone className="route-skeleton__my-avatar" />
        <div className="route-skeleton__my-profile-lines">
          <SkeletonBone className="route-skeleton__my-profile-name" />
          <SkeletonBone className="route-skeleton__my-profile-email" />
        </div>
        <div className="route-skeleton__my-song-count">
          <SkeletonBone />
          <SkeletonBone />
        </div>
      </div>
      <div className="route-skeleton__my-navigation">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonBone className="route-skeleton__my-navigation-row" key={index} />
        ))}
      </div>
      <SkeletonBone className="route-skeleton__my-logout" />
    </>
  );
}

function MyPageLayout() {
  return (
    <div className="route-skeleton__my-shell">
      <MyPageHeaderSkeleton />
      <MyPageOverviewShape />
    </div>
  );
}

function MusicHeaderSkeleton() {
  return (
    <header className="route-skeleton__music-header">
      <SkeletonBone className="route-skeleton__music-header-icon" />
      <SkeletonBone className="route-skeleton__music-header-title" />
      <SkeletonBone className="route-skeleton__music-header-icon" />
    </header>
  );
}

function MusicRecordRowsShape({ count = 4 }: { count?: number }) {
  return (
    <div className="route-skeleton__record-rows">
      {Array.from({ length: count }, (_, index) => (
        <div className="route-skeleton__record-row" key={index}>
          <SkeletonBone className="route-skeleton__record-cover" />
          <div className="route-skeleton__record-copy">
            <SkeletonBone className="route-skeleton__record-title" />
            <SkeletonBone className="route-skeleton__record-artist" />
            <SkeletonBone className="route-skeleton__record-meta" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MusicListLayout() {
  return (
    <div className="route-skeleton__music-shell route-skeleton__music-shell--list">
      <MusicHeaderSkeleton />
      <div className="route-skeleton__music-list-content">
        <SkeletonBone className="route-skeleton__music-filter" />
        <MusicRecordRowsShape />
      </div>
    </div>
  );
}

function MusicCreateLayout() {
  return (
    <div className="route-skeleton__music-shell route-skeleton__music-shell--create">
      <MusicHeaderSkeleton />
      <div className="route-skeleton__music-create-content">
        <SkeletonBone className="route-skeleton__music-search" />
      </div>
      <div className="route-skeleton__music-footer">
        <SkeletonBone />
      </div>
    </div>
  );
}

function MusicDetailFieldsShape() {
  return (
    <>
      <div className="route-skeleton__music-selected">
        <SkeletonBone className="route-skeleton__music-album" />
        <SkeletonBone className="route-skeleton__music-selected-title" />
        <SkeletonBone className="route-skeleton__music-selected-artist" />
        <SkeletonBone className="route-skeleton__music-change" />
      </div>
      <div className="route-skeleton__music-detail-field">
        <SkeletonBone className="route-skeleton__music-field-label" />
        <SkeletonBone className="route-skeleton__music-field-input" />
      </div>
      <div className="route-skeleton__music-detail-field">
        <SkeletonBone className="route-skeleton__music-field-label" />
        <SkeletonBone className="route-skeleton__music-field-textarea" />
      </div>
      <SkeletonBone className="route-skeleton__music-submit" />
    </>
  );
}

function MusicDetailLayout() {
  return (
    <div className="route-skeleton__music-shell route-skeleton__music-shell--detail">
      <MusicHeaderSkeleton />
      <div className="route-skeleton__music-detail-content">
        <MusicDetailFieldsShape />
      </div>
    </div>
  );
}

function ChatbotLayout() {
  return (
    <div className="route-skeleton__chatbot-shell">
      <header className="route-skeleton__chatbot-header">
        <SkeletonBone className="route-skeleton__chatbot-icon" />
        <SkeletonBone className="route-skeleton__chatbot-title" />
        <SkeletonBone className="route-skeleton__chatbot-icon" />
      </header>
      <div className="route-skeleton__chatbot-content">
        <SkeletonBone className="route-skeleton__chatbot-date" />
        <div className="route-skeleton__chatbot-message">
          <SkeletonBone />
          <SkeletonBone />
          <SkeletonBone />
        </div>
      </div>
      <div className="route-skeleton__chatbot-composer">
        <SkeletonBone className="route-skeleton__chatbot-attach" />
        <SkeletonBone className="route-skeleton__chatbot-input" />
        <SkeletonBone className="route-skeleton__chatbot-send" />
      </div>
    </div>
  );
}

const layoutByVariant = {
  login: AuthLayout,
  signup: SignupLayout,
  'chat-entry': ChatEntryLayout,
  'my-page': MyPageLayout,
  'music-list': MusicListLayout,
  'music-create': MusicCreateLayout,
  'music-detail': MusicDetailLayout,
  chatbot: ChatbotLayout,
} satisfies Record<RouteSkeletonVariant, () => ReactNode>;

export function RouteLoadSkeleton({ variant }: { variant: RouteSkeletonVariant }) {
  const Layout = layoutByVariant[variant];

  return (
    <main
      className={`route-skeleton route-skeleton--${variant}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="route-skeleton__sr-only">페이지 내용을 준비하고 있어요.</span>
      <div aria-hidden="true">
        <Layout />
      </div>
    </main>
  );
}

export function MyPageOverviewSkeleton() {
  return (
    <SkeletonStatus className="route-skeleton__my-inline" message="마이페이지를 불러오는 중">
      <MyPageOverviewShape />
    </SkeletonStatus>
  );
}

export function MyPageDeviceSessionsSkeleton() {
  return (
    <SkeletonStatus
      className="route-skeleton__my-device-sessions"
      message="로그인된 기기 목록을 불러오는 중"
    >
      <div className="route-skeleton__my-session-list">
        {Array.from({ length: 3 }, (_, index) => (
          <div className="route-skeleton__my-session-row" key={index}>
            <SkeletonBone className="route-skeleton__my-session-title" />
            <SkeletonBone className="route-skeleton__my-session-date" />
            <SkeletonBone className="route-skeleton__my-session-date route-skeleton__my-session-date--short" />
          </div>
        ))}
      </div>
    </SkeletonStatus>
  );
}

export function MyPageRecommendationsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <SkeletonStatus
      className="route-skeleton__my-recommendations"
      message="추천 곡 목록을 불러오는 중"
    >
      {Array.from({ length: count }, (_, index) => (
        <div className="route-skeleton__my-recommendation-row" key={index}>
          <SkeletonBone className="route-skeleton__my-recommendation-cover" />
          <div>
            <SkeletonBone className="route-skeleton__my-recommendation-title" />
            <SkeletonBone className="route-skeleton__my-recommendation-artist" />
          </div>
          <SkeletonBone className="route-skeleton__my-recommendation-action" />
        </div>
      ))}
    </SkeletonStatus>
  );
}

export function MyPageTermsListSkeleton() {
  return (
    <SkeletonStatus className="route-skeleton__my-terms" message="약관 목록을 불러오는 중">
      <div className="route-skeleton__my-term-list">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="route-skeleton__my-term-row" key={index}>
            <SkeletonBone />
            <SkeletonBone />
          </div>
        ))}
      </div>
    </SkeletonStatus>
  );
}

export function MusicRecordListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <SkeletonStatus
      className="route-skeleton__record-inline"
      message="음악 기록 목록을 불러오는 중"
    >
      <MusicRecordRowsShape count={count} />
    </SkeletonStatus>
  );
}

export function MusicRecordDetailSkeleton() {
  return (
    <SkeletonStatus
      className="route-skeleton__music-detail-inline"
      message="음악 기록을 불러오는 중"
    >
      <MusicDetailFieldsShape />
    </SkeletonStatus>
  );
}

export function SignupTermsSkeleton() {
  return (
    <SkeletonStatus
      className="route-skeleton__signup-terms-inline"
      message="약관 목록을 불러오는 중"
    >
      <SkeletonBone className="route-skeleton__signup-terms-heading" />
      {Array.from({ length: 5 }, (_, index) => (
        <SkeletonBone className="route-skeleton__signup-term" key={index} />
      ))}
    </SkeletonStatus>
  );
}

export function MapContentSkeleton() {
  return (
    <div className="route-skeleton__map-content" role="status" aria-busy="true">
      <span className="route-skeleton__sr-only">지도를 준비하고 있어요.</span>
      <div className="route-skeleton__map-dots" aria-hidden="true">
        {Array.from({ length: 14 }, (_, index) => (
          <SkeletonBone key={index} />
        ))}
      </div>
    </div>
  );
}
