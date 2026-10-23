import { lazy } from 'react';
import type { ComponentType } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RouteLoadBoundary } from './RouteLoadBoundary';

const PendingPage = lazy(() => new Promise<{ default: ComponentType }>(() => undefined));
const FailedPage = lazy(() => Promise.reject(new Error('route chunk failed')));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RouteLoadBoundary', () => {
  it('announces while a route module is pending', () => {
    render(
      <RouteLoadBoundary>
        <PendingPage />
      </RouteLoadBoundary>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('화면을 불러오고 있어요.');
  });

  it('shows an alert and reload action after a route module fails, then resets for another route', async () => {
    const reload = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <RouteLoadBoundary key="/failed" onReload={reload}>
        <FailedPage />
      </RouteLoadBoundary>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '화면을 불러오지 못했어요. 다시 시도해 주세요.',
    );
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    expect(reload).toHaveBeenCalledOnce();

    rerender(
      <RouteLoadBoundary key="/another-route">
        <h1>다른 화면</h1>
      </RouteLoadBoundary>,
    );
    expect(screen.getByRole('heading', { name: '다른 화면' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
