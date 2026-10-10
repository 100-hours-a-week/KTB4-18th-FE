import { useEffect } from 'react';
import { navigate as navigateTo } from '../../shared/navigation';
import { MapMorphCanvas } from './MapMorphCanvas';
import { useMapIntro } from './useMapIntro';
import { ZoneMapCanvas } from './ZoneMapCanvas';
import { useMapZones } from './useMapZones';

type MainDestination = 'map' | 'records' | 'chatRooms' | 'my';

type Route = {
  destination: MainDestination | 'recordCreate';
  path: string;
};

const routes: Record<MainDestination | 'recordCreate', Route> = {
  map: { destination: 'map', path: '/' },
  records: { destination: 'records', path: '/music-records' },
  recordCreate: { destination: 'recordCreate', path: '/music-records/new' },
  chatRooms: { destination: 'chatRooms', path: '/chat' },
  my: { destination: 'my', path: '/my' },
};

function getRoute(pathname: string): Route {
  return Object.values(routes).find((route) => route.path === pathname) ?? routes.map;
}

type MapSectionProps = {
  isIntro: boolean;
  isMorphReady: boolean;
  onMorphComplete: () => void;
  state: ReturnType<typeof useMapZones>;
};

function MapSection({ isIntro, isMorphReady, onMorphComplete, state }: MapSectionProps) {
  if (state.status === 'loading' && !isIntro) {
    return (
      <section className="main-content main-content--map" aria-label="대한민국 음악 지도">
        <div className="map-loading" role="status">
          <span className="map-loading__dot" />
          지도를 준비하고 있어요.
        </div>
      </section>
    );
  }

  const gridDots = state.status === 'loading' ? [] : state.gridDots;
  const items = state.status === 'loading' ? [] : state.items;

  return (
    <section className="main-content main-content--map" aria-label="대한민국 음악 지도">
      <ZoneMapCanvas
        gridDots={gridDots}
        items={items}
        isFallback={state.status === 'fallback'}
        isIntro={isIntro}
      >
        {isIntro && (
          <MapMorphCanvas
            gridDots={gridDots}
            isActive={isMorphReady}
            onComplete={onMorphComplete}
          />
        )}
      </ZoneMapCanvas>
    </section>
  );
}

type PlaceholderDestination = Exclude<MainDestination, 'map'> | 'recordCreate';

function PlaceholderSection({ destination }: { destination: PlaceholderDestination }) {
  const copy = {
    records: ['기록', '음악으로 남긴 오늘의 순간을 모아볼까요?'],
    recordCreate: ['새 기록', '지금 떠오른 이야기를 음악과 함께 남겨보세요.'],
    chatRooms: ['채팅', '취향이 닿는 사람들과 이야기를 나눠요.'],
    my: ['마이', '나의 음악 여정을 한눈에 확인해요.'],
  } as const;
  const [title, description] = copy[destination];

  return (
    <section className="main-content placeholder-section" aria-labelledby={`${destination}-title`}>
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
  currentDestination: MainDestination | 'recordCreate';
  isHidden: boolean;
  onNavigate: (destination: MainDestination | 'recordCreate') => void;
};

type GnbItem = {
  destination: MainDestination;
  label: string;
  iconPath: string;
};

export function Gnb({ currentDestination, isHidden, onNavigate }: GnbProps) {
  const items: GnbItem[] = [
    { destination: 'map', label: '지도', iconPath: '/icons/map.svg' },
    { destination: 'records', label: '기록', iconPath: '/icons/records.svg' },
    { destination: 'chatRooms', label: '채팅', iconPath: '/icons/chat.svg' },
    { destination: 'my', label: '마이', iconPath: '/icons/mypage.svg' },
  ];

  return (
    <nav className="gnb" aria-label="메인 탐색" aria-hidden={isHidden}>
      <div className="gnb__surface">
        {items.slice(0, 2).map(({ destination, label, iconPath }) => (
          <button
            className={`gnb__item ${currentDestination === destination ? 'gnb__item--active' : ''}`}
            key={destination}
            type="button"
            disabled={isHidden}
            onClick={() => onNavigate(destination)}
            aria-current={currentDestination === destination ? 'page' : undefined}
          >
            <img src={iconPath} alt="" />
            <span>{label}</span>
          </button>
        ))}
        <button
          className="gnb__create"
          type="button"
          disabled={isHidden}
          onClick={() => onNavigate('recordCreate')}
          aria-label="새 기록 만들기"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        {items.slice(2).map(({ destination, label, iconPath }) => (
          <button
            className={`gnb__item ${currentDestination === destination ? 'gnb__item--active' : ''}`}
            key={destination}
            type="button"
            disabled={isHidden}
            onClick={() => onNavigate(destination)}
            aria-current={currentDestination === destination ? 'page' : undefined}
          >
            <img src={iconPath} alt="" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

type MainPageProps = {
  onChat: () => void;
};

export function MainPage({ onChat }: MainPageProps) {
  const route = getRoute(window.location.pathname);
  const mapState = useMapZones();
  const { isCompleted, prefersReducedMotion, completeIntro } = useMapIntro();
  const hasSettledWithoutGrid = mapState.status !== 'loading' && mapState.gridDots.length === 0;
  const isIntro =
    route.destination === 'map' && !isCompleted && !prefersReducedMotion && !hasSettledWithoutGrid;
  const isMapReady = mapState.status !== 'loading' && mapState.gridDots.length > 0;
  const isMorphReady = isIntro && isMapReady;

  useEffect(() => {
    if (
      route.destination === 'map' &&
      !isCompleted &&
      (prefersReducedMotion || hasSettledWithoutGrid)
    ) {
      completeIntro();
    }
  }, [completeIntro, hasSettledWithoutGrid, isCompleted, prefersReducedMotion, route.destination]);

  function navigate(destination: MainDestination | 'recordCreate') {
    if (destination === 'chatRooms') {
      onChat();
      return;
    }

    const nextRoute = routes[destination];
    navigateTo(nextRoute.path);
  }

  return (
    <main
      className={[
        'main-page',
        route.destination === 'map' ? 'main-page--map' : '',
        isIntro ? 'main-page--intro' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <h1 className="sr-only">음악 지도</h1>
      <header className="main-header" aria-hidden={isIntro}>
        <p className="main-header__brand">MEOMUNEUM</p>
      </header>
      {route.destination === 'map' ? (
        <MapSection
          isIntro={isIntro}
          isMorphReady={isMorphReady}
          onMorphComplete={completeIntro}
          state={mapState}
        />
      ) : (
        <PlaceholderSection destination={route.destination} />
      )}
      <a
        className="chatbot-floating-button"
        href="/chatbot"
        aria-label="음악 추천 챗봇 열기"
        aria-hidden={isIntro}
        tabIndex={isIntro ? -1 : 0}
      >
        Chat
      </a>
      <Gnb currentDestination={route.destination} isHidden={isIntro} onNavigate={navigate} />
    </main>
  );
}
