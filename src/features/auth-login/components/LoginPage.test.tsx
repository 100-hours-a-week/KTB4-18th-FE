import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueueRequestError, type LoginQueueTicket } from '../api/loginQueueApi';
import type { LoginSuccessResponse } from '../api/loginApi';
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
  retireAmbiguousLoginOperation: vi.fn(),
  publishQueueSignal: vi.fn(),
  cancelLoginQueue: vi.fn(),
  recoverQueuedLogin: vi.fn(),
}));

vi.mock('../../user-signup/api/userAvailabilityApi', () => ({
  checkUserAvailability: vi.fn(),
}));

import {
  clearLoginOperationId,
  retireAmbiguousLoginOperation,
  getLoginQueueGeneration,
  getLoginQueueStatus,
  reconcileLoginQueueStatus,
  recoverQueuedLogin,
  startOrResumeLoginQueue,
  submitQueuedLogin,
  cancelLoginQueue,
} from '../api/loginQueueApi';
import { checkUserAvailability } from '../../user-signup/api/userAvailabilityApi';

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

function queueStartResult(ticket: LoginQueueTicket, queueGeneration = 'live-generation') {
  return { ticket, queueGeneration };
}

beforeEach(() => {
  vi.mocked(startOrResumeLoginQueue)
    .mockReset()
    .mockResolvedValue(queueStartResult({ ...readyTicket }));
  vi.mocked(submitQueuedLogin).mockReset().mockResolvedValue(successResponse);
  vi.mocked(getLoginQueueStatus).mockReset().mockRejectedValue(new QueueRequestError(404));
  vi.mocked(clearLoginOperationId).mockReset();
  vi.mocked(retireAmbiguousLoginOperation).mockReset();
  vi.mocked(recoverQueuedLogin).mockReset();
  vi.mocked(cancelLoginQueue).mockReset().mockResolvedValue(undefined);
  vi.mocked(getLoginQueueGeneration).mockReturnValue('live-generation');
  vi.mocked(checkUserAvailability).mockReset().mockResolvedValue(false);
  queueSignals.listener = null;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('LoginPage email input', () => {
  it('reports a queue generation change when the initial queue request rejects', async () => {
    let rejectStart!: (error: unknown) => void;
    vi.mocked(startOrResumeLoginQueue).mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectStart = reject)),
    );
    render(<LoginPage skipInitialQueueRestore />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    await act(async () => Promise.resolve());

    vi.mocked(getLoginQueueGeneration).mockReturnValue('successor-generation');
    await act(async () => {
      rejectStart(new QueueRequestError(503, 'QUEUE_FULL', 5));
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      '로그인 대기 상태가 변경되었어요. 다시 시도해 주세요.',
    );
    expect(screen.queryByRole('heading', { name: '접속 대기 중이에요' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: /접속 대기 중이에요|대기 요청을 확인해 주세요/ }),
    ).not.toBeInTheDocument();
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it('reports a queue generation change when a capacity retry request rejects', async () => {
    vi.useFakeTimers();
    let rejectRetry!: (error: unknown) => void;
    vi.mocked(startOrResumeLoginQueue)
      .mockRejectedValueOnce(new QueueRequestError(503, 'QUEUE_FULL', 1))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectRetry = reject)));
    render(<LoginPage skipInitialQueueRestore />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    await act(async () => Promise.resolve());
    expect(screen.getByRole('heading', { name: '접속 대기 중이에요' })).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await act(async () => Promise.resolve());
    vi.mocked(getLoginQueueGeneration).mockReturnValue('successor-generation');
    await act(async () => {
      rejectRetry(new QueueRequestError(503, 'QUEUE_FULL', 1));
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      '로그인 대기 상태가 변경되었어요. 다시 시도해 주세요.',
    );
    expect(screen.getByRole('heading', { name: '접속 대기 중이에요' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('대기열이 가득 찼어요');
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it('keeps a newer login pending when an invalidated capacity retry later succeeds', async () => {
    let resolveRetry!: (result: ReturnType<typeof queueStartResult>) => void;
    let resolveCurrentLogin!: (response: LoginSuccessResponse) => void;
    vi.mocked(startOrResumeLoginQueue)
      .mockRejectedValueOnce(new QueueRequestError(503, 'QUEUE_FULL', 1))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveRetry = resolve)) as never)
      .mockResolvedValueOnce(queueStartResult({ ...readyTicket }));
    vi.mocked(submitQueuedLogin).mockImplementationOnce(
      () => new Promise((resolve) => (resolveCurrentLogin = resolve)),
    );
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'old-password');
    const loginButton = screen.getByRole('button', { name: '로그인' });
    await user.click(loginButton);
    await vi.waitFor(() => expect(startOrResumeLoginQueue).toHaveBeenCalledOnce());

    await vi.waitFor(() => expect(startOrResumeLoginQueue).toHaveBeenCalledTimes(2), {
      timeout: 3_000,
    });
    await act(async () => {
      queueSignals.listener?.({ type: 'queue-logout-reset', queueGeneration: 'live-generation' });
    });

    await user.type(screen.getByLabelText('비밀번호'), 'new-password');
    await user.click(loginButton);
    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledOnce());
    expect(loginButton).toBeDisabled();

    await act(async () => {
      resolveRetry(queueStartResult({ ...readyTicket }));
      await Promise.resolve();
    });
    expect(loginButton).toBeDisabled();
    expect(submitQueuedLogin).toHaveBeenCalledOnce();

    await act(async () => resolveCurrentLogin(successResponse));
    expect(await screen.findByText('로그인에 성공했어요.')).toBeInTheDocument();
  });

  it('ignores an invalidated capacity retry rejection without clearing a newer submit', async () => {
    let rejectRetry!: (error: unknown) => void;
    let resolveCurrentLogin!: (response: LoginSuccessResponse) => void;
    vi.mocked(startOrResumeLoginQueue)
      .mockRejectedValueOnce(new QueueRequestError(503, 'QUEUE_FULL', 1))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectRetry = reject)))
      .mockResolvedValueOnce(queueStartResult({ ...readyTicket }));
    vi.mocked(submitQueuedLogin).mockImplementationOnce(
      () => new Promise((resolve) => (resolveCurrentLogin = resolve)),
    );
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'old-password');
    const loginButton = screen.getByRole('button', { name: '로그인' });
    await user.click(loginButton);
    await vi.waitFor(() => expect(startOrResumeLoginQueue).toHaveBeenCalledTimes(2), {
      timeout: 3_000,
    });
    await act(async () => {
      queueSignals.listener?.({ type: 'queue-logout-reset', queueGeneration: 'live-generation' });
    });

    await user.type(screen.getByLabelText('비밀번호'), 'new-password');
    await user.click(loginButton);
    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledOnce());
    expect(loginButton).toBeDisabled();

    await act(async () => {
      rejectRetry(new QueueRequestError(503, 'QUEUE_FULL', 5));
      await Promise.resolve();
    });
    expect(loginButton).toBeDisabled();
    expect(
      screen.queryByRole('region', { name: /접속 대기 중이에요|대기 요청을 확인해 주세요/ }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('.login-request-toast')).toBeNull();

    await act(async () => resolveCurrentLogin(successResponse));
    expect(await screen.findByText('로그인에 성공했어요.')).toBeInTheDocument();
  });

  it('reports a queue generation change when an ambiguous fallback start request rejects', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let rejectFreshStart!: (error: unknown) => void;
    vi.mocked(startOrResumeLoginQueue)
      .mockResolvedValueOnce(queueStartResult({ ...readyTicket }))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectFreshStart = reject)));
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(new QueueRequestError(null));
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce({
        status: 'CONSUMED',
        loginOutcome: 'INVALID_CREDENTIALS',
        usersAhead: 0,
        nextPollSeconds: 10,
      });
    render(<LoginPage skipInitialQueueRestore />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(screen.getByText(/로그인 결과를 확인하지 못했어요/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'new-password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(startOrResumeLoginQueue).toHaveBeenCalledTimes(2);
    vi.mocked(getLoginQueueGeneration).mockReturnValue('successor-generation');
    await act(async () => {
      rejectFreshStart(new QueueRequestError(503, 'QUEUE_FULL', 5));
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      '로그인 대기 상태가 변경되었어요. 다시 시도해 주세요.',
    );
    expect(
      screen.queryByRole('region', { name: /접속 대기 중이에요|대기 요청을 확인해 주세요/ }),
    ).not.toBeInTheDocument();
    expect(submitQueuedLogin).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a deferred waiting-ticket probe after a sibling cancel signal (%s)',
    async (completion) => {
      vi.useFakeTimers();
      let resolveProbe!: (ticket: LoginQueueTicket) => void;
      let rejectProbe!: (error: unknown) => void;
      vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce(
        queueStartResult({
          status: 'WAITING',
          loginOutcome: null,
          usersAhead: 1,
          nextPollSeconds: 10,
        }),
      );
      vi.mocked(getLoginQueueStatus).mockReturnValueOnce(
        new Promise((resolve, reject) => {
          resolveProbe = resolve;
          rejectProbe = reject;
        }),
      );
      render(<LoginPage skipInitialQueueRestore />);
      fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
      fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
      fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);

      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(getLoginQueueStatus).toHaveBeenCalledOnce();
      await act(async () => {
        queueSignals.listener?.({
          type: 'queue-cancel-requested',
          queueGeneration: 'live-generation',
        });
      });

      if (completion === 'resolve') {
        await act(async () => {
          resolveProbe({ ...readyTicket });
          await Promise.resolve();
        });
      } else {
        await act(async () => {
          rejectProbe(new QueueRequestError(503));
          await Promise.resolve();
        });
      }

      expect(screen.getByLabelText('비밀번호')).toHaveValue('');
      expect(document.querySelector('.login-request-toast')).toBeNull();
      expect(submitQueuedLogin).not.toHaveBeenCalled();
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'ignores a queue-create completion after a sibling cancel signal (%s)',
    async (completion) => {
      let resolveCreate!: (result: ReturnType<typeof queueStartResult>) => void;
      let rejectCreate!: (error: unknown) => void;
      vi.mocked(startOrResumeLoginQueue).mockReturnValueOnce(
        new Promise((resolve, reject) => {
          resolveCreate = resolve;
          rejectCreate = reject;
        }),
      );
      render(<LoginPage skipInitialQueueRestore />);
      fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
      fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
      fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
      await act(async () => Promise.resolve());

      await act(async () => {
        queueSignals.listener?.({
          type: 'queue-cancel-requested',
          queueGeneration: 'live-generation',
        });
      });
      if (completion === 'resolve') {
        await act(async () => {
          resolveCreate(queueStartResult({ ...readyTicket }));
          await Promise.resolve();
        });
      } else {
        await act(async () => {
          rejectCreate(new QueueRequestError(503, 'QUEUE_FULL', 5));
          await Promise.resolve();
        });
      }

      expect(screen.getByLabelText('비밀번호')).toHaveValue('');
      expect(document.querySelector('.login-request-toast')).toBeNull();
      expect(
        screen.queryByRole('region', { name: /접속 대기 중이에요|대기 요청을 확인해 주세요/ }),
      ).not.toBeInTheDocument();
      expect(submitQueuedLogin).not.toHaveBeenCalled();
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'ignores a pending login completion after a sibling cancel signal (%s)',
    async (completion) => {
      let resolveLogin!: (response: LoginSuccessResponse) => void;
      let rejectLogin!: (error: unknown) => void;
      vi.mocked(submitQueuedLogin).mockReturnValueOnce(
        new Promise((resolve, reject) => {
          resolveLogin = resolve;
          rejectLogin = reject;
        }),
      );
      const user = userEvent.setup();
      render(<LoginPage skipInitialQueueRestore />);
      await user.type(screen.getByLabelText('이메일'), 'user@example.com');
      await user.type(screen.getByLabelText('비밀번호'), 'password');
      await user.click(screen.getByRole('button', { name: '로그인' }));
      await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledOnce());

      await act(async () => {
        queueSignals.listener?.({
          type: 'queue-cancel-requested',
          queueGeneration: 'live-generation',
        });
      });
      if (completion === 'resolve') {
        await act(async () => resolveLogin(successResponse));
      } else {
        await act(async () => rejectLogin(new QueueRequestError(401, 'INVALID_CREDENTIALS')));
      }

      expect(screen.getByLabelText('비밀번호')).toHaveValue('');
      expect(screen.queryByText('로그인에 성공했어요.')).not.toBeInTheDocument();
      expect(document.querySelector('.login-request-toast')).toBeNull();
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'rejects an ambiguous fallback waiting probe after generation replacement (%s)',
    async (completion) => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0);
      let generation = 'live-generation';
      let resolveProbe!: (ticket: LoginQueueTicket) => void;
      let rejectProbe!: (error: unknown) => void;
      vi.mocked(getLoginQueueGeneration).mockImplementation(() => generation);
      vi.mocked(startOrResumeLoginQueue)
        .mockResolvedValueOnce(queueStartResult({ ...readyTicket }))
        .mockImplementationOnce(async () => {
          generation = 'ticket-generation';
          return queueStartResult(
            {
              status: 'WAITING',
              loginOutcome: null,
              usersAhead: 1,
              nextPollSeconds: 10,
            },
            generation,
          );
        });
      vi.mocked(submitQueuedLogin).mockRejectedValueOnce(new QueueRequestError(null));
      vi.mocked(getLoginQueueStatus)
        .mockRejectedValueOnce(new QueueRequestError(404))
        .mockRejectedValueOnce(new QueueRequestError(404))
        .mockReturnValueOnce(
          new Promise((resolve, reject) => {
            resolveProbe = resolve;
            rejectProbe = reject;
          }),
        );
      render(<LoginPage skipInitialQueueRestore />);
      fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
      fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'first-password' } });
      fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(screen.getByRole('status')).toHaveTextContent('로그인 결과를 확인하지 못했어요');

      fireEvent.change(screen.getByLabelText('비밀번호'), {
        target: { value: 'fallback-password' },
      });
      fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(getLoginQueueStatus).toHaveBeenCalledTimes(3);
      expect(startOrResumeLoginQueue).toHaveBeenCalledTimes(2);

      generation = 'successor-generation';
      if (completion === 'resolve') {
        await act(async () => {
          resolveProbe({ ...readyTicket });
          await Promise.resolve();
        });
      } else {
        await act(async () => {
          rejectProbe(new QueueRequestError(503));
          await Promise.resolve();
        });
      }

      expect(screen.getByRole('alert')).toHaveTextContent(
        '로그인 대기 상태가 변경되었어요. 다시 시도해 주세요.',
      );
      expect(
        screen.queryByRole('region', { name: /접속 대기 중이에요|대기 요청을 확인해 주세요/ }),
      ).not.toBeInTheDocument();
      expect(submitQueuedLogin).toHaveBeenCalledOnce();
    },
  );

  it('keeps a newer login pending when an invalidated ambiguous fallback later succeeds', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let resolveFallback!: (result: ReturnType<typeof queueStartResult>) => void;
    let resolveCurrentLogin!: (response: LoginSuccessResponse) => void;
    vi.mocked(startOrResumeLoginQueue)
      .mockResolvedValueOnce(queueStartResult({ ...readyTicket }))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFallback = resolve)) as never)
      .mockResolvedValueOnce(queueStartResult({ ...readyTicket }));
    vi.mocked(submitQueuedLogin)
      .mockRejectedValueOnce(new QueueRequestError(null))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveCurrentLogin = resolve)));
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockRejectedValueOnce(new QueueRequestError(404));
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'first-password');
    const loginButton = screen.getByRole('button', { name: '로그인' });
    await user.click(loginButton);
    await vi.waitFor(() =>
      expect(screen.getByText(/로그인 결과를 확인하지 못했어요/)).toBeInTheDocument(),
    );

    await user.type(screen.getByLabelText('비밀번호'), 'fallback-password');
    await user.click(loginButton);
    await vi.waitFor(() => expect(startOrResumeLoginQueue).toHaveBeenCalledTimes(2));
    await act(async () => {
      queueSignals.listener?.({ type: 'queue-logout-reset', queueGeneration: 'live-generation' });
    });

    await user.type(screen.getByLabelText('비밀번호'), 'new-password');
    await user.click(loginButton);
    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledTimes(2));
    expect(loginButton).toBeDisabled();

    await act(async () => {
      resolveFallback(queueStartResult({ ...readyTicket }));
      await Promise.resolve();
    });
    expect(loginButton).toBeDisabled();
    expect(submitQueuedLogin).toHaveBeenCalledTimes(2);

    await act(async () => resolveCurrentLogin(successResponse));
    expect(await screen.findByText('로그인에 성공했어요.')).toBeInTheDocument();
  });

  it('ignores an invalidated ambiguous fallback rejection without clearing a newer submit', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let rejectFallback!: (error: unknown) => void;
    let resolveCurrentLogin!: (response: LoginSuccessResponse) => void;
    vi.mocked(startOrResumeLoginQueue)
      .mockResolvedValueOnce(queueStartResult({ ...readyTicket }))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectFallback = reject)))
      .mockResolvedValueOnce(queueStartResult({ ...readyTicket }));
    vi.mocked(submitQueuedLogin)
      .mockRejectedValueOnce(new QueueRequestError(null))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveCurrentLogin = resolve)));
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockRejectedValueOnce(new QueueRequestError(404));
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'first-password');
    const loginButton = screen.getByRole('button', { name: '로그인' });
    await user.click(loginButton);
    await vi.waitFor(() =>
      expect(screen.getByText(/로그인 결과를 확인하지 못했어요/)).toBeInTheDocument(),
    );

    await user.type(screen.getByLabelText('비밀번호'), 'fallback-password');
    await user.click(loginButton);
    await vi.waitFor(() => expect(startOrResumeLoginQueue).toHaveBeenCalledTimes(2));
    await act(async () => {
      queueSignals.listener?.({ type: 'queue-logout-reset', queueGeneration: 'live-generation' });
    });

    await user.type(screen.getByLabelText('비밀번호'), 'new-password');
    await user.click(loginButton);
    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledTimes(2));
    expect(loginButton).toBeDisabled();

    await act(async () => {
      rejectFallback(new QueueRequestError(503, 'QUEUE_FULL', 5));
      await Promise.resolve();
    });
    expect(loginButton).toBeDisabled();
    expect(
      screen.queryByRole('region', { name: /접속 대기 중이에요|대기 요청을 확인해 주세요/ }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('.login-request-toast')).toBeNull();

    await act(async () => resolveCurrentLogin(successResponse));
    expect(await screen.findByText('로그인에 성공했어요.')).toBeInTheDocument();
  });

  it('reports a generation change when the waiting-ticket probe rejects', async () => {
    vi.useFakeTimers();
    let rejectProbe!: (error: unknown) => void;
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce(
      queueStartResult(
        { status: 'WAITING', loginOutcome: null, usersAhead: 1, nextPollSeconds: 10 },
        'ticket-generation',
      ),
    );
    vi.mocked(getLoginQueueStatus).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectProbe = reject;
      }),
    );
    vi.mocked(getLoginQueueGeneration).mockReturnValue('ticket-generation');
    render(<LoginPage skipInitialQueueRestore />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);

    await act(async () => vi.advanceTimersByTimeAsync(250));
    vi.mocked(getLoginQueueGeneration).mockReturnValue('successor-generation');
    await act(async () => {
      rejectProbe(new QueueRequestError(503));
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      '대기 상태가 변경되었어요. 다시 시도해 주세요.',
    );
    expect(submitQueuedLogin).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('heading', { name: '로그인 요청을 확인해 주세요' }),
    ).not.toBeInTheDocument();
  });

  it('does not attach a legacy ticket-only result to a generation created in another tab', async () => {
    vi.mocked(getLoginQueueGeneration).mockReturnValue('starting-generation');
    vi.mocked(startOrResumeLoginQueue).mockImplementationOnce(async () => {
      vi.mocked(getLoginQueueGeneration).mockReturnValue('successor-generation');
      return {
        status: 'READY',
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      } as never;
    });
    render(<LoginPage skipInitialQueueRestore />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      '대기 상태가 변경되었어요. 다시 시도해 주세요.',
    );
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it.each([
    [
      'READY',
      {
        status: 'READY',
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      } satisfies LoginQueueTicket,
      '차례가 되었어요. 이메일과 비밀번호를 입력해 로그인을 이어가 주세요.',
    ],
    [
      'RETRYABLE',
      {
        status: 'RETRYABLE',
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      } satisfies LoginQueueTicket,
      '로그인 확인 시간이 만료되었어요. 비밀번호를 다시 입력해 로그인을 이어가 주세요.',
    ],
  ] as const)('keeps initial %s restore guidance inline', async (_status, ticket, message) => {
    vi.mocked(getLoginQueueStatus).mockResolvedValueOnce(ticket);
    render(<LoginPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(document.querySelector('.login-request-toast')).toBeNull();
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it('keeps an expired initial restore inline and clears the password', async () => {
    vi.mocked(getLoginQueueStatus).mockRejectedValueOnce(new QueueRequestError(410));
    render(<LoginPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '대기 시간이 만료되었어요. 다시 로그인해 주세요.',
    );
    expect(document.querySelector('.login-request-toast')).toBeNull();
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it('shows a safe toast for a queue request error without duplicating inline text', async () => {
    vi.mocked(startOrResumeLoginQueue).mockRejectedValueOnce(
      new QueueRequestError(400, 'INVALID_REQUEST'),
    );
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    const toast = await screen.findByRole('alert');
    expect(toast).toHaveClass('login-request-toast');
    expect(document.querySelector('.login-notice[role="alert"]')).toBeNull();
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it('clears an open request toast when logout reset is received', async () => {
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(
      new QueueRequestError(401, 'INVALID_CREDENTIALS', null, 'live-generation'),
    );
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    expect(await screen.findByRole('alert')).toHaveClass('login-request-toast');

    await act(async () => {
      queueSignals.listener?.({ type: 'queue-logout-reset', queueGeneration: 'live-generation' });
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.querySelector('.login-request-toast')).toBeNull();
  });

  it('keeps unsupported-auth guidance inline and blocks login requests', async () => {
    render(
      <LoginPage
        authCapabilityMessage="이 환경에서는 로그인을 사용할 수 없어요."
        skipInitialQueueRestore
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이 환경에서는 로그인을 사용할 수 없어요.',
    );
    expect(document.querySelector('.login-request-toast')).toBeNull();
    expect(screen.getByRole('button', { name: '로그인' })).toBeDisabled();
    expect(startOrResumeLoginQueue).not.toHaveBeenCalled();
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it.each([
    [
      'QUEUE_WAITING',
      new QueueRequestError(429, 'QUEUE_WAITING'),
      'capacity',
      '대기 요청 결과를 확인하지 못했어요. 같은 요청으로 다시 확인할 수 있어요.',
    ],
    [
      'QUEUE_LOGIN_IN_PROGRESS',
      new QueueRequestError(409, 'QUEUE_LOGIN_IN_PROGRESS'),
      'inline',
      '로그인 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
    ],
  ] as const)(
    'keeps %s conflict guidance after a status-read failure',
    async (_code, error, view, message) => {
      vi.mocked(submitQueuedLogin).mockRejectedValueOnce(error);
      vi.mocked(getLoginQueueStatus).mockRejectedValueOnce(new QueueRequestError(503));
      const user = userEvent.setup();
      render(<LoginPage skipInitialQueueRestore />);
      await user.type(screen.getByLabelText('이메일'), 'user@example.com');
      await user.type(screen.getByLabelText('비밀번호'), 'password');
      await user.click(screen.getByRole('button', { name: '로그인' }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      if (view === 'inline') {
        expect(screen.getByRole('alert')).toHaveTextContent(message);
        expect(
          screen.queryByRole('heading', { name: '대기 요청을 확인해 주세요' }),
        ).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole('status')).toHaveTextContent(message);
        expect(
          screen.getByRole('heading', { name: '대기 요청을 확인해 주세요' }),
        ).toBeInTheDocument();
      }
      expect(document.querySelector('.login-request-toast')).toBeNull();
    },
  );

  it.each([
    [
      'QUEUE_WAITING',
      new QueueRequestError(429, 'QUEUE_WAITING'),
      '로그인 대기 상태가 아니에요. 다시 로그인해 주세요.',
    ],
    [
      'QUEUE_LOGIN_IN_PROGRESS',
      new QueueRequestError(409, 'QUEUE_LOGIN_IN_PROGRESS'),
      '로그인 상태를 다시 확인할 수 없어요. 다시 로그인해 주세요.',
    ],
  ] as const)('keeps a non-pending %s result inline', async (_code, error, message) => {
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(error);
    vi.mocked(getLoginQueueStatus).mockResolvedValueOnce({
      status: 'CONSUMED',
      loginOutcome: null,
      usersAhead: 0,
      nextPollSeconds: 10,
    });
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(document.querySelector('.login-request-toast')).toBeNull();
    expect(submitQueuedLogin).toHaveBeenCalledOnce();
  });

  it('keeps a generic consumed submit result inline', async () => {
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce(
      queueStartResult({
        status: 'CONSUMED',
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      }),
    );
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이전 로그인 시도가 종료되었어요. 비밀번호를 다시 입력해 주세요.',
    );
    expect(document.querySelector('.login-request-toast')).toBeNull();
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it.each([
    ['CANCELLED', '기존 대기가 취소되었어요. 새 비밀번호를 입력해 다시 로그인해 주세요.'],
    ['EXPIRED', '기존 대기 시간이 만료되었어요. 새 비밀번호를 입력해 다시 로그인해 주세요.'],
  ] as const)('keeps an ambiguous %s ticket result inline', async (status, message) => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(new QueueRequestError(null));
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce({
        status,
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      });
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'first-password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await screen.findByText(/로그인 결과를 확인하지 못했어요/);
    await user.type(screen.getByLabelText('비밀번호'), 'new-password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(document.querySelector('.login-request-toast')).toBeNull();
    expect(submitQueuedLogin).toHaveBeenCalledOnce();
  });

  it('keeps ambiguous recovery-expired guidance inline', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(new QueueRequestError(null));
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce({
        status: 'CONSUMED',
        loginOutcome: 'SUCCESS',
        usersAhead: 0,
        nextPollSeconds: 10,
      });
    vi.mocked(recoverQueuedLogin).mockRejectedValueOnce(
      new QueueRequestError(410, 'LOGIN_RECOVERY_UNAVAILABLE'),
    );
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'first-password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await screen.findByText(/로그인 결과를 확인하지 못했어요/);
    await user.type(screen.getByLabelText('비밀번호'), 'new-password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이전 로그인 확인이 만료되었어요. 새 비밀번호를 입력해 다시 로그인해 주세요.',
    );
    expect(document.querySelector('.login-request-toast')).toBeNull();
    expect(submitQueuedLogin).toHaveBeenCalledOnce();
  });

  it('keeps ambiguous status-recovery-unavailable guidance inline', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(new QueueRequestError(null));
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockRejectedValueOnce(new QueueRequestError(503, 'LOGIN_RECOVERY_UNAVAILABLE'));
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'first-password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await screen.findByText(/로그인 결과를 확인하지 못했어요/);
    await user.type(screen.getByLabelText('비밀번호'), 'new-password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이전 로그인 확인이 만료되었어요. 새 비밀번호를 입력해 다시 로그인해 주세요.',
    );
    expect(document.querySelector('.login-request-toast')).toBeNull();
    expect(submitQueuedLogin).toHaveBeenCalledOnce();
  });

  it('keeps queue transport uncertainty in the paused capacity UI', async () => {
    vi.mocked(startOrResumeLoginQueue).mockRejectedValueOnce(new QueueRequestError(null));
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(
      await screen.findByText(
        '대기 요청 결과를 확인하지 못했어요. 같은 요청으로 다시 확인할 수 있어요.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '대기 요청을 확인해 주세요' })).toBeInTheDocument();
    expect(document.querySelector('.login-request-toast')).toBeNull();
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it('keeps exhausted queue creation in the paused capacity UI', async () => {
    vi.mocked(startOrResumeLoginQueue).mockRejectedValueOnce(
      new QueueRequestError(503, 'CREATE_RETRIES_EXHAUSTED'),
    );
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(screen.getByRole('heading', { name: '대기 요청을 확인해 주세요' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '요청 결과를 확인할 수 없어 자동 재시도를 마쳤어요.',
    );
    expect(document.querySelector('.login-notice[role="alert"]')).toBeNull();
    expect(document.querySelector('.login-request-toast')).toBeNull();
  });

  it('reports a generation change when the capacity retry probe rejects', async () => {
    vi.useFakeTimers();
    let rejectProbe!: (error: unknown) => void;
    vi.mocked(startOrResumeLoginQueue)
      .mockRejectedValueOnce(new QueueRequestError(503, 'QUEUE_FULL', 1))
      .mockImplementationOnce(async () => {
        vi.mocked(getLoginQueueGeneration).mockReturnValue('ticket-generation');
        return queueStartResult(
          { status: 'WAITING', loginOutcome: null, usersAhead: 1, nextPollSeconds: 10 },
          'ticket-generation',
        );
      });
    vi.mocked(getLoginQueueStatus).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectProbe = reject;
      }),
    );
    render(<LoginPage skipInitialQueueRestore />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await act(async () => vi.advanceTimersByTimeAsync(250));

    vi.mocked(getLoginQueueGeneration).mockReturnValue('successor-generation');
    await act(async () => {
      rejectProbe(new QueueRequestError(503));
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      '대기 상태가 변경되었어요. 다시 시도해 주세요.',
    );
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it('reports a generation change when the capacity retry probe resolves stale', async () => {
    vi.useFakeTimers();
    let resolveProbe!: (ticket: LoginQueueTicket) => void;
    vi.mocked(startOrResumeLoginQueue)
      .mockRejectedValueOnce(new QueueRequestError(503, 'QUEUE_FULL', 1))
      .mockImplementationOnce(async () => {
        vi.mocked(getLoginQueueGeneration).mockReturnValue('ticket-generation');
        return queueStartResult(
          { status: 'WAITING', loginOutcome: null, usersAhead: 1, nextPollSeconds: 10 },
          'ticket-generation',
        );
      });
    vi.mocked(getLoginQueueStatus).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProbe = resolve;
      }),
    );
    render(<LoginPage skipInitialQueueRestore />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await act(async () => vi.advanceTimersByTimeAsync(250));

    vi.mocked(getLoginQueueGeneration).mockReturnValue('successor-generation');
    await act(async () => {
      resolveProbe({ ...readyTicket });
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      '로그인 대기 상태가 변경되었어요. 다시 시도해 주세요.',
    );
    expect(screen.getByRole('heading', { name: '접속 대기 중이에요' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('대기열이 가득 찼어요');
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it('keeps a consumed capacity-retry result inline', async () => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.mocked(startOrResumeLoginQueue)
      .mockRejectedValueOnce(new QueueRequestError(503, 'QUEUE_FULL', 1))
      .mockResolvedValueOnce(
        queueStartResult({
          status: 'CONSUMED',
          loginOutcome: null,
          usersAhead: 0,
          nextPollSeconds: 10,
        }),
      );
    render(<LoginPage skipInitialQueueRestore />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    await act(async () => Promise.resolve());
    expect(screen.getByRole('heading', { name: '접속 대기 중이에요' })).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(5_000));

    expect(screen.getByRole('alert')).toHaveTextContent(
      '이전 로그인 시도가 종료되었어요. 비밀번호를 다시 입력해 주세요.',
    );
    expect(screen.queryByRole('heading', { name: '접속 대기 중이에요' })).not.toBeInTheDocument();
    expect(document.querySelector('.login-request-toast')).toBeNull();
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it('keeps a consumed reconciliation result inline', async () => {
    vi.mocked(startOrResumeLoginQueue).mockRejectedValueOnce(
      new QueueRequestError(503, 'CREATE_RETRIES_EXHAUSTED'),
    );
    vi.mocked(reconcileLoginQueueStatus).mockResolvedValueOnce({
      ticket: {
        status: 'CONSUMED',
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      },
      queueGeneration: 'live-generation',
    });
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await user.click(await screen.findByRole('button', { name: '상태 확인' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '대기 요청이 이미 종료되었어요. 새 로그인을 시작할 수 있어요.',
    );
    expect(document.querySelector('.login-request-toast')).toBeNull();
    expect(submitQueuedLogin).not.toHaveBeenCalled();
  });

  it.each([
    [
      'READY',
      {
        status: 'READY',
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      } satisfies LoginQueueTicket,
      '차례가 되었어요. 비밀번호를 입력해 로그인을 이어가 주세요.',
    ],
    [
      'RETRYABLE',
      {
        status: 'RETRYABLE',
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      } satisfies LoginQueueTicket,
      '로그인을 이어가려면 비밀번호를 다시 입력해 주세요.',
    ],
  ] as const)(
    'keeps a reconciled %s ticket inline when no local password remains',
    async (_status, ticket, message) => {
      vi.mocked(startOrResumeLoginQueue).mockRejectedValueOnce(
        new QueueRequestError(503, 'CREATE_RETRIES_EXHAUSTED'),
      );
      vi.mocked(reconcileLoginQueueStatus).mockResolvedValueOnce({
        ticket,
        queueGeneration: 'live-generation',
      });
      const user = userEvent.setup();
      render(<LoginPage skipInitialQueueRestore />);
      await user.type(screen.getByLabelText('이메일'), 'user@example.com');
      await user.type(screen.getByLabelText('비밀번호'), 'password');
      await user.click(screen.getByRole('button', { name: '로그인' }));
      const passwordInput = screen.getByLabelText('비밀번호');
      expect(passwordInput).toBeDisabled();
      fireEvent.change(passwordInput, { target: { value: '' } });
      await user.click(await screen.findByRole('button', { name: '상태 확인' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(document.querySelector('.login-request-toast')).toBeNull();
      expect(submitQueuedLogin).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'READY',
      {
        status: 'READY',
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      } satisfies LoginQueueTicket,
      '차례가 되었어요. 이메일과 비밀번호를 입력해 로그인을 이어가 주세요.',
    ],
    [
      'RETRYABLE',
      {
        status: 'RETRYABLE',
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      } satisfies LoginQueueTicket,
      '비밀번호를 다시 입력하면 같은 대기 요청으로 이어집니다.',
    ],
  ] as const)(
    'keeps a poll result without local credentials (%s) inline',
    async (_status, ticket, message) => {
      vi.useFakeTimers();
      localStorage.clear();
      vi.mocked(getLoginQueueStatus)
        .mockResolvedValueOnce({
          status: 'WAITING',
          loginOutcome: null,
          usersAhead: 1,
          nextPollSeconds: 10,
          statusFetchedAt: Date.now() - 10_000,
        })
        .mockResolvedValueOnce(ticket);
      render(<LoginPage />);
      await act(async () => Promise.resolve());
      await act(async () => vi.advanceTimersByTimeAsync(500));

      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(document.querySelector('.login-request-toast')).toBeNull();
      expect(submitQueuedLogin).not.toHaveBeenCalled();
    },
  );

  it('submits retained credentials after the queue becomes RETRYABLE', async () => {
    vi.useFakeTimers();
    const retryableTicket: LoginQueueTicket = {
      status: 'RETRYABLE',
      loginOutcome: null,
      usersAhead: 0,
      nextPollSeconds: 10,
    };
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce(
      queueStartResult({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 1,
        nextPollSeconds: 10,
      }),
    );
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 1,
        nextPollSeconds: 10,
        statusFetchedAt: Date.now(),
      })
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
      await vi.advanceTimersByTimeAsync(250);
    });
    await vi.waitFor(() => expect(getLoginQueueStatus).toHaveBeenCalledTimes(2));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));

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
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce(
      queueStartResult({
        status,
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      }),
    );
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

  it.each([
    { usersAhead: null, shouldOpen: false },
    { usersAhead: 0, shouldOpen: false },
    { usersAhead: 150, shouldOpen: false },
    { usersAhead: 151, shouldOpen: true },
  ])(
    'shows the waiting dialog only when more than 150 people are ahead',
    async ({ usersAhead, shouldOpen }) => {
      let resolveStatus!: (ticket: LoginQueueTicket) => void;
      const statusPromise = new Promise<LoginQueueTicket>((resolve) => {
        resolveStatus = resolve;
      });
      vi.mocked(getLoginQueueStatus).mockReturnValueOnce(statusPromise);
      render(<LoginPage />);

      await vi.waitFor(() => expect(getLoginQueueStatus).toHaveBeenCalledOnce());
      await act(async () => {
        resolveStatus({
          status: 'WAITING',
          loginOutcome: null,
          usersAhead,
          nextPollSeconds: 10,
        });
        await statusPromise;
      });
      if (shouldOpen) {
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
      } else {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      }
    },
  );

  it('skips automatic prior-session restore after logout but reconciles the queue on submit', async () => {
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await act(async () => Promise.resolve());
    expect(getLoginQueueStatus).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByText('로그인에 성공했어요.')).toBeInTheDocument();
    expect(cancelLoginQueue).not.toHaveBeenCalled();
    expect(startOrResumeLoginQueue).toHaveBeenCalledOnce();
  });

  it('requires a newly entered password and an explicit resubmit after an ambiguous result', async () => {
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(new QueueRequestError(null));
    vi.mocked(getLoginQueueStatus)
      .mockReset()
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce({ ...readyTicket });
    const onLoginSuccess = vi.fn();
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore onLoginSuccess={onLoginSuccess} />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    expect(await screen.findByRole('status')).toHaveTextContent('로그인 결과를 확인하지 못했어요');
    expect(screen.getByLabelText('비밀번호')).toHaveValue('');
    expect(
      screen.queryByRole('button', { name: '이전 로그인 상태 계속하기' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '새로 로그인하기' })).not.toBeInTheDocument();
    expect(submitQueuedLogin).toHaveBeenCalledOnce();

    await user.type(screen.getByLabelText('비밀번호'), 'new-password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(getLoginQueueStatus).toHaveBeenCalledTimes(2);
    expect(submitQueuedLogin).toHaveBeenCalledTimes(2);
    expect(submitQueuedLogin).toHaveBeenLastCalledWith(
      { email: 'user@example.com', password: 'new-password' },
      'live-generation',
    );
    expect(onLoginSuccess).toHaveBeenCalledOnce();
    expect(onLoginSuccess.mock.calls[0][0]).toMatchObject({
      message: 'login success',
      data: { access_token: 'test-token', expires_in: 3600 },
    });
  });

  it('does not send credentials on ambiguous resubmit while the old ticket is waiting', async () => {
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(new QueueRequestError(null));
    vi.mocked(getLoginQueueStatus)
      .mockReset()
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 3,
        nextPollSeconds: 10,
      });
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await screen.findByText(/로그인 결과를 확인하지 못했어요/);
    await user.type(screen.getByLabelText('비밀번호'), 'new-password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(submitQueuedLogin).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('비밀번호')).toHaveValue('new-password');
    expect(
      screen.queryByRole('button', { name: '이전 로그인 상태 계속하기' }),
    ).not.toBeInTheDocument();
    expect(retireAmbiguousLoginOperation).not.toHaveBeenCalled();
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

  it('submits a fresh ticket with the generation returned by the queue API', async () => {
    vi.mocked(getLoginQueueGeneration).mockReturnValue('starting-generation');
    vi.mocked(startOrResumeLoginQueue).mockImplementationOnce(async () => {
      vi.mocked(getLoginQueueGeneration).mockReturnValue('ticket-generation');
      return queueStartResult({ ...readyTicket }, 'ticket-generation');
    });
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    await vi.waitFor(() =>
      expect(submitQueuedLogin).toHaveBeenCalledExactlyOnceWith(
        { email: 'user@example.com', password: 'password' },
        'ticket-generation',
      ),
    );
  });

  it('rejects a whitespace-only password before starting a login queue', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), '   ');

    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);

    expect(screen.getByRole('alert')).toHaveTextContent('비밀번호를 입력해 주세요.');
    expect(startOrResumeLoginQueue).not.toHaveBeenCalled();
    expect(submitQueuedLogin).not.toHaveBeenCalled();
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

  it('shows invalid credentials in a dismissible toast without an inline duplicate', async () => {
    vi.mocked(submitQueuedLogin).mockImplementationOnce(async () => {
      throw new QueueRequestError(401, 'INVALID_CREDENTIALS', null, 'live-generation');
    });
    vi.mocked(checkUserAvailability).mockRejectedValueOnce(new Error('too many requests'));
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'abc@Example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveClass('login-request-toast');
    expect(toast).toHaveTextContent('이메일 또는 비밀번호를 확인해 주세요.');
    expect(document.querySelector('.login-notice[role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '로그인' }));
    expect(screen.getByLabelText('이메일')).toHaveValue('abc@example.com');
    expect(screen.getByLabelText('비밀번호')).toHaveValue('');
    expect(screen.getByRole('button', { name: '로그인' })).toBeDisabled();
    expect(checkUserAvailability).toHaveBeenCalledExactlyOnceWith('email', 'abc@example.com');
    await user.click(screen.getByRole('button', { name: '알림 닫기' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps a toast visible and re-announces the same error while it is already visible', async () => {
    vi.mocked(submitQueuedLogin).mockRejectedValue(
      new QueueRequestError(401, 'INVALID_CREDENTIALS', null, 'live-generation'),
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'wrong-password');
    const loginButton = screen.getByRole('button', { name: '로그인' });
    await user.click(loginButton);
    const firstToast = await screen.findByRole('alert');
    expect(firstToast).toHaveClass('login-request-toast');

    vi.useFakeTimers();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.getByRole('alert')).toBe(firstToast);

    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'wrong-password' } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const secondToast = screen.getByRole('alert');
    expect(secondToast).toHaveClass('login-request-toast');
    expect(secondToast).not.toBe(firstToast);
    expect(secondToast).toHaveTextContent('이메일 또는 비밀번호를 확인해 주세요.');
  });

  it('re-announces a dismissed error and supports keyboard dismissal without moving focus', async () => {
    vi.mocked(submitQueuedLogin).mockRejectedValue(
      new QueueRequestError(401, 'INVALID_CREDENTIALS', null, 'live-generation'),
    );
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'wrong-password');
    const loginButton = screen.getByRole('button', { name: '로그인' });
    await user.click(loginButton);
    const firstToast = await screen.findByRole('alert');
    expect(document.activeElement).toBe(loginButton);

    await user.click(screen.getByRole('button', { name: '알림 닫기' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('비밀번호'), 'wrong-password');
    await user.click(loginButton);
    const secondToast = await screen.findByRole('alert');
    expect(secondToast).not.toBe(firstToast);

    const dismissButton = screen.getByRole('button', { name: '알림 닫기' });
    dismissButton.focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears a toast on a new submit and after successful login', async () => {
    let resolveLogin!: (response: LoginSuccessResponse) => void;
    vi.mocked(submitQueuedLogin)
      .mockRejectedValueOnce(
        new QueueRequestError(401, 'INVALID_CREDENTIALS', null, 'live-generation'),
      )
      .mockImplementationOnce(() => new Promise((resolve) => (resolveLogin = resolve)));
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'wrong-password');
    const loginButton = screen.getByRole('button', { name: '로그인' });
    await user.click(loginButton);
    expect(await screen.findByRole('alert')).toHaveClass('login-request-toast');

    await user.type(screen.getByLabelText('비밀번호'), 'correct-password');
    await user.click(loginButton);
    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledTimes(2));
    expect(document.querySelector('.login-request-toast')).toBeNull();

    await act(async () => resolveLogin(successResponse));
    expect(await screen.findByText('로그인에 성공했어요.')).toBeInTheDocument();
    expect(document.querySelector('.login-request-toast')).toBeNull();
  });

  it('ignores a stale email availability result after a 401 rotates the queue generation', async () => {
    let resolveAvailability!: (available: boolean) => void;
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(
      new QueueRequestError(401, 'INVALID_CREDENTIALS', null, 'live-generation'),
    );
    vi.mocked(checkUserAvailability).mockReturnValueOnce(
      new Promise((resolve) => (resolveAvailability = resolve)),
    );
    render(<LoginPage skipInitialQueueRestore />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'wrong-password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    await vi.waitFor(() => expect(checkUserAvailability).toHaveBeenCalledOnce());

    vi.mocked(getLoginQueueGeneration).mockReturnValue('successor-generation');
    await act(async () => {
      resolveAvailability(true);
      await Promise.resolve();
    });

    expect(screen.queryByRole('link', { name: '회원가입' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('checks a 401 generation before clearing credentials or calling failure callbacks', async () => {
    let rejectLogin!: (error: unknown) => void;
    const onLoginFailure = vi.fn();
    vi.mocked(submitQueuedLogin).mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectLogin = reject)),
    );
    render(<LoginPage skipInitialQueueRestore onLoginFailure={onLoginFailure} />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'wrong-password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledOnce());

    vi.mocked(getLoginQueueGeneration).mockReturnValue('successor-generation');
    await act(async () => {
      rejectLogin(new QueueRequestError(401, 'INVALID_CREDENTIALS', null, 'live-generation'));
      await Promise.resolve();
    });

    expect(screen.getByLabelText('비밀번호')).toHaveValue('wrong-password');
    expect(clearLoginOperationId).not.toHaveBeenCalled();
    expect(onLoginFailure).not.toHaveBeenCalled();
    expect(checkUserAvailability).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      '로그인 대기 상태가 변경되었어요. 다시 시도해 주세요.',
    );
  });

  it('shows an inline signup link when the rejected email is available for signup', async () => {
    vi.mocked(submitQueuedLogin).mockImplementationOnce(async () => {
      vi.mocked(getLoginQueueGeneration).mockReturnValue('consumed-generation');
      throw new QueueRequestError(401, 'INVALID_CREDENTIALS', null, 'consumed-generation');
    });
    const { checkUserAvailability: checkAvailability } = await vi.importActual<
      typeof import('../../user-signup/api/userAvailabilityApi')
    >('../../user-signup/api/userAvailabilityApi');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'availability checked', data: { available: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.mocked(checkUserAvailability).mockImplementation(checkAvailability);
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'abc@Example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(screen.getByRole('link', { name: '회원가입' })).toHaveAttribute('href', '/signup');
    expect(screen.getByRole('alert')).toHaveTextContent('가입된 계정이 없는 이메일이에요.');
    expect(document.querySelector('.login-request-toast')).toBeNull();
    expect(checkUserAvailability).toHaveBeenCalledExactlyOnceWith('email', 'abc@example.com');
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('/api/v1/users/availability/email?value=abc%40example.com'),
      { cache: 'no-store' },
    );
    expect(screen.getByLabelText('이메일')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('비밀번호')).toHaveValue('');

    await user.clear(screen.getByLabelText('이메일'));
    expect(screen.queryByRole('link', { name: '회원가입' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('이메일을 입력해 주세요.');
  });

  it('ignores a consumed credential lookup after another tab replaces its generation', async () => {
    let resolveAvailability!: (available: boolean) => void;
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce(
      queueStartResult({
        status: 'CONSUMED',
        loginOutcome: 'INVALID_CREDENTIALS',
        usersAhead: 0,
        nextPollSeconds: 10,
      }),
    );
    vi.mocked(checkUserAvailability).mockReturnValueOnce(
      new Promise((resolve) => (resolveAvailability = resolve)),
    );
    render(<LoginPage skipInitialQueueRestore />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    await vi.waitFor(() =>
      expect(checkUserAvailability).toHaveBeenCalledExactlyOnceWith('email', 'new@example.com'),
    );

    vi.mocked(getLoginQueueGeneration).mockReturnValue('successor-generation');
    await act(async () => {
      resolveAvailability(true);
      await Promise.resolve();
    });

    expect(screen.queryByRole('link', { name: '회원가입' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

  it('ignores an old login rejection after logout reset and keeps the newer submit pending', async () => {
    let rejectOldLogin!: (error: unknown) => void;
    let resolveCurrentLogin!: (response: LoginSuccessResponse) => void;
    vi.mocked(submitQueuedLogin)
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectOldLogin = reject)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveCurrentLogin = resolve)));
    const user = userEvent.setup();
    render(<LoginPage />);
    const email = screen.getByLabelText('이메일');
    await user.type(email, 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'old-password');
    const loginButton = screen.getByRole('button', { name: '로그인' });
    await user.click(loginButton);
    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledOnce());

    await act(async () => {
      queueSignals.listener?.({ type: 'queue-logout-reset', queueGeneration: 'live-generation' });
    });
    await user.type(screen.getByLabelText('비밀번호'), 'new-password');
    await user.click(loginButton);
    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledTimes(2));

    await act(async () =>
      rejectOldLogin(new QueueRequestError(401, 'INVALID_CREDENTIALS', null, 'live-generation')),
    );
    expect(loginButton).toBeDisabled();
    expect(document.querySelector('.login-request-toast')).toBeNull();
    expect(screen.queryByText('로그인이 성공했어요.')).not.toBeInTheDocument();

    await act(async () => resolveCurrentLogin(successResponse));
    expect(await screen.findByText('로그인에 성공했어요.')).toBeInTheDocument();
  });

  it('ignores an old login success after logout reset and keeps the newer submit pending', async () => {
    let resolveOldLogin!: (response: LoginSuccessResponse) => void;
    let resolveCurrentLogin!: (response: LoginSuccessResponse) => void;
    vi.mocked(submitQueuedLogin)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOldLogin = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveCurrentLogin = resolve)));
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'old-password');
    const loginButton = screen.getByRole('button', { name: '로그인' });
    await user.click(loginButton);
    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledOnce());

    await act(async () => {
      queueSignals.listener?.({ type: 'queue-logout-reset', queueGeneration: 'live-generation' });
    });
    await user.type(screen.getByLabelText('비밀번호'), 'new-password');
    await user.click(loginButton);
    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledTimes(2));

    await act(async () => resolveOldLogin(successResponse));
    expect(loginButton).toBeDisabled();
    expect(screen.queryByText('로그인에 성공했어요.')).not.toBeInTheDocument();

    await act(async () => resolveCurrentLogin(successResponse));
    expect(await screen.findByText('로그인에 성공했어요.')).toBeInTheDocument();
  });

  it('keeps the current submission alive when a background poll reports a terminal ticket', async () => {
    vi.useFakeTimers();
    let resolveQueueStart!: (result: ReturnType<typeof queueStartResult>) => void;
    vi.mocked(startOrResumeLoginQueue).mockImplementationOnce(
      () => new Promise((resolve) => (resolveQueueStart = resolve)),
    );
    vi.mocked(getLoginQueueStatus)
      .mockResolvedValueOnce({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 1,
        nextPollSeconds: 1,
        statusFetchedAt: Date.now(),
      })
      .mockResolvedValueOnce({
        status: 'CANCELLED',
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      });
    render(<LoginPage />);
    await act(async () => Promise.resolve());
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText('대기를 취소했어요. 다시 로그인해 주세요.')).toBeInTheDocument();
    await act(async () => {
      resolveQueueStart(queueStartResult({ ...readyTicket }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(submitQueuedLogin).toHaveBeenCalledOnce();
  });

  it('shows the current login failure when an earlier background status poll rejects', async () => {
    vi.useFakeTimers();
    let resolveQueueStart!: (result: ReturnType<typeof queueStartResult>) => void;
    let rejectPoll!: (error: unknown) => void;
    let rejectLogin!: (error: unknown) => void;
    vi.mocked(startOrResumeLoginQueue).mockImplementationOnce(
      () => new Promise((resolve) => (resolveQueueStart = resolve)),
    );
    vi.mocked(getLoginQueueStatus)
      .mockResolvedValueOnce({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 1,
        nextPollSeconds: 1,
        statusFetchedAt: Date.now(),
      })
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectPoll = reject;
        }),
      );
    vi.mocked(submitQueuedLogin).mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectLogin = reject)),
    );
    render(<LoginPage />);
    await act(async () => Promise.resolve());
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(getLoginQueueStatus).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveQueueStart(queueStartResult({ ...readyTicket }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(submitQueuedLogin).toHaveBeenCalledOnce();

    await act(async () => {
      rejectPoll(new QueueRequestError(401));
      await Promise.resolve();
      rejectLogin(new QueueRequestError(401, 'INVALID_CREDENTIALS', null, 'live-generation'));
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent('이메일 또는 비밀번호를 확인해 주세요.');
  });

  it('ignores background recovery after the user edits credentials while recovery is pending', async () => {
    vi.useFakeTimers();
    const onLoginSuccess = vi.fn();
    let resolveRecovery!: (response: LoginSuccessResponse) => void;
    vi.mocked(getLoginQueueStatus)
      .mockResolvedValueOnce({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 1,
        nextPollSeconds: 0,
        statusFetchedAt: Date.now(),
      })
      .mockResolvedValueOnce({
        status: 'CONSUMED',
        loginOutcome: 'SUCCESS',
        usersAhead: 0,
        nextPollSeconds: 10,
      });
    vi.mocked(recoverQueuedLogin).mockImplementationOnce(
      () => new Promise((resolve) => (resolveRecovery = resolve)),
    );
    render(<LoginPage onLoginSuccess={onLoginSuccess} />);
    await act(async () => Promise.resolve());

    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(recoverQueuedLogin).toHaveBeenCalledOnce();
    const isRecoveryCurrent = vi.mocked(recoverQueuedLogin).mock.calls[0][2];
    expect(isRecoveryCurrent?.()).toBe(true);

    fireEvent.change(screen.getByLabelText('이메일'), {
      target: { value: 'different@example.com' },
    });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'new-password' } });
    expect(isRecoveryCurrent?.()).toBe(false);

    await act(async () => {
      resolveRecovery(successResponse);
      await Promise.resolve();
    });

    expect(onLoginSuccess).not.toHaveBeenCalled();
    expect(screen.queryByText('로그인에 성공했어요.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('이메일')).toHaveValue('different@example.com');
    expect(screen.getByLabelText('비밀번호')).toHaveValue('new-password');
  });

  it('completes a current background recovery after the consumed ticket rerenders the queue', async () => {
    vi.useFakeTimers();
    const onLoginSuccess = vi.fn();
    let resolveRecovery!: (response: LoginSuccessResponse) => void;
    vi.mocked(getLoginQueueStatus)
      .mockResolvedValueOnce({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 1,
        nextPollSeconds: 0,
        statusFetchedAt: Date.now(),
      })
      .mockResolvedValueOnce({
        status: 'CONSUMED',
        loginOutcome: 'SUCCESS',
        usersAhead: 0,
        nextPollSeconds: 10,
      });
    vi.mocked(recoverQueuedLogin).mockImplementationOnce(
      () => new Promise((resolve) => (resolveRecovery = resolve)),
    );
    render(<LoginPage onLoginSuccess={onLoginSuccess} />);
    await act(async () => Promise.resolve());

    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(recoverQueuedLogin).toHaveBeenCalledOnce();
    const isRecoveryCurrent = vi.mocked(recoverQueuedLogin).mock.calls[0][2];
    expect(isRecoveryCurrent?.()).toBe(true);

    await act(async () => {
      resolveRecovery(successResponse);
      await Promise.resolve();
    });

    expect(onLoginSuccess).toHaveBeenCalledExactlyOnceWith(successResponse);
    expect(screen.getByText('로그인에 성공했어요.')).toBeInTheDocument();
  });

  it('does not persist or finish an initial queue restore after credentials change', async () => {
    const onLoginSuccess = vi.fn();
    let resolveRecovery!: (response: LoginSuccessResponse) => void;
    vi.mocked(getLoginQueueStatus).mockResolvedValueOnce({
      status: 'CONSUMED',
      loginOutcome: 'SUCCESS',
      usersAhead: 0,
      nextPollSeconds: 10,
    });
    vi.mocked(recoverQueuedLogin).mockImplementationOnce(
      () => new Promise((resolve) => (resolveRecovery = resolve)),
    );
    render(<LoginPage onLoginSuccess={onLoginSuccess} />);
    await vi.waitFor(() => expect(recoverQueuedLogin).toHaveBeenCalledOnce());
    const isRecoveryCurrent = vi.mocked(recoverQueuedLogin).mock.calls[0][2];

    fireEvent.change(screen.getByLabelText('이메일'), {
      target: { value: 'different@example.com' },
    });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'new-password' } });
    expect(isRecoveryCurrent?.()).toBe(false);

    await act(async () => {
      resolveRecovery(successResponse);
      await Promise.resolve();
    });

    expect(onLoginSuccess).not.toHaveBeenCalled();
    expect(screen.queryByText('로그인에 성공했어요.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('이메일')).toHaveValue('different@example.com');
    expect(screen.getByLabelText('비밀번호')).toHaveValue('new-password');
  });

  it('ignores a stale reconciliation rejection after the queue generation changes', async () => {
    let rejectReconciliation!: (error: unknown) => void;
    vi.mocked(startOrResumeLoginQueue).mockRejectedValueOnce(
      new QueueRequestError(503, 'CREATE_RETRIES_EXHAUSTED'),
    );
    vi.mocked(reconcileLoginQueueStatus).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectReconciliation = reject;
      }),
    );
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await user.click(await screen.findByRole('button', { name: '상태 확인' }));
    await vi.waitFor(() => expect(reconcileLoginQueueStatus).toHaveBeenCalledOnce());

    vi.mocked(getLoginQueueGeneration).mockReturnValue('successor-generation');
    await act(async () => {
      rejectReconciliation(new QueueRequestError(410, 'TICKET_EXPIRED'));
      await Promise.resolve();
    });

    expect(screen.getByLabelText('비밀번호')).toHaveValue('password');
    expect(
      screen.queryByText('대기 시간이 만료되었어요. 다시 로그인해 주세요.'),
    ).not.toBeInTheDocument();
  });

  it('keeps a current reconciliation when a background poll starts during it', async () => {
    vi.useFakeTimers();
    const waitingTicket: LoginQueueTicket = {
      status: 'WAITING',
      loginOutcome: null,
      usersAhead: 1,
      nextPollSeconds: 10,
      statusFetchedAt: Date.now() - 10_000,
    };
    let resolveReconciliation!: (result: {
      ticket: LoginQueueTicket;
      queueGeneration: string;
    }) => void;
    let finishLogin!: (response: LoginSuccessResponse) => void;
    vi.mocked(getLoginQueueStatus).mockResolvedValue(waitingTicket);
    vi.mocked(startOrResumeLoginQueue).mockRejectedValueOnce(
      new QueueRequestError(503, 'CREATE_RETRIES_EXHAUSTED'),
    );
    vi.mocked(reconcileLoginQueueStatus).mockReturnValueOnce(
      new Promise((resolve) => (resolveReconciliation = resolve)),
    );
    vi.mocked(submitQueuedLogin).mockImplementationOnce(
      () => new Promise((resolve) => (finishLogin = resolve)),
    );
    render(<LoginPage />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: '상태 확인' }));
    await act(async () => Promise.resolve());
    expect(reconcileLoginQueueStatus).toHaveBeenCalledOnce();

    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(getLoginQueueStatus).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveReconciliation({
        ticket: { ...readyTicket },
        queueGeneration: 'live-generation',
      });
      await Promise.resolve();
    });
    expect(submitQueuedLogin).toHaveBeenCalledOnce();
    expect(submitQueuedLogin).toHaveBeenCalledWith(
      { email: 'user@example.com', password: 'password' },
      'live-generation',
    );

    await act(async () => finishLogin(successResponse));
  });

  it('does not show the waiting dialog while an immediately READY login is being submitted', async () => {
    let finishLogin!: (response: LoginSuccessResponse) => void;
    vi.mocked(submitQueuedLogin).mockImplementationOnce(
      () => new Promise((resolve) => (finishLogin = resolve)),
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => finishLogin(successResponse));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('continues a RETRYABLE ticket without showing the waiting dialog', async () => {
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce(
      queueStartResult({
        status: 'RETRYABLE',
        loginOutcome: null,
        usersAhead: 0,
        nextPollSeconds: 10,
      }),
    );
    let finishLogin!: (response: LoginSuccessResponse) => void;
    vi.mocked(submitQueuedLogin).mockImplementationOnce(
      () => new Promise((resolve) => (finishLogin = resolve)),
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => finishLogin(successResponse));
  });

  it('checks queue admission quickly and submits login when READY', async () => {
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce(
      queueStartResult({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 7,
        nextPollSeconds: 10,
      }),
    );
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
      await Promise.resolve();
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(submitQueuedLogin).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(getLoginQueueStatus).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(submitQueuedLogin).toHaveBeenCalledWith(
      { email: 'user@example.com', password: ' exact ' },
      'live-generation',
    );
  });

  it('does not show the waiting dialog when status lookup fails after a login conflict', async () => {
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(
      new QueueRequestError(409, 'QUEUE_LOGIN_IN_PROGRESS'),
    );
    vi.mocked(getLoginQueueStatus).mockRejectedValue(new QueueRequestError(503));
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(
      await screen.findByText('로그인 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks for explicit login-state recovery when a login-in-progress conflict reports READY', async () => {
    vi.mocked(submitQueuedLogin).mockRejectedValueOnce(
      new QueueRequestError(409, 'QUEUE_LOGIN_IN_PROGRESS'),
    );
    vi.mocked(getLoginQueueStatus)
      .mockReset()
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce({ ...readyTicket });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      '다시 로그인하려면 비밀번호를 입력하고 로그인 버튼을 눌러 주세요.',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(submitQueuedLogin).toHaveBeenCalledOnce();
  });

  it('does not show the waiting dialog when a capacity retry resumes a READY ticket', async () => {
    vi.useFakeTimers();
    vi.mocked(startOrResumeLoginQueue).mockRejectedValueOnce(
      new QueueRequestError(503, 'QUEUE_FULL', 1),
    );
    let finishLogin!: (response: LoginSuccessResponse) => void;
    vi.mocked(submitQueuedLogin).mockImplementationOnce(
      () => new Promise((resolve) => (finishLogin = resolve)),
    );
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => finishLogin(successResponse));
  });

  it('does not show the waiting dialog when reconciliation finds a READY ticket', async () => {
    vi.mocked(startOrResumeLoginQueue).mockRejectedValueOnce(
      new QueueRequestError(503, 'CREATE_RETRIES_EXHAUSTED'),
    );
    vi.mocked(reconcileLoginQueueStatus)
      .mockReset()
      .mockResolvedValueOnce({ ticket: { ...readyTicket }, queueGeneration: 'live-generation' });
    let finishLogin!: (response: LoginSuccessResponse) => void;
    vi.mocked(submitQueuedLogin).mockImplementationOnce(
      () => new Promise((resolve) => (finishLogin = resolve)),
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await screen.findByRole('heading', { name: '대기 요청을 확인해 주세요' });

    await user.click(screen.getByRole('button', { name: '상태 확인' }));
    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => finishLogin(successResponse));
  });

  it('uses the generation returned by reconciliation when it retires its marker', async () => {
    let generation = 'live-generation';
    let resolveReconciliation!: (result: {
      ticket: LoginQueueTicket;
      queueGeneration: string;
    }) => void;
    vi.mocked(getLoginQueueGeneration).mockImplementation(() => generation);
    vi.mocked(startOrResumeLoginQueue).mockRejectedValueOnce(
      new QueueRequestError(503, 'CREATE_RETRIES_EXHAUSTED'),
    );
    vi.mocked(reconcileLoginQueueStatus).mockReturnValueOnce(
      new Promise((resolve) => (resolveReconciliation = resolve)),
    );
    const user = userEvent.setup();
    render(<LoginPage skipInitialQueueRestore />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await user.click(await screen.findByRole('button', { name: '상태 확인' }));
    await vi.waitFor(() => expect(reconcileLoginQueueStatus).toHaveBeenCalledOnce());

    generation = 'reconciled-generation';
    await act(async () => {
      resolveReconciliation({
        ticket: { ...readyTicket },
        queueGeneration: generation,
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledOnce());
    expect(submitQueuedLogin).toHaveBeenCalledWith(
      { email: 'user@example.com', password: 'password' },
      'reconciled-generation',
    );
  });

  it('restarts the GET-first login flow when manual reconciliation confirms no current ticket', async () => {
    vi.mocked(startOrResumeLoginQueue)
      .mockRejectedValueOnce(new QueueRequestError(503, 'CREATE_RETRIES_EXHAUSTED'))
      .mockResolvedValueOnce(queueStartResult({ ...readyTicket }));
    vi.mocked(reconcileLoginQueueStatus).mockRejectedValueOnce(
      new QueueRequestError(404, 'TICKET_UNKNOWN'),
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await user.click(await screen.findByRole('button', { name: '상태 확인' }));

    await vi.waitFor(() => expect(submitQueuedLogin).toHaveBeenCalledOnce());
    expect(startOrResumeLoginQueue).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

  it('keeps checking a VERIFYING ticket without opening the long-wait dialog', async () => {
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

    expect(submitQueuedLogin).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the signup hint when a polled login result rejects an unregistered email', async () => {
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce(
      queueStartResult({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 1,
        nextPollSeconds: 0,
        statusFetchedAt: Date.now(),
      }),
    );
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce({
        status: 'CONSUMED',
        loginOutcome: 'INVALID_CREDENTIALS',
        usersAhead: 0,
        nextPollSeconds: 10,
      });
    vi.mocked(checkUserAvailability).mockResolvedValueOnce(true);
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'abc@Example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByRole('link', { name: '회원가입' })).toHaveAttribute(
      'href',
      '/signup',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('가입된 계정이 없는 이메일이에요.');
    expect(document.querySelector('.login-request-toast')).toBeNull();
    expect(checkUserAvailability).toHaveBeenCalledExactlyOnceWith('email', 'abc@example.com');
    expect(screen.getByLabelText('비밀번호')).toHaveValue('');
  });

  it('shows the signup hint when the initial queue confirmation rejects an unregistered email', async () => {
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce(
      queueStartResult({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 1,
        nextPollSeconds: 10,
      }),
    );
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce({
        status: 'CONSUMED',
        loginOutcome: 'INVALID_CREDENTIALS',
        usersAhead: 0,
        nextPollSeconds: 10,
      });
    vi.mocked(checkUserAvailability).mockResolvedValueOnce(true);
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'abc@Example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByRole('link', { name: '회원가입' })).toHaveAttribute(
      'href',
      '/signup',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('가입된 계정이 없는 이메일이에요.');
    expect(checkUserAvailability).toHaveBeenCalledExactlyOnceWith('email', 'abc@example.com');
    expect(screen.getByLabelText('비밀번호')).toHaveValue('');
  });

  it('keeps Escape cancellation pending until confirmed, then focuses email', async () => {
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce(
      queueStartResult({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 151,
        nextPollSeconds: 10,
      }),
    );
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 151,
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
      usersAhead: 151,
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
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce(
      queueStartResult({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 2,
        nextPollSeconds: 10,
      }),
    );
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 151,
        nextPollSeconds: 10,
      });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    const dialog = await screen.findByRole('dialog');
    const cancelButton = screen.getByRole('button', { name: '대기 취소' });
    await vi.waitFor(() => expect(cancelButton).toHaveFocus());
    expect(screen.getByLabelText('이메일').closest('.login-layout')).toHaveAttribute('inert');
    fireEvent.keyDown(dialog, { key: 'Tab' });
    await vi.waitFor(() => expect(cancelButton).toHaveFocus());

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
    vi.mocked(startOrResumeLoginQueue).mockResolvedValueOnce(
      queueStartResult({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 3,
        nextPollSeconds: 10,
      }),
    );
    vi.mocked(getLoginQueueStatus)
      .mockRejectedValueOnce(new QueueRequestError(404))
      .mockResolvedValueOnce({
        status: 'WAITING',
        loginOutcome: null,
        usersAhead: 3,
        nextPollSeconds: 10,
        statusFetchedAt: Date.now(),
      })
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
      await vi.advanceTimersByTimeAsync(250);
    });
    await vi.waitFor(() => expect(getLoginQueueStatus).toHaveBeenCalledTimes(2));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(submitQueuedLogin).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toHaveValue('');
  });
});
