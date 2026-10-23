import { Component, Suspense } from 'react';
import type { ReactNode } from 'react';

type RouteLoadBoundaryProps = {
  children: ReactNode;
  onReload?: () => void;
};

type RouteLoadBoundaryState = {
  hasError: boolean;
};

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
      <Suspense
        fallback={
          <div className="route-load-feedback" role="status" aria-live="polite">
            화면을 불러오고 있어요.
          </div>
        }
      >
        {this.props.children}
      </Suspense>
    );
  }
}
