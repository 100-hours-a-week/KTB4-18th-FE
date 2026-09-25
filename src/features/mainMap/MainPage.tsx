import { ActionButton } from "@seed-design/react";
import { navigate as navigateTo } from '../../shared/navigation';
import type { JSX } from "react";
import { ZoneMapCanvas } from "./ZoneMapCanvas";
import { useMapZones } from "./useMapZones";

type MainDestination = "map" | "records" | "chatRooms" | "my";

type Route = {
  destination: MainDestination | "recordCreate";
  path: string;
};

const routes: Record<MainDestination | "recordCreate", Route> = {
  map: { destination: "map", path: "/" },
  records: { destination: "records", path: "/music-records" },
  recordCreate: { destination: "recordCreate", path: "/music-records/new" },
  chatRooms: { destination: "chatRooms", path: "/chat" },
  my: { destination: "my", path: "/my" },
};

function getRoute(pathname: string): Route {
  return (
    Object.values(routes).find((route) => route.path === pathname) ?? routes.map
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function RecordIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4h12v16H6z" />
      <path d="M9 9h6M9 13h6M9 17h4" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="7" r="2.4" />
      <path d="M3 20c.5-3.6 2.5-5.4 6-5.4s5.5 1.8 6 5.4M15 14.8c3.2.3 4.9 2 5.3 5.2" />
    </svg>
  );
}

function MyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21c.6-4.2 3.1-6.3 7.5-6.3s6.9 2.1 7.5 6.3" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MapSection() {
  const state = useMapZones();

  return (
    <section
      className="main-content main-content--map"
      aria-labelledby="map-title"
    >
      <div className="map-copy">
        <p className="eyebrow">오늘의 뮤즈 지도</p>
        <h1 id="map-title">우리의 음악이 쌓이는 곳</h1>
        <p>도트 하나마다 함께 만든 순간을 담아요.</p>
      </div>
      {state.status === "loading" ? (
        <div className="map-loading" role="status">
          <span className="map-loading__dot" />
          지도를 준비하고 있어요.
        </div>
      ) : (
        <ZoneMapCanvas
          gridDots={state.gridDots}
          items={state.items}
          isFallback={state.status === "fallback"}
        />
      )}
    </section>
  );
}

type PlaceholderDestination = Exclude<MainDestination, "map"> | "recordCreate";

function PlaceholderSection({
  destination,
}: {
  destination: PlaceholderDestination;
}) {
  const copy = {
    records: ["기록", "음악으로 남긴 오늘의 순간을 모아볼까요?"],
    recordCreate: ["새 기록", "지금 떠오른 이야기를 음악과 함께 남겨보세요."],
    chatRooms: ["채팅방", "취향이 닿는 사람들과 이야기를 나눠요."],
    my: ["마이", "나의 음악 여정을 한눈에 확인해요."],
  } as const;
  const [title, description] = copy[destination];

  return (
    <section
      className="main-content placeholder-section"
      aria-labelledby={`${destination}-title`}
    >
      <p className="eyebrow">MEOMUNEUM</p>
      <h1 id={`${destination}-title`}>{title}</h1>
      <p>{description}</p>
      <div className="placeholder-section__card" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

type GnbProps = {
  currentDestination: MainDestination | "recordCreate";
  onNavigate: (destination: MainDestination | "recordCreate") => void;
};

type GnbItem = {
  destination: MainDestination;
  label: string;
  icon: () => JSX.Element;
};

function Gnb({ currentDestination, onNavigate }: GnbProps) {
  const items: GnbItem[] = [
    { destination: "map", label: "지도", icon: GridIcon },
    { destination: "records", label: "기록", icon: RecordIcon },
    { destination: "chatRooms", label: "채팅방", icon: ChatIcon },
    { destination: "my", label: "마이", icon: MyIcon },
  ];

  return (
    <nav className="gnb" aria-label="메인 탐색">
      <div className="gnb__surface">
        {items.slice(0, 2).map(({ destination, label, icon: Icon }) => (
          <button
            className={`gnb__item ${currentDestination === destination ? "gnb__item--active" : ""}`}
            key={destination}
            type="button"
            onClick={() => onNavigate(destination)}
            aria-current={
              currentDestination === destination ? "page" : undefined
            }
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
        <button
          className="gnb__create"
          type="button"
          onClick={() => onNavigate("recordCreate")}
          aria-label="새 기록 만들기"
        >
          <PlusIcon />
        </button>
        {items.slice(2).map(({ destination, label, icon: Icon }) => (
          <button
            className={`gnb__item ${currentDestination === destination ? "gnb__item--active" : ""}`}
            key={destination}
            type="button"
            onClick={() => onNavigate(destination)}
            aria-current={
              currentDestination === destination ? "page" : undefined
            }
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

type MainPageProps = {
  isAuthenticated: boolean;
  isLoggingOut: boolean;
  isRestoring: boolean;
  isRetryableError: boolean;
  logoutError: string;
  onLogin: () => void;
  onLogout: () => void;
  onRetryAuth: () => void;
  onChat: () => void;
};

export function MainPage({
  isAuthenticated,
  isLoggingOut,
  isRestoring,
  isRetryableError,
  logoutError,
  onLogin,
  onLogout,
  onRetryAuth,
  onChat,
}: MainPageProps) {
  const route = getRoute(window.location.pathname);

  function navigate(destination: MainDestination | "recordCreate") {
    if (destination === "chatRooms") {
      onChat();
      return;
    }

    const nextRoute = routes[destination];
    navigateTo(nextRoute.path);
  }

  return (
    <main
      className={`main-page ${route.destination === "map" ? "main-page--map" : ""}`}
    >
      <h1 className="sr-only">음악 지도</h1>
      <header className="main-header">
        <p className="main-header__brand">MEOMUNEUM</p>
        <ActionButton
          className="main-header__auth"
          type="button"
          variant="brandSolid"
          size="small"
          loading={isLoggingOut || isRestoring}
          disabled={isLoggingOut || isRestoring}
          onClick={isAuthenticated ? onLogout : onLogin}
        >
          {isRestoring ? '로그인 확인 중' : isAuthenticated ? "로그아웃" : "로그인"}
        </ActionButton>
      </header>
      {isRetryableError && <p role="alert" className="main-header__auth-error">
        로그인 상태를 확인하지 못했습니다. <button type="button" onClick={onRetryAuth}>다시 확인</button>
      </p>}
      {logoutError && (
        <p
          className="main-header__auth-error text-body3-normal-regular"
          role="alert"
        >
          {logoutError}
        </p>
      )}
      {route.destination === "map" ? (
        <MapSection />
      ) : (
        <PlaceholderSection destination={route.destination} />
      )}
      <a
        className="chatbot-floating-button"
        href="/chatbot"
        aria-label="음악 추천 챗봇 열기"
      >
        Chat
      </a>
      <Gnb currentDestination={route.destination} onNavigate={navigate} />
    </main>
  );
}
