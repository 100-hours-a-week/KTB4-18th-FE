import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LocationUseNotice } from './LocationUseNotice';

afterEach(() => cleanup());

describe('LocationUseNotice', () => {
  it('explains one-time service-entry checks, recipients, and provider handling before acknowledgement', () => {
    const onAcknowledge = vi.fn();
    const onDismiss = vi.fn();
    render(<LocationUseNotice onAcknowledge={onAcknowledge} onDismiss={onDismiss} />);

    expect(screen.getByRole('dialog', { name: '음악 추천에 위치를 사용해요' })).toBeInTheDocument();
    expect(
      screen.getByText(/현재 안내\(v4\).*서비스에 접속하면 위치를 한 번 확인해요/),
    ).toBeInTheDocument();
    expect(screen.getByText(/카카오 로컬, 추천을 위해 AI 서버에 좌표를 전달/)).toBeInTheDocument();
    expect(screen.getByText(/Open-Meteo에서 확인해요/)).toBeInTheDocument();
    expect(
      screen.getByText(/정확한 좌표를 저장하거나 로그에 남기지 않도록 설계/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '확인하고 계속하기' }));
    expect(onAcknowledge).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('can be skipped without acknowledging location use', () => {
    const onAcknowledge = vi.fn();
    const onDismiss = vi.fn();
    render(<LocationUseNotice onAcknowledge={onAcknowledge} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: '지금은 건너뛰기' }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onAcknowledge).not.toHaveBeenCalled();
  });
});
