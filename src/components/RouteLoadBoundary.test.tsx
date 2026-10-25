import { lazy } from 'react';
import type { ComponentType } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RouteLoadBoundary } from './RouteLoadBoundary';

const PendingPage = lazy(() => new Promise<{ default: ComponentType }>(() => undefined));
const FailedPage = lazy(() => Promise.reject(new Error('route chunk failed')));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RouteLoadBoundary', () => {
  it.each([
    'login',
    'signup',
    'chat-entry',
    'my-page',
    'music-list',
    'music-create',
    'music-detail',
    'chatbot',
  ] as const)('shows the %s page layout while a route module is pending', (variant) => {
    render(
      <RouteLoadBoundary variant={variant}>
        <PendingPage />
      </RouteLoadBoundary>,
    );

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveClass(`route-skeleton--${variant}`);
    expect(screen.getByText('페이지 내용을 준비하고 있어요.')).toBeInTheDocument();
  });

  it('shows an alert and reload action after a route module fails, then resets for another route', async () => {
    const reload = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <RouteLoadBoundary key="/failed" variant="chatbot" onReload={reload}>
        <FailedPage />
      </RouteLoadBoundary>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '화면을 불러오지 못했어요. 다시 시도해 주세요.',
    );
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    expect(reload).toHaveBeenCalledOnce();

    rerender(
      <RouteLoadBoundary key="/another-route" variant="my-page">
        <h1>다른 화면</h1>
      </RouteLoadBoundary>,
    );
    expect(screen.getByRole('heading', { name: '다른 화면' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
