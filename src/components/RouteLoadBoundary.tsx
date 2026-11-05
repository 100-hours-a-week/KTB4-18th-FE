import { Component, Suspense } from 'react';
import type { ReactNode } from 'react';

import { useDelayedPending } from '../hooks/useDelayedPending';
import { RouteLoadSkeleton } from './RouteLoadSkeleton';
import type { RouteSkeletonVariant } from './RouteLoadSkeleton';

type RouteLoadBoundaryProps = {
  children: ReactNode;
  onReload?: () => void;
  variant: RouteSkeletonVariant;
};

type RouteLoadBoundaryState = {
  hasError: boolean;
};

function DelayedRouteFallback({ variant }: { variant: RouteSkeletonVariant }) {
  const shouldShowSkeleton = useDelayedPending(true, variant);
  return shouldShowSkeleton ? <RouteLoadSkeleton variant={variant} /> : null;
}

export class RouteLoadBoundary extends Component<RouteLoadBoundaryProps, RouteLoadBoundaryState> {
  state: RouteLoadBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RouteLoadBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="route-load-feedback" role="alert">
          <p>화면을 불러오지 못했어요. 다시 시도해 주세요.</p>
          <button type="button" onClick={this.props.onReload ?? (() => window.location.reload())}>
            새로고침
          </button>
        </div>
      );
    }

    return (
      <Suspense fallback={<DelayedRouteFallback variant={this.props.variant} />}>
        {this.props.children}
      </Suspense>
    );
  }
}
