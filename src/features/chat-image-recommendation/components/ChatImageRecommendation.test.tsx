import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resizeRecommendationImage,
  submitImageRecommendation,
  waitForImageVerdict,
} from '../api/imageRecommendation';
import { ChatImageRecommendation } from './ChatImageRecommendation';

vi.mock('../api/imageRecommendation', () => ({
  resizeRecommendationImage: vi.fn(),
  submitImageRecommendation: vi.fn(),
  waitForImageVerdict: vi.fn(),
}));

describe('ChatImageRecommendation', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(resizeRecommendationImage).mockResolvedValue(
      new Blob(['jpeg'], { type: 'image/jpeg' }),
    );
    vi.mocked(submitImageRecommendation).mockResolvedValue({
      recommendation_id: 42,
      status: 'PROCESSING',
      conversation_key: 'conversation',
    });
  });

  it('waits for confirmation and hands off only after usable verdict', async () => {
    vi.mocked(waitForImageVerdict).mockResolvedValue(true);
    const user = userEvent.setup();
    const onUsable = vi.fn();
    render(
      <ChatImageRecommendation
        conversationKey="conversation"
        disabled={false}
        onUsable={onUsable}
      />,
    );
    await user.click(screen.getByRole('button', { name: '사진으로 음악 찾기' }));
    expect(screen.getByRole('heading', { name: '지금 주변을 찍어주세요' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '사진 촬영하기' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '주변을 촬영한 뒤 음악을 찾아보세요' }),
    ).toBeDisabled();
    const input = screen.getByLabelText('장소 사진 촬영 또는 선택') as HTMLInputElement;
    expect(input).toHaveAttribute('capture', 'environment');
    await user.upload(input, new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
    expect(
      screen.getByRole('heading', { name: '이 분위기에 맞는 음악을 찾아볼까요?' }),
    ).toBeInTheDocument();
    expect(submitImageRecommendation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '이 사진으로 음악 찾기' }));
    await waitFor(() =>
      expect(onUsable).toHaveBeenCalledWith(42, 'blob:preview', expect.any(Date)),
    );
    expect(submitImageRecommendation).toHaveBeenCalledTimes(1);
  });

  it('keeps the image page open and shows the Figma retake sheet for rejected verdict', async () => {
    vi.mocked(waitForImageVerdict).mockResolvedValue(false);
    const user = userEvent.setup();
    const onUsable = vi.fn();
    render(
      <ChatImageRecommendation
        conversationKey="conversation"
        disabled={false}
        onUsable={onUsable}
      />,
    );
    await user.click(screen.getByRole('button', { name: '사진으로 음악 찾기' }));
    await user.upload(
      screen.getByLabelText('장소 사진 촬영 또는 선택'),
      new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    await user.click(screen.getByRole('button', { name: '이 사진으로 음악 찾기' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('이미지 속 장면을 확인하기 어려워요')).toBeInTheDocument();
    expect(screen.getByText('장면이 잘 보이도록 다시 촬영해 주세요.')).toBeInTheDocument();
    expect(onUsable).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '사진으로 음악 찾기' })).toBeInTheDocument();
  });
});
