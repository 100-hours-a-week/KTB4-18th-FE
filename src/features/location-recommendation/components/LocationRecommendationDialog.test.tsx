import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  LocationRecommendationCandidate,
  LocationRecommendationTrack,
} from '../locationRecommendationTypes';
import { LocationRecommendationDialog } from './LocationRecommendationDialog';

const previewMocks = vi.hoisted(() => ({ toggle: vi.fn(), stop: vi.fn() }));

vi.mock('../../music-record/hooks/useMusicPreview', () => ({
  useMusicPreview: () => ({
    activeTrack: null,
    isPlaying: false,
    isLoading: false,
    error: '',
    toggle: previewMocks.toggle,
    stop: previewMocks.stop,
  }),
}));

vi.mock('../api/itunesTrackSearch', () => ({
  resolveItunesTrack: vi.fn(async (track: LocationRecommendationTrack) => track),
}));

const makeTrack = (index: number): LocationRecommendationTrack => ({
  trackId: `track-${index}`,
  title: `노래 ${index}`,
  artist: `가수 ${index}`,
  previewUrl: `https://example.com/preview-${index}.mp3`,
  artworkUrl: null,
  storeUrl: null,
});

const candidate: LocationRecommendationCandidate = {
  authEpoch: 'auth-epoch',
  accessEventId: '123e4567-e89b-42d3-a456-426614174000',
  operationUUID: '223e4567-e89b-42d3-a456-426614174001',
  accessSequence: 1,
  leaderEpoch: 1,
  requestId: '323e4567-e89b-42d3-a456-426614174002',
  region: { regionId: 1, code: '11110', name: '종로구', sidoName: '서울특별시' },
  tracks: [makeTrack(1)],
  scopeGeneration: '423e4567-e89b-42d3-a456-426614174003',
  cancelEpoch: 0,
  remainingTtlMs: 60_000,
  receivedAt: 1,
  sourceWorkerInstanceId: 'worker',
  sourceStateRevision: 1,
};

const renderDialog = (
  nextCandidate = candidate,
  onCancel = vi.fn(),
  verifyStatus = vi.fn().mockResolvedValue(true),
) =>
  render(
    <LocationRecommendationDialog
      candidate={nextCandidate}
      verifyStatus={verifyStatus}
      onCancel={onCancel}
      onDismiss={vi.fn()}
    />,
  );

beforeEach(() => {
  const portalRoot = document.createElement('div');
  portalRoot.className = 'location-recommendation-portal-root';
  document.body.append(portalRoot);
});

afterEach(() => {
  cleanup();
  document.querySelector('.location-recommendation-portal-root')?.remove();
  vi.clearAllMocks();
});

describe('LocationRecommendationDialog', () => {
  it('renders a single featured song and starts preview only after the user clicks', async () => {
    renderDialog();

    expect(screen.getByText('새로운 지역에서 음악을 발견했어요!')).toBeInTheDocument();
    expect(screen.getByText('서울특별시 종로구')).toBeInTheDocument();
    expect(screen.getByText('노래 1')).toBeInTheDocument();
    expect(screen.getByText(/추천은 음악 기록에 자동 저장되지 않아요/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다음 추천곡' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /저장/ })).not.toBeInTheDocument();
    expect(previewMocks.toggle).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '미리 듣기: 노래 1' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: '미리 듣기: 노래 1' }));
    expect(previewMocks.toggle).toHaveBeenCalledWith(
      'track-1',
      'https://example.com/preview-1.mp3',
    );
  });

  it('lets the user browse five songs with arrows and indexed controls', () => {
    renderDialog({ ...candidate, tracks: [1, 2, 3, 4, 5].map(makeTrack) });

    expect(screen.getByText('노래 1')).toBeInTheDocument();
    expect(screen.queryByText('노래 2')).not.toBeInTheDocument();
    expect(screen.getByText('1 / 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이전 추천곡' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '이전 추천곡' }));
    expect(screen.getByText('노래 5')).toBeInTheDocument();
    expect(screen.getByText('5 / 5')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '다음 추천곡' }));
    expect(screen.getByText('노래 1')).toBeInTheDocument();
    expect(screen.getByText('1 / 5')).toBeInTheDocument();

    previewMocks.stop.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '다음 추천곡' }));
    expect(screen.getByText('노래 2')).toBeInTheDocument();
    expect(previewMocks.stop).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '추천곡 5: 노래 5 선택' }));
    expect(screen.getByText('노래 5')).toBeInTheDocument();
    expect(screen.getByText('5 / 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다음 추천곡' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '추천곡 5: 노래 5 선택' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('changes tracks with horizontal drags and ignores vertical or cancelled gestures', () => {
    renderDialog({ ...candidate, tracks: [1, 2, 3, 4, 5].map(makeTrack) });
    const carousel = screen.getByRole('group', { name: /지역 추천 음악/ });
    const currentSlide = carousel.querySelector<HTMLElement>(
      '.location-recommendation-carousel__slide--current',
    );
    const nextSlide = carousel.querySelector<HTMLElement>(
      '.location-recommendation-carousel__slide--next',
    );
    const stage = carousel.querySelector<HTMLElement>('.location-recommendation-carousel__stage');
    if (!currentSlide || !nextSlide || !stage) {
      throw new Error('carousel side cards were not rendered');
    }
    Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 400 });
    const initialNextLeft = Number.parseFloat(nextSlide.style.left);
    const initialNextScale = Number(nextSlide.style.transform.match(/scale\(([^)]+)\)/)?.[1]);
    Object.defineProperty(carousel, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });

    fireEvent.pointerDown(carousel, {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 300,
      clientY: 100,
    });
    fireEvent.pointerMove(carousel, {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 180,
      clientY: 100,
    });
    const currentScale = Number(currentSlide.style.transform.match(/scale\(([^)]+)\)/)?.[1]);
    const nextScale = Number(nextSlide.style.transform.match(/scale\(([^)]+)\)/)?.[1]);
    expect(Number.parseFloat(nextSlide.style.left)).toBeLessThan(initialNextLeft);
    expect(nextScale).toBeGreaterThan(initialNextScale);
    expect(currentScale).toBeLessThan(1);
    fireEvent.pointerUp(carousel, {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 180,
      clientY: 100,
    });
    expect(screen.getByText('2 / 5')).toBeInTheDocument();

    fireEvent.pointerDown(carousel, {
      pointerId: 2,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 180,
      clientY: 100,
    });
    fireEvent.pointerUp(carousel, {
      pointerId: 2,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 300,
      clientY: 100,
    });
    expect(screen.getByText('1 / 5')).toBeInTheDocument();

    fireEvent.pointerDown(carousel, {
      pointerId: 3,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 200,
      clientY: 100,
    });
    fireEvent.pointerMove(carousel, {
      pointerId: 3,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 120,
      clientY: 220,
    });
    fireEvent.pointerUp(carousel, {
      pointerId: 3,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 120,
      clientY: 220,
    });
    expect(screen.getByText('1 / 5')).toBeInTheDocument();

    fireEvent.pointerDown(carousel, {
      pointerId: 4,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 300,
      clientY: 100,
    });
    fireEvent.pointerCancel(carousel, {
      pointerId: 4,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 180,
      clientY: 100,
    });
    expect(screen.getByText('1 / 5')).toBeInTheDocument();
  });

  it('disables unavailable previews and uses artwork fallback for missing art', () => {
    const noMediaTrack = { ...makeTrack(1), previewUrl: null };
    renderDialog({ ...candidate, tracks: [noMediaTrack] });

    expect(screen.getByRole('button', { name: '미리 듣기: 노래 1' })).toBeDisabled();
    expect(screen.getByRole('dialog').querySelector('img')).toHaveAttribute(
      'src',
      '/album-placeholder.svg',
    );
    expect(previewMocks.toggle).not.toHaveBeenCalled();
  });

  it('keeps the dialog open on Escape until the close button is clicked', () => {
    const onCancel = vi.fn();
    renderDialog(candidate, onCancel);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '추천을 닫으려면 닫기 버튼을 눌러 주세요.',
    );
    fireEvent.click(screen.getByRole('button', { name: '추천 닫기' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not poll READY status on a timer', async () => {
    vi.useFakeTimers();
    const verifyStatus = vi.fn().mockResolvedValue(true);
    renderDialog(candidate, vi.fn(), verifyStatus);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(verifyStatus).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('moves focus into the dialog, wraps Tab, and restores focus after unmount', async () => {
    const focusAnchor = document.createElement('button');
    document.body.append(focusAnchor);
    focusAnchor.focus();
    const { unmount } = renderDialog({ ...candidate, tracks: [1, 2, 3, 4, 5].map(makeTrack) });
    const closeButton = screen.getByRole('button', { name: '추천 닫기' });
    const nextButton = screen.getByRole('button', { name: '다음 추천곡' });

    expect(document.activeElement).toBe(closeButton);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(nextButton);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    unmount();
    await waitFor(() => expect(document.activeElement).toBe(focusAnchor));
    focusAnchor.remove();
  });

  it('rechecks status after returning from a tab switch while an earlier check is pending', async () => {
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    let resolveBeforeHide!: (isValid: boolean) => void;
    let resolveOnReturn!: (isValid: boolean) => void;
    const beforeHide = new Promise<boolean>((resolve) => {
      resolveBeforeHide = resolve;
    });
    const onReturn = new Promise<boolean>((resolve) => {
      resolveOnReturn = resolve;
    });
    const verifyStatus = vi.fn().mockReturnValueOnce(beforeHide).mockReturnValueOnce(onReturn);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    try {
      renderDialog(candidate, vi.fn(), verifyStatus);
      const previewButton = screen.getByRole('button', { name: '미리 듣기: 노래 1' });
      fireEvent(document, new Event('visibilitychange'));
      expect(verifyStatus).toHaveBeenCalledOnce();

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      fireEvent(document, new Event('visibilitychange'));
      expect(previewButton).toBeDisabled();

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      fireEvent(document, new Event('visibilitychange'));
      expect(verifyStatus).toHaveBeenCalledOnce();

      await act(async () => {
        resolveBeforeHide(true);
        await beforeHide;
      });
      expect(verifyStatus).toHaveBeenCalledTimes(2);
      expect(previewButton).toBeDisabled();

      await act(async () => {
        resolveOnReturn(true);
        await onReturn;
      });
      await waitFor(() => expect(previewButton).toBeEnabled());
    } finally {
      if (visibilityDescriptor) {
        Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
      } else {
        Reflect.deleteProperty(document, 'visibilityState');
      }
    }
  });
});
