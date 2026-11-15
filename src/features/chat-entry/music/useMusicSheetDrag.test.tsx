import { useRef } from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useMusicSheetDrag } from './useMusicSheetDrag';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function Fixture({
  open = true,
  close = vi.fn(),
  view = 'player',
}: {
  open?: boolean;
  close?: () => void;
  view?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sheet = useMusicSheetDrag(dialog, open, close, view);
  return (
    <dialog ref={dialog} open={open}>
      <div data-testid="handle" {...sheet.handleProps} />
      <button>outside</button>
      <button onClick={sheet.requestClose}>close</button>
    </dialog>
  );
}
function setup(close = vi.fn()) {
  const view = render(<Fixture close={close} />);
  const handle = screen.getByTestId('handle');
  const dialog = handle.closest('dialog')!;
  let captured: number | null = null;
  const capture = vi.fn((id: number) => {
    captured = id;
  });
  const release = vi.fn(() => {
    captured = null;
  });
  Object.assign(handle, {
    setPointerCapture: capture,
    hasPointerCapture: (id: number) => captured === id,
    releasePointerCapture: release,
  });
  const pointer = (type: string, y: number, extra = {}) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientY: y,
      pointerType: 'touch',
      ...extra,
    });
    fireEvent(handle, event);
  };
  return { ...view, handle, dialog, close, capture, release, pointer };
}
it.each([0, 7, 8, 30])('uses an 8px downward release slop at %i', (distance) => {
  const value = setup();
  value.pointer('pointerdown', 25);
  value.pointer('pointermove', 25 + distance);
  expect(value.dialog.style.getPropertyValue('--music-drag-y')).toBe(`${distance}px`);
  value.pointer('pointerup', 25 + distance);
  expect(value.close).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(220));
  expect(value.close).toHaveBeenCalledTimes(distance >= 8 ? 1 : 0);
  expect(value.release).toHaveBeenCalledTimes(1);
  if (distance < 8) expect(value.dialog.style.getPropertyValue('--music-drag-y')).toBe('0px');
});
it('ignores upward movement and uses release position rather than maximum travel', () => {
  const value = setup();
  value.pointer('pointerdown', 100);
  value.pointer('pointermove', 50);
  expect(value.dialog.style.getPropertyValue('--music-drag-y')).toBe('0px');
  value.pointer('pointermove', 700);
  value.pointer('pointerup', 107);
  expect(value.close).not.toHaveBeenCalled();
  expect(value.dialog.style.getPropertyValue('--music-drag-y')).toBe('0px');
});
it.each(['pointercancel', 'lostpointercapture'])('clears capture without closing on %s', (type) => {
  const value = setup();
  value.pointer('pointerdown', 20);
  value.pointer('pointermove', 700);
  value.pointer(type, 700);
  expect(value.dialog.style.getPropertyValue('--music-drag-y')).toBe('0px');
  expect(value.dialog).not.toHaveClass('chat-music-dragging');
  expect(value.release).toHaveBeenCalledTimes(1);
  expect(value.close).not.toHaveBeenCalled();
});
it.each([{ isPrimary: false }, { button: 2 }])('rejects non-primary inputs %j', (extra) => {
  const value = setup();
  value.pointer('pointerdown', 20, extra);
  value.pointer('pointermove', 700);
  value.pointer('pointerup', 700);
  expect(value.capture).not.toHaveBeenCalled();
  expect(value.close).not.toHaveBeenCalled();
});
it('ignores other pointers and outside controls', () => {
  const value = setup();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
  expect(value.capture).not.toHaveBeenCalled();
  value.pointer('pointerdown', 20);
  value.pointer('pointermove', 700, { pointerId: 2 });
  value.pointer('pointerup', 700, { pointerId: 2 });
  expect(value.dialog.style.getPropertyValue('--music-drag-y')).toBe('0px');
  expect(value.close).not.toHaveBeenCalled();
  value.pointer('pointerup', 27);
  expect(value.close).not.toHaveBeenCalled();
});
it('clears an active gesture on close, reopens at zero and releases capture on unmount', () => {
  const value = setup();
  value.pointer('pointerdown', 20);
  value.pointer('pointermove', 220);
  value.rerender(<Fixture open={false} close={value.close} />);
  expect(value.release).toHaveBeenCalledTimes(1);
  value.rerender(<Fixture close={value.close} />);
  expect(value.dialog.style.getPropertyValue('--music-drag-y')).toBe('0px');
  value.pointer('pointerdown', 20);
  value.pointer('pointermove', 100);
  value.unmount();
  expect(value.release).toHaveBeenCalledTimes(2);
  expect(value.close).not.toHaveBeenCalled();
});
it('does not capture while closed or reset active capture for a new close callback', () => {
  const value = setup();
  value.rerender(<Fixture open={false} close={value.close} />);
  value.pointer('pointerdown', 20);
  expect(value.capture).not.toHaveBeenCalled();
  value.rerender(<Fixture close={value.close} />);
  value.pointer('pointerdown', 20);
  value.pointer('pointermove', 220);
  value.rerender(<Fixture close={vi.fn()} />);
  expect(value.dialog.style.getPropertyValue('--music-drag-y')).toBe('200px');
  expect(value.release).not.toHaveBeenCalled();
});

it('shares a guarded close transition and ignores unrelated transition events', () => {
  const value = setup();
  fireEvent.click(screen.getByRole('button', { name: 'close' }));
  fireEvent.click(screen.getByRole('button', { name: 'close' }));
  expect(value.close).not.toHaveBeenCalled();
  expect(value.dialog).toHaveClass('chat-music-drag-closing');
  const end = new Event('transitionend', { bubbles: true });
  Object.assign(end, { propertyName: 'opacity' });
  fireEvent(value.dialog, end);
  expect(value.close).not.toHaveBeenCalled();
  const translateEnd = new Event('transitionend', { bubbles: true });
  Object.assign(translateEnd, { propertyName: 'translate' });
  fireEvent(value.dialog, translateEnd);
  expect(value.close).toHaveBeenCalledTimes(1);
  act(() => vi.runAllTimers());
  expect(value.close).toHaveBeenCalledTimes(1);
});
it.each(['view', 'close', 'unmount'])('cancels delayed close on %s', (kind) => {
  const value = setup();
  fireEvent.click(screen.getByRole('button', { name: 'close' }));
  if (kind === 'view') value.rerender(<Fixture close={value.close} view="search" />);
  else if (kind === 'close') value.rerender(<Fixture close={value.close} open={false} />);
  else value.unmount();
  act(() => vi.runAllTimers());
  expect(value.close).not.toHaveBeenCalled();
});
it('closes immediately for reduced motion', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  const value = setup();
  fireEvent.click(screen.getByRole('button', { name: 'close' }));
  expect(value.close).toHaveBeenCalledTimes(1);
  expect(value.dialog).not.toHaveClass('chat-music-drag-closing');
});
