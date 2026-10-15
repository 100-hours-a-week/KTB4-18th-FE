import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueueRequestError, type LoginQueueTicket } from '../api/loginQueueApi';
import type { LoginSuccessResponse } from '../api/loginApi';
import * as authSession from '../api/authSession';
import { LoginPage } from './LoginPage';

const queueSignals = vi.hoisted(() => ({
  listener: null as null | ((signal: { type: string; queueGeneration: string }) => void),
}));

vi.mock('../api/loginQueueApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/loginQueueApi')>()),
  startOrResumeLoginQueue: vi.fn(),
  submitQueuedLogin: vi.fn(),
  getLoginQueueStatus: vi.fn(),
  reconcileLoginQueueStatus: vi.fn(),
  subscribeQueueSignals: vi.fn((listener) => {
    queueSignals.listener = listener;
    return () => {
      queueSignals.listener = null;
    };
  }),
  getLoginOperationId: vi.fn(() => 'operation-id'),
  getLoginQueueGeneration: vi.fn(() => 'live-generation'),
  clearLoginOperationId: vi.fn(),
  publishQueueSignal: vi.fn(),
  cancelLoginQueue: vi.fn(),
  recoverQueuedLogin: vi.fn(),
}));

import {
  clearLoginOperationId,
  getLoginQueueGeneration,
  getLoginQueueStatus,
  reconcileLoginQueueStatus,
  recoverQueuedLogin,
  startOrResumeLoginQueue,
  submitQueuedLogin,
  cancelLoginQueue,
} from '../api/loginQueueApi';

const successResponse: LoginSuccessResponse = {
  message: 'login success',
  data: { access_token: 'test-token', expires_in: 3600 },
};
const readyTicket: LoginQueueTicket = {
  status: 'READY',
  loginOutcome: null,
  usersAhead: 0,
  nextPollSeconds: 10,
};

beforeEach(() => {
  vi.mocked(startOrResumeLoginQueue)
    .mockReset()
    .mockResolvedValue({ ...readyTicket });
  vi.mocked(submitQueuedLogin).mockReset().mockResolvedValue(successResponse);
  vi.mocked(getLoginQueueStatus).mockReset().mockRejectedValue(new QueueRequestError(404));
  vi.mocked(clearLoginOperationId).mockReset();
  vi.mocked(recoverQueuedLogin).mockReset();
  vi.mocked(cancelLoginQueue).mockReset().mockResolvedValue(undefined);
  vi.mocked(getLoginQueueGeneration).mockReturnValue('live-generation');
  queueSignals.listener = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('LoginPage email input', () => {
  it('submits retained credentials after the queue becomes RETRYABLE', async () => {
    vi.useFakeTimers();
    const retryableTicket: LoginQueueTicket = {
      status: 'RETRYABLE',
      loginOutcome: null,
      usersAhead: 0,
      nextPollSeconds: 10,
    };
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce({
      status: 'WAITING',
      loginOutcome: null,
      usersAhead: 1,
      nextPollSeconds: 10,
    });
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce(retryableTicket);
    const onLoginSuccess = vi.fn();
    render(<LoginPage onLoginSuccess={onLoginSuccess} />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(submitQueuedLogin).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(submitQueuedLogin).toHaveBeenCalledTimes(1);
    expect(submitQueuedLogin).toHaveBeenCalledWith(
      { email: 'user@example.com', password: 'secret' },
      'live-generation',
    );
    expect(onLoginSuccess).toHaveBeenCalledWith(successResponse);
  });

  it.each([
    ['CANCELLED', '대기를 취소했어요. 다시 로그인해 주세요.'],
    ['EXPIRED', '대기 시간이 만료되었어요. 다시 로그인해 주세요.'],
  ] as const)('ends a terminal %s ticket without posting credentials', async (status, message) => {
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce({
      status,
      loginOutcome: null,
      usersAhead: 0,
      nextPollSeconds: 10,
    });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'secret');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(submitQueuedLogin).not.toHaveBeenCalled();
    expect(screen.getByLabelText('비밀번호')).toHaveValue('');
  });

  it('clears credentials when exhausted-ticket reconciliation receives HTTP 410', async () => {
    vi.mocked(startOrResumeLoginQueue).mockRejectedValueOnce(
      new QueueRequestError(null, 'CREATE_RETRIES_EXHAUSTED'),
    );
    vi.mocked(reconcileLoginQueueStatus).mockRejectedValueOnce(
      new QueueRequestError(410, 'TICKET_EXPIRED'),
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'secret');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await user.click(await screen.findByRole('button', { name: '상태 확인' }));

    expect(
      await screen.findByText('대기 시간이 만료되었어요. 다시 로그인해 주세요.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toHaveValue('');
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it('ignores an initial ticket response made stale while the user re-enters credentials', async () => {
    let resolveStatus!: (ticket: LoginQueueTicket) => void;
    vi.mocked(getLoginQueueStatus).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');

    await act(async () => {
      resolveStatus({
        status: 'RETRYABLE',
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      });
      await Promise.resolve();
    });

    expect(screen.getByLabelText('이메일')).toHaveValue('user@example.com');
    expect(screen.getByLabelText('비밀번호')).toHaveValue('password');
    expect(screen.queryByText(/비밀번호를 다시 입력해/)).not.toBeInTheDocument();
  });

  it('restores the existing refresh-cookie session when selected after an ambiguous login', async () => {
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(new QueueRequestError(null));
    vi.mocked(getLoginQueueStatus).mockRejectedValue(new QueueRequestError(404));
    vi.spyOn(authSession, 'refreshAccessToken').mockResolvedValue('restored-token');
    vi.spyOn(authSession, 'getAccessTokenExpiresAt').mockReturnValue(Date.now() + 60_000);
    const onLoginSuccess = vi.fn();
    const user = userEvent.setup();
    render(<LoginPage onLoginSuccess={onLoginSuccess} />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await user.click(await screen.findByRole('button', { name: '이전 로그인 상태 계속하기' }));

    expect(authSession.refreshAccessToken).toHaveBeenCalledOnce();
    expect(onLoginSuccess).toHaveBeenCalledOnce();
    expect(onLoginSuccess.mock.calls[0][0]).toMatchObject({
      message: 'login success',
      data: { access_token: 'restored-token', expires_in: expect.any(Number) },
    });
    expect(onLoginSuccess.mock.calls[0][0].data.expires_in).toBeGreaterThan(0);
    expect(onLoginSuccess.mock.calls[0][0].data.expires_in).toBeLessThanOrEqual(60);
  });

  it('retains the login operation ID when restarting an ambiguous attempt', async () => {
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(new QueueRequestError(null));
    vi.mocked(getLoginQueueStatus).mockRejectedValue(new QueueRequestError(404));
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await user.click(await screen.findByRole('button', { name: '새로 로그인하기' }));

    expect(clearLoginOperationId).not.toHaveBeenCalled();
  });

  it('keeps Korean characters as typed', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const emailInput = screen.getByLabelText('이메일');
    await user.type(emailInput, '한글User+tag@Example.com');

    expect(emailInput).toHaveValue('한글user+tag@example.com');
  });

  it.each([
    ['user@한글.com', 'user@한글.com'],
    ['한글User+tag@Example.com', '한글user+tag@example.com'],
    ['User.name_12+tag-test@Example.com', 'user.name_12+tag-test@example.com'],
  ])('keeps Korean and supported email characters from pasted %s', async (input, expected) => {
    const user = userEvent.setup();
    render(<LoginPage />);
    const emailInput = screen.getByLabelText('이메일');
    await user.click(emailInput);
    await user.paste(input);
    expect(emailInput).toHaveValue(expected);
  });

  it('keeps Korean characters during IME composition', () => {
    render(<LoginPage />);
    const emailInput = screen.getByLabelText<HTMLInputElement>('이메일');
    fireEvent.compositionStart(emailInput);
    fireEvent.change(emailInput, { target: { value: 'user@한글.com' } });

    expect(emailInput).toHaveValue('user@한글.com');

    fireEvent.compositionEnd(emailInput, { data: '한글' });
    expect(emailInput).toHaveValue('user@한글.com');
    expect(emailInput.value).toMatch(/[가-힣]/);
  });

  it('submits the Korean email as entered', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    const emailInput = screen.getByLabelText('이메일');
    const setNativeValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;

    // Simulate the browser committing the complete IME value before compositionend.
    setNativeValue?.call(emailInput, 'user@한글.com');
    fireEvent.compositionEnd(emailInput, { data: '한글' });

    expect(emailInput).toHaveValue('user@한글.com');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    fireEvent.submit(emailInput.closest('form')!);
    await vi.waitFor(() =>
      expect(submitQueuedLogin).toHaveBeenCalledExactlyOnceWith(
        { email: 'user@한글.com', password: 'password' },
        'live-generation',
      ),
    );
  });

  it('keeps Korean characters before submitting even if composition has not blurred', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    const emailInput = screen.getByLabelText('이메일');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    fireEvent.compositionStart(emailInput);
    fireEvent.change(emailInput, { target: { value: 'user@한글.com' } });

    expect(emailInput).toHaveValue('user@한글.com');
    fireEvent.submit(emailInput.closest('form')!);

    expect(emailInput).toHaveValue('user@한글.com');
    await vi.waitFor(() =>
      expect(submitQueuedLogin).toHaveBeenCalledExactlyOnceWith(
        { email: 'user@한글.com', password: 'password' },
        'live-generation',
      ),
    );
  });

  it('blocks login when the Korean email remains malformed', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    const emailInput = screen.getByLabelText('이메일');
    const setNativeValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;

    setNativeValue?.call(emailInput, 'user@한글');
    fireEvent.compositionEnd(emailInput, { data: '한글' });
    expect(emailInput).toHaveValue('user@한글');
    expect(screen.getByRole('alert')).toHaveTextContent('이메일 형식을 확인해 주세요.');

    await user.type(screen.getByLabelText('비밀번호'), 'password');
    fireEvent.submit(emailInput.closest('form')!);
    expect(startOrResumeLoginQueue).not.toHaveBeenCalled();
  });

  it('keeps Korean characters from input events marked as composing', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    const emailInput = screen.getByLabelText('이메일');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    fireEvent.input(emailInput, { target: { value: 'user@한글.com' }, isComposing: true });
    expect(emailInput).toHaveValue('user@한글.com');
    expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled();
    fireEvent.compositionEnd(emailInput);
    expect(emailInput).toHaveValue('user@한글.com');
    expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled();
  });

  it('provides signup email input hints without introducing its length limit', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    const emailInput = screen.getByLabelText('이메일');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(emailInput).toHaveAttribute('aria-invalid', 'false');
    expect(emailInput).not.toHaveAttribute('aria-describedby');
    expect(emailInput).toHaveAttribute('autocapitalize', 'none');
    expect(emailInput).toHaveAttribute('autocorrect', 'off');
    expect(emailInput).toHaveAttribute('spellcheck', 'false');
    expect(emailInput).not.toHaveAttribute('lang');
    expect(emailInput).not.toHaveAttribute('maxlength');
    fireEvent.change(emailInput, { target: { value: 'user@example.com' } });
    expect(emailInput).toHaveValue('user@example.com');
    expect(emailInput).toHaveAttribute('aria-invalid', 'false');
    expect(emailInput).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const longEmail = `${'a'.repeat(45)}@Example.com`;
    fireEvent.change(emailInput, { target: { value: ` ${longEmail} ` } });
    expect(emailInput).toHaveValue(longEmail.toLowerCase());
    expect(emailInput).toHaveAttribute('aria-invalid', 'false');
    expect(emailInput).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.blur(emailInput);
    expect(startOrResumeLoginQueue).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    expect(submitQueuedLogin).toHaveBeenCalledExactlyOnceWith(
      { email: longEmail.toLowerCase(), password: 'password' },
      'live-generation',
    );
  });

  it('shows format feedback while typing and clears it as soon as the email becomes valid', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    const emailInput = screen.getByLabelText('이메일');

    await user.type(emailInput, 'user@invalid');
    expect(screen.getByRole('alert')).toHaveTextContent('이메일 형식을 확인해 주세요.');
    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    expect(emailInput).toHaveAttribute('aria-describedby', 'email-error');

    await user.type(emailInput, '.com');
    expect(emailInput).toHaveValue('user@invalid.com');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(emailInput).toHaveAttribute('aria-invalid', 'false');
    expect(emailInput).not.toHaveAttribute('aria-describedby');
  });

  it('switches to the required message when an invalid email is cleared', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    const emailInput = screen.getByLabelText('이메일');
    await user.type(emailInput, 'user@invalid');
    await user.clear(emailInput);
    expect(screen.getByRole('alert')).toHaveTextContent('이메일을 입력해 주세요.');
    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    expect(emailInput).toHaveAttribute('aria-describedby', 'email-error');
  });

  it('validates the current empty or malformed email when the field loses focus', () => {
    render(<LoginPage />);
    const emailInput = screen.getByLabelText('이메일');
    fireEvent.focus(emailInput);
    fireEvent.blur(emailInput);
    expect(screen.getByRole('alert')).toHaveTextContent('이메일을 입력해 주세요.');
    expect(emailInput).toHaveAttribute('aria-describedby', 'email-error');

    fireEvent.change(emailInput, { target: { value: 'user@invalid' } });
    fireEvent.blur(emailInput);
    expect(screen.getByRole('alert')).toHaveTextContent('이메일 형식을 확인해 주세요.');
    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    expect(emailInput).toHaveAttribute('aria-describedby', 'email-error');
    expect(startOrResumeLoginQueue).not.toHaveBeenCalled();
  });

  it('handles cancellation to an empty value and allows a subsequent normal input', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    const emailInput = screen.getByLabelText('이메일');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    fireEvent.compositionStart(emailInput);
    fireEvent.change(emailInput, { target: { value: 'ㅎ' } });
    fireEvent.change(emailInput, { target: { value: '' } });
    fireEvent.compositionEnd(emailInput, { data: '' });
    expect(emailInput).toHaveValue('');
    expect(screen.getByRole('button', { name: '로그인' })).toBeDisabled();
    await user.type(emailInput, 'User@Example.com');
    expect(emailInput).toHaveValue('user@example.com');
    expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled();
  });

  it('sends the normalized email and preserves the original password', async () => {
    const user = userEvent.setup();
    const onLoginSuccess = vi.fn();
    render(<LoginPage onLoginSuccess={onLoginSuccess} />);
    await user.type(screen.getByLabelText('이메일'), 'abc@Example.com');
    await user.type(screen.getByLabelText('비밀번호'), ' PaSs한글! ');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    expect(submitQueuedLogin).toHaveBeenCalledExactlyOnceWith(
      { email: 'abc@example.com', password: ' PaSs한글! ' },
      'live-generation',
    );
    expect(onLoginSuccess).toHaveBeenCalledExactlyOnceWith(successResponse);
  });

  it('enables the login button only after the email and password are valid', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const loginButton = screen.getByRole('button', { name: '로그인' });
    expect(loginButton).toBeDisabled();
    await user.type(screen.getByLabelText('이메일'), '한글');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    expect(loginButton).toBeDisabled();
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    expect(startOrResumeLoginQueue).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('이메일 형식을 확인해 주세요.');
    await user.clear(screen.getByLabelText('이메일'));
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    expect(loginButton).toBeEnabled();
  });

  it('keeps normalized ASCII input and the existing authentication error on login failure', async () => {
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(
      new QueueRequestError(401, 'INVALID_CREDENTIALS'),
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'abc@Example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이메일 또는 비밀번호를 확인해 주세요.',
    );
    expect(screen.getByLabelText('이메일')).toHaveValue('abc@example.com');
    expect(screen.getByLabelText('비밀번호')).toHaveValue('');
    expect(screen.getByRole('button', { name: '로그인' })).toBeDisabled();
  });

  it('blocks duplicate submits while the login request is pending', async () => {
    let finishLogin!: (response: LoginSuccessResponse) => void;
    vi.mocked(submitQueuedLogin).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLogin = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    const emailInput = screen.getByLabelText('이메일');
    await user.type(emailInput, 'abc@Example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    expect(screen.getByRole('button', { name: '로그인' })).toBeDisabled();
    fireEvent.submit(emailInput.closest('form')!);
    expect(submitQueuedLogin).toHaveBeenCalledTimes(1);
    await act(async () => finishLogin(successResponse));
    expect(screen.getByRole('button', { name: '로그인' })).toBeDisabled();
  });

  it('waits for READY and refreshes the approximate position every ten seconds', async () => {
    vi.useFakeTimers();
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce({
      status: 'WAITING',
      loginOutcome: null,
      usersAhead: 7,
      nextPollSeconds: 10,
    });
    vi.mocked(getLoginQueueStatus)
      .mockReset()
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce({ ...readyTicket });
    render(<LoginPage />);
    const email = screen.getByLabelText('이메일');
    fireEvent.change(email, { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: ' exact ' } });
    await act(async () => {
      fireEvent.submit(email.closest('form')!);
      await Promise.resolve();
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('내 앞 대기 인원')).toBeInTheDocument();
    expect(screen.getByText('약 7명')).toBeInTheDocument();
    expect(submitQueuedLogin).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledOnce());
    expect(submitQueuedLogin).toHaveBeenCalledWith(
      { email: 'user@example.com', password: ' exact ' },
      'live-generation',
    );
  });

  it('keeps QUEUE_FULL on the login page with an accessible cancel action', async () => {
    vi.mocked(startOrResumeLoginQueue).mockRejectedValueOnce(
      new QueueRequestError(503, 'QUEUE_FULL', 4),
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByRole('heading', { name: '접속 대기 중이에요' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('대기열이 가득 찼어요');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(submitQueuedLogin).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '대기 취소' })).toBeEnabled();
  });

  it('rechecks current state after QUEUE_LOGIN_IN_PROGRESS and never posts credentials again while VERIFYING', async () => {
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(
      new QueueRequestError(409, 'QUEUE_LOGIN_IN_PROGRESS'),
    );
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce({
        status: 'VERIFYING',
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByText(/로그인 처리가 진행 중이에요/)).toBeInTheDocument();
    expect(submitQueuedLogin).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps Escape cancellation pending until confirmed, then focuses email', async () => {
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce({
      status: 'WAITING',
      loginOutcome: null,
      usersAhead: null,
      nextPollSeconds: 10,
    });
    let confirmCancel!: () => void;
    vi.mocked(cancelLoginQueue).mockImplementationOnce(
      () => new Promise<void>((resolve) => (confirmCancel = resolve)),
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(await screen.findByRole('button', { name: '취소 중…' })).toBeDisabled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await act(async () => confirmCancel());
    await vi.waitFor(() => expect(screen.getByLabelText('이메일')).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clears sibling canceling state after an unconfirmed result and allows retry', async () => {
    vi.mocked(getLoginQueueStatus).mockResolvedValueOnce({
      status: 'WAITING',
      loginOutcome: null,
      usersAhead: 3,
      nextPollSeconds: 10,
    });
    render(<LoginPage />);
    const dialog = await screen.findByRole('dialog');

    await act(async () => {
      queueSignals.listener?.({
        type: 'queue-cancel-requested',
        queueGeneration: 'live-generation',
      });
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '취소 중…' })).toBeDisabled();
    expect(dialog).toHaveTextContent('다른 탭에서 취소를 요청했어요');

    // Cancellation failure keeps the queue visible while re-enabling the retry action.
    await act(async () => {
      queueSignals.listener?.({
        type: 'queue-cancel-unconfirmed',
        queueGeneration: 'live-generation',
      });
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '대기 취소' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('취소 결과를 확인하지 못했어요');

    vi.mocked(cancelLoginQueue).mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '대기 취소' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(cancelLoginQueue).toHaveBeenCalledTimes(1);
  });

  it('keeps inline capacity cancellation pending, then focuses email after confirmation', async () => {
    vi.mocked(startOrResumeLoginQueue).mockRejectedValueOnce(
      new QueueRequestError(503, 'QUEUE_FULL', 120),
    );
    let confirmCancel!: () => void;
    vi.mocked(cancelLoginQueue).mockImplementationOnce(
      () => new Promise<void>((resolve) => (confirmCancel = resolve)),
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await screen.findByRole('heading', { name: '접속 대기 중이에요' });

    await user.click(screen.getByRole('button', { name: '대기 취소' }));
    expect(await screen.findByRole('button', { name: '취소 중…' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: '접속 대기 중이에요' })).toBeInTheDocument();

    await act(async () => confirmCancel());
    await vi.waitFor(() => expect(screen.getByLabelText('이메일')).toHaveFocus());
    expect(screen.queryByRole('heading', { name: '접속 대기 중이에요' })).not.toBeInTheDocument();
  });

  it('resumes a shared READY ticket without another tab credentials and asks for local re-entry', async () => {
    vi.mocked(getLoginQueueStatus)
      .mockReset()
      .mockResolvedValueOnce({ ...readyTicket });
    render(<LoginPage />);

    expect(
      await screen.findByText(
        '차례가 되었어요. 이메일과 비밀번호를 입력해 로그인을 이어가 주세요.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toHaveValue('');
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it('ignores an old queue signal and keeps keyboard focus inside the waiting dialog', async () => {
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce({
      status: 'WAITING',
      loginOutcome: null,
      usersAhead: 2,
      nextPollSeconds: 10,
    });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    const dialog = await screen.findByRole('dialog');
    const cancelButton = screen.getByRole('button', { name: '대기 취소' });
    expect(cancelButton).toHaveFocus();
    expect(screen.getByLabelText('이메일').closest('.login-layout')).toHaveAttribute('inert');
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(cancelButton).toHaveFocus();

    expect(queueSignals.listener).not.toBeNull();
    await act(async () => {
      queueSignals.listener?.({ type: 'queue-login-complete', queueGeneration: 'old-generation' });
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await act(async () => {
      queueSignals.listener?.({ type: 'queue-login-complete', queueGeneration: 'live-generation' });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not submit credentials from a poll response after another tab replaces the queue', async () => {
    vi.useFakeTimers();
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce({
      status: 'WAITING',
      loginOutcome: null,
      usersAhead: 3,
      nextPollSeconds: 10,
    });
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockImplementationOnce(async () => {
        vi.mocked(getLoginQueueGeneration).mockReturnValue('successor-generation');
        return { ...readyTicket };
      });
    vi.mocked(getLoginQueueGeneration).mockReturnValue('live-generation');
    render(<LoginPage />);
    const email = screen.getByLabelText('이메일');
    fireEvent.change(email, { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
    await act(async () => {
      fireEvent.submit(email.closest('form')!);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(submitQueuedLogin).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toHaveValue('');
  });
});
