import type { ReactNode } from 'react';

export function MyPageHeader({
  title,
  onBack,
  children,
  className,
}: {
  title: string;
  onBack?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`mypage-header ${className ?? ''}`}>
      {onBack ? (
        <button
          className="mypage-icon-button"
          type="button"
          onClick={onBack}
          aria-label="내 공간으로 돌아가기"
        >
          <img src="/icons/chatbot/Arrow-reft.svg" alt="" aria-hidden="true" />
        </button>
      ) : (
        <span className="mypage-header-spacer" aria-hidden="true" />
      )}
      <h1>{title}</h1>
      <div className="mypage-header-action">{children}</div>
    </header>
  );
}
