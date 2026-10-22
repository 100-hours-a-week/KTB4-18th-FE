import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, FormEvent, MutableRefObject, SetStateAction } from 'react';

import {
  cancelLoginQueue,
  clearLoginOperationId,
  getLoginQueueGeneration,
  getLoginQueueStatus,
  reconcileLoginQueueStatus,
  calculateQueueStatusRetryDelayMs,
  getQueueCreateRetryDelayMs,
  getNextQueueCreateAttemptAt,
  publishQueueSignal,
  promiseWithTimeout,
  QueueRequestError,
  recoverQueuedLogin,
  retireAmbiguousLoginOperation,
  startOrResumeLoginQueue,
  submitQueuedLogin,
  subscribeQueueSignals,
  type LoginQueueTicket,
} from '../api/loginQueueApi';
import type { LoginSuccessResponse } from '../api/loginApi';
import { checkUserAvailability } from '../../user-signup/api/userAvailabilityApi';
import type { FieldErrors, CapacityWait } from './loginQueueFlowUtils';
import {
  EMAIL_NOT_REGISTERED_ERROR,
  getQueueErrorMessage,
  hasNonWhitespacePassword,
  normalizeEmail,
  validate,
  wait,
} from './loginQueueFlowUtils';

const MAX_TIMER_DELAY_MS = 2_147_000_000;
const MAX_USERS_AHEAD_WITHOUT_DIALOG = 150;
const INVALID_CREDENTIALS_MESSAGE =
  '이메일 또는 비밀번호를 확인해 주세요. 비밀번호를 다시 입력해 주세요.';

function shouldShowQueueDialog(ticket: LoginQueueTicket): boolean {
  return ticket.status === 'WAITING' && (ticket.usersAhead ?? 0) > MAX_USERS_AHEAD_WITHOUT_DIALOG;
}

function isQueuePending(ticket: LoginQueueTicket): boolean {
  return ticket.status === 'WAITING' || ticket.status === 'VERIFYING';
}

async function confirmNewWaitingTicket(ticket: LoginQueueTicket): Promise<LoginQueueTicket> {
  if (ticket.status !== 'WAITING' || ticket.statusFetchedAt !== undefined) return ticket;
  await wait(250);
  return promiseWithTimeout(getLoginQueueStatus(), 1_500, 'QUEUE_STATUS_PROBE_TIMEOUT');
}

type UseLoginQueueFlowProps = {
  email: string;
  password: string;
  setEmail: Dispatch<SetStateAction<string>>;
  setPassword: Dispatch<SetStateAction<string>>;
  setFieldErrors: Dispatch<SetStateAction<FieldErrors>>;
  setRequestError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  isSubmitting: boolean;
  isSubmittingRef: MutableRefObject<boolean>;
  setIsLoginSuccessful: Dispatch<SetStateAction<boolean>>;
  authCapabilityMessage?: string;
  skipInitialQueueRestore?: boolean;
  onLoginSuccess?: (response: LoginSuccessResponse) => void;
  onLoginStart?: () => void;
  onLoginFailure?: () => void;
};

export function useLoginQueueFlow({
  email,
  password,
  setEmail,
  setPassword,
  setFieldErrors,
  setRequestError,
  setIsSubmitting,
  isSubmitting,
  isSubmittingRef,
  setIsLoginSuccessful,
  authCapabilityMessage,
  skipInitialQueueRestore = false,
  onLoginSuccess,
  onLoginStart,
  onLoginFailure,
}: UseLoginQueueFlowProps) {
  const [queueTicket, setQueueTicket] = useState<LoginQueueTicket | null>(null);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [capacityWait, setCapacityWait] = useState<CapacityWait | null>(null);
  const [queueMessage, setQueueMessage] = useState('');
  const [ambiguousLogin, setAmbiguousLogin] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const queueGeneration = useRef(0);
  const activeSharedQueueGeneration = useRef<string | null>(null);
  const pendingCancelGeneration = useRef<string | null>(null);
  const statusRequestSequence = useRef(0);
  const hasCheckedInitialQueue = useRef(false);
  const lastQueuePositionUpdatedAt = useRef(0);
  const queueDialogRef = useRef<HTMLElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  const capacityRetries = useRef(0);
  const capacityRetryActive = useRef(false);
  const isAuthSupported = !authCapabilityMessage;
  function invalidateStatusReads() {
    statusRequestSequence.current += 1;
  }

  const closeTerminalQueue = useCallback(
    (ticket: LoginQueueTicket): boolean => {
      if (ticket.status !== 'CANCELLED' && ticket.status !== 'EXPIRED') return false;
      setQueueTicket(ticket);
      setPassword('');
      setIsQueueOpen(false);
      setCapacityWait(null);
      setAmbiguousLogin(false);
      setQueueMessage('');
      setRequestError(
        ticket.status === 'EXPIRED'
          ? '대기 시간이 만료되었어요. 다시 로그인해 주세요.'
          : '대기를 취소했어요. 다시 로그인해 주세요.',
      );
      return true;
    },
    [setPassword, setRequestError],
  );

  function updateEmail(value: string) {
    invalidateStatusReads();
    const nextEmail = normalizeEmail(value);
    setEmail(nextEmail);
    setFieldErrors((current) => ({
      ...current,
      email: validate(nextEmail, password).email,
      emailNeedsSignup: false,
    }));
  }

  const finishLogin = useCallback(
    (response: LoginSuccessResponse) => {
      statusRequestSequence.current += 1;
      queueGeneration.current += 1;
      setQueueTicket(null);
      setIsQueueOpen(false);
      setAmbiguousLogin(false);
      setPassword('');
      setRequestError('');
      setIsLoginSuccessful(true);
      publishQueueSignal({
        type: 'queue-login-complete',
        queueGeneration: getLoginQueueGeneration(),
      });
      if (onLoginSuccess) onLoginSuccess(response);
    },
    [onLoginSuccess, setIsLoginSuccessful, setPassword, setRequestError],
  );

  const showCredentialFailure = useCallback(
    async (submittedEmail: string, isCurrent: () => boolean) => {
      let emailAvailable = false;
      try {
        emailAvailable = await checkUserAvailability('email', submittedEmail);
      } catch {
        // Keep the generic credential message when the availability check cannot complete.
      }
      if (!isCurrent()) return;
      if (emailAvailable) {
        setFieldErrors({ email: EMAIL_NOT_REGISTERED_ERROR, emailNeedsSignup: true });
        setRequestError('');
      } else {
        setRequestError(INVALID_CREDENTIALS_MESSAGE);
      }
    },
    [setFieldErrors, setRequestError],
  );

  const recoverIfSuccessful = useCallback(
    async (
      retryAfterSeconds: number | undefined,
      isCurrent: () => boolean,
    ): Promise<{ recovered: boolean; status: LoginQueueTicket | null }> => {
      const firstCheckDelay =
        retryAfterSeconds === undefined
          ? 100 + Math.floor(Math.random() * 200)
          : Math.max(0, retryAfterSeconds * 1_000);
      await wait(firstCheckDelay);
      if (!isCurrent()) return { recovered: false, status: null };
      let status: LoginQueueTicket | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          status = await getLoginQueueStatus();
          if (!isCurrent()) return { recovered: false, status: null };
          setQueueTicket(status);
          if (closeTerminalQueue(status)) return { recovered: false, status };
          if (status.status !== 'CONSUMED' || status.loginOutcome !== 'SUCCESS')
            return { recovered: false, status };
          const recovered = await recoverQueuedLogin();
          if (!isCurrent()) return { recovered: false, status: null };
          finishLogin({ message: 'login success', data: recovered.data });
          return { recovered: true, status };
        } catch (error) {
          if (!isCurrent()) return { recovered: false, status: null };
          if (
            !(error instanceof QueueRequestError) ||
            (error.status !== 503 && error.status !== 429 && error.status !== null) ||
            attempt === 2
          )
            return { recovered: false, status };
          await wait(calculateQueueStatusRetryDelayMs(attempt + 1, error.retryAfterSeconds));
          if (!isCurrent()) return { recovered: false, status: null };
        }
      }
      return { recovered: false, status };
    },
    [closeTerminalQueue, finishLogin],
  );

  useEffect(() => {
    if (hasCheckedInitialQueue.current) return;
    hasCheckedInitialQueue.current = true;
    if (skipInitialQueueRestore) return;

    let isActive = true;
    const requestSequence = ++statusRequestSequence.current;
    const sharedGeneration = getLoginQueueGeneration();
    void getLoginQueueStatus()
      .then(async (ticket) => {
        if (
          !isActive ||
          requestSequence !== statusRequestSequence.current ||
          sharedGeneration !== getLoginQueueGeneration()
        )
          return;
        activeSharedQueueGeneration.current = sharedGeneration;
        setQueueTicket(ticket);
        if (closeTerminalQueue(ticket)) return;
        if (ticket.status === 'WAITING' || ticket.status === 'VERIFYING') {
          setIsQueueOpen(shouldShowQueueDialog(ticket));
          return;
        }
        if (ticket.status === 'RETRYABLE') {
          setPassword('');
          setIsQueueOpen(false);
          setRequestError(
            '로그인 확인 시간이 만료되었어요. 비밀번호를 다시 입력해 로그인을 이어가 주세요.',
          );
          return;
        }
        if (ticket.status === 'READY') {
          setIsQueueOpen(false);
          setRequestError('차례가 되었어요. 이메일과 비밀번호를 입력해 로그인을 이어가 주세요.');
          return;
        }
        if (ticket.status === 'CONSUMED' && ticket.loginOutcome === 'SUCCESS') {
          try {
            const recovered = await recoverQueuedLogin();
            if (
              isActive &&
              requestSequence === statusRequestSequence.current &&
              sharedGeneration === getLoginQueueGeneration()
            )
              finishLogin({ message: 'login success', data: recovered.data });
          } catch {
            if (
              isActive &&
              requestSequence === statusRequestSequence.current &&
              sharedGeneration === getLoginQueueGeneration()
            )
              setAmbiguousLogin(true);
          }
        }
      })
      .catch((error: unknown) => {
        if (!isActive || !(error instanceof QueueRequestError)) return;
        if (error.status === 410) {
          setPassword('');
          setIsQueueOpen(false);
          setRequestError('대기 시간이 만료되었어요. 다시 로그인해 주세요.');
        }
      });
    return () => {
      isActive = false;
    };
  }, [closeTerminalQueue, finishLogin, setPassword, setRequestError, skipInitialQueueRestore]);

  const submitReadyLogin = useCallback(
    async (credentials: { email: string; password: string }, diagnosticCorrelationId?: string) => {
      if (isSubmittingRef.current) return;
      invalidateStatusReads();
      const requestSequence = statusRequestSequence.current;
      const sharedGeneration = getLoginQueueGeneration();
      const isRequestCurrent = () => requestSequence === statusRequestSequence.current;
      const isCurrent = () => isRequestCurrent() && sharedGeneration === getLoginQueueGeneration();
      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setQueueMessage('차례가 되었어요. 로그인을 진행하고 있어요.');
      onLoginStart?.();
      try {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            const correlationId = diagnosticCorrelationId ?? queueTicket?.diagnosticCorrId;
            const expectedGeneration =
              activeSharedQueueGeneration.current ?? getLoginQueueGeneration();
            const response = correlationId
              ? await submitQueuedLogin(credentials, expectedGeneration, correlationId)
              : await submitQueuedLogin(credentials, expectedGeneration);
            capacityRetries.current = 0;
            finishLogin(response as LoginSuccessResponse);
            return;
          } catch (error) {
            if (error instanceof QueueRequestError && error.status === 401) {
              if (!isRequestCurrent()) return;
              queueGeneration.current += 1;
              setQueueTicket(null);
              setIsQueueOpen(false);
              setPassword('');
              setIsLoginSuccessful(false);
              clearLoginOperationId();
              onLoginFailure?.();
              await showCredentialFailure(credentials.email, isRequestCurrent);
              return;
            }
            if (!isCurrent()) return;
            if (
              error instanceof QueueRequestError &&
              error.status === 429 &&
              error.code === 'BCRYPT_CAPACITY'
            ) {
              capacityRetries.current += 1;
              if (capacityRetries.current > 3) {
                setQueueMessage(
                  '로그인 요청이 많아요. 비밀번호를 다시 입력한 뒤 다시 시도해 주세요.',
                );
                setPassword('');
                setIsQueueOpen(false);
                setQueueTicket(null);
                clearLoginOperationId();
                onLoginFailure?.();
                return;
              }
              await wait(Math.min(error.retryAfterSeconds ?? 1, 60) * 1000);
              continue;
            }
            if (
              error instanceof QueueRequestError &&
              error.status === 429 &&
              error.code === 'QUEUE_WAITING'
            ) {
              const status = await getLoginQueueStatus();
              if (!isCurrent()) return;
              setQueueTicket(status);
              if (closeTerminalQueue(status)) return;
              if (status.status === 'READY' || status.status === 'RETRYABLE') continue;
              const isWaiting = isQueuePending(status);
              setIsQueueOpen(shouldShowQueueDialog(status));
              if (isWaiting) {
                setQueueMessage(
                  status.status === 'VERIFYING'
                    ? '로그인 처리가 진행 중이에요. 결과를 확인하고 있어요.'
                    : '아직 차례가 아니에요. 순서를 다시 확인할게요.',
                );
              } else {
                setRequestError('로그인 대기 상태가 아니에요. 다시 로그인해 주세요.');
              }
              return;
            }
            if (
              error instanceof QueueRequestError &&
              (error.status === null ||
                error.status >= 500 ||
                error.code === 'LOGIN_RESULT_AMBIGUOUS')
            ) {
              try {
                const resolution = await recoverIfSuccessful(
                  error.retryAfterSeconds ?? undefined,
                  isCurrent,
                );
                if (!isCurrent()) return;
                if (resolution.recovered) return;
                if (resolution.status) {
                  setQueueTicket(resolution.status);
                  const isPending = isQueuePending(resolution.status);
                  setIsQueueOpen(shouldShowQueueDialog(resolution.status));
                  if (isPending) {
                    setAmbiguousLogin(false);
                    setQueueMessage(
                      resolution.status.status === 'VERIFYING'
                        ? '로그인 상태를 확인하고 있어요. 같은 대기 요청으로 이어서 처리할게요.'
                        : '대기 상태를 다시 확인했어요. 차례가 되면 이어서 로그인할게요.',
                    );
                    return;
                  }
                }
              } catch {
                // Do not replay credentials after an ambiguous response.
              }
              setPassword('');
              setAmbiguousLogin(true);
              setQueueMessage('로그인 결과를 확인할 수 없어요. 비밀번호는 다시 전송하지 않았어요.');
              return;
            }
            if (error instanceof QueueRequestError && error.status === 409) {
              if (['QUEUE_LOGIN_IN_PROGRESS', 'TICKET_NOT_READY'].includes(error.code ?? '')) {
                try {
                  const status = await getLoginQueueStatus();
                  if (!isCurrent()) return;
                  setQueueTicket(status);
                  if (closeTerminalQueue(status)) return;
                  if (status.status === 'CONSUMED' && status.loginOutcome === 'SUCCESS') {
                    const resolution = await recoverIfSuccessful(undefined, isCurrent);
                    if (resolution.recovered) return;
                  }
                  if (
                    status.status === 'CONSUMED' &&
                    status.loginOutcome === 'INVALID_CREDENTIALS'
                  ) {
                    queueGeneration.current += 1;
                    setQueueTicket(null);
                    setIsQueueOpen(false);
                    setPassword('');
                    clearLoginOperationId();
                    onLoginFailure?.();
                    await showCredentialFailure(credentials.email, isCurrent);
                    return;
                  }
                  if (
                    status.status === 'RETRYABLE' ||
                    (status.status === 'READY' && error.code === 'TICKET_NOT_READY')
                  )
                    continue;
                  if (status.status === 'READY' && error.code === 'QUEUE_LOGIN_IN_PROGRESS') {
                    setIsQueueOpen(false);
                    setPassword('');
                    setAmbiguousLogin(true);
                    setQueueMessage(
                      '로그인 진행 상태를 확인할 수 없어요. 기존 로그인 상태를 확인해 주세요.',
                    );
                    return;
                  }
                  const isWaiting = isQueuePending(status);
                  setIsQueueOpen(shouldShowQueueDialog(status));
                  if (isWaiting) {
                    setQueueMessage(
                      status.status === 'VERIFYING'
                        ? '로그인 처리가 진행 중이에요. 결과를 확인하고 있어요.'
                        : '대기 상태를 다시 확인했어요. 차례가 되면 이어서 로그인할게요.',
                    );
                  } else {
                    setRequestError('로그인 상태를 다시 확인할 수 없어요. 다시 로그인해 주세요.');
                  }
                  return;
                } catch {
                  setQueueMessage(
                    '로그인 상태를 확인할 수 없어요. 기존 대기 요청을 유지하고 있어요.',
                  );
                  setIsQueueOpen(false);
                  setRequestError('로그인 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
                  return;
                }
              }
              setPassword('');
              setQueueMessage(getQueueErrorMessage(error));
              return;
            }
            setRequestError(getQueueErrorMessage(error));
            onLoginFailure?.();
            return;
          }
        }
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [
      closeTerminalQueue,
      finishLogin,
      isSubmittingRef,
      onLoginFailure,
      onLoginStart,
      queueTicket?.diagnosticCorrId,
      recoverIfSuccessful,
      showCredentialFailure,
      setIsLoginSuccessful,
      setIsSubmitting,
      setPassword,
      setRequestError,
    ],
  );

  async function submitAgainstExistingAmbiguousOperation(credentials: {
    email: string;
    password: string;
  }): Promise<void> {
    const generationAtStart = getLoginQueueGeneration();
    const submitKnownTicket = async (ticket: LoginQueueTicket) => {
      if (generationAtStart !== getLoginQueueGeneration()) return;
      activeSharedQueueGeneration.current = getLoginQueueGeneration();
      setQueueTicket(ticket);
      if (ticket.status === 'WAITING' || ticket.status === 'VERIFYING') {
        setAmbiguousLogin(false);
        setIsQueueOpen(shouldShowQueueDialog(ticket));
        setQueueMessage(
          ticket.status === 'VERIFYING'
            ? '로그인 처리가 진행 중이에요. 결과를 확인하고 있어요.'
            : '기존 대기 요청을 이어서 확인할게요.',
        );
        return;
      }
      if (ticket.status === 'READY' || ticket.status === 'RETRYABLE') {
        setAmbiguousLogin(false);
        setIsQueueOpen(false);
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        await submitReadyLogin(credentials, ticket.diagnosticCorrId);
        return;
      }
      if (ticket.status === 'CONSUMED' && ticket.loginOutcome === 'SUCCESS') {
        try {
          const recovered = await recoverQueuedLogin();
          setAmbiguousLogin(false);
          finishLogin({ message: 'login success', data: recovered.data });
        } catch (error) {
          if (error instanceof QueueRequestError && error.code === 'LOGIN_RECOVERY_UNAVAILABLE') {
            retireAmbiguousLoginOperation();
            setQueueTicket(null);
            setIsQueueOpen(false);
            setAmbiguousLogin(false);
            setPassword('');
            setRequestError(
              '이전 로그인 확인이 만료되었어요. 새 비밀번호를 입력해 다시 로그인해 주세요.',
            );
            return;
          }
          throw error;
        }
        return;
      }
      if (
        ticket.status === 'CONSUMED' ||
        ticket.status === 'CANCELLED' ||
        ticket.status === 'EXPIRED'
      ) {
        retireAmbiguousLoginOperation();
        setQueueTicket(null);
        setIsQueueOpen(false);
        setAmbiguousLogin(false);
        setIsSubmitting(false);
        isSubmittingRef.current = false;
        if (ticket.status === 'CONSUMED') {
          await submitAgainstFreshQueue(credentials);
        } else {
          setPassword('');
          setRequestError(
            ticket.status === 'EXPIRED'
              ? '기존 대기 시간이 만료되었어요. 새 비밀번호를 입력해 다시 로그인해 주세요.'
              : '기존 대기가 취소되었어요. 새 비밀번호를 입력해 다시 로그인해 주세요.',
          );
        }
      }
    };

    try {
      const status = await getLoginQueueStatus();
      if (generationAtStart !== getLoginQueueGeneration()) return;
      await submitKnownTicket(status);
    } catch (error) {
      if (error instanceof QueueRequestError && (error.status === 404 || error.status === 410)) {
        retireAmbiguousLoginOperation();
        await submitAgainstFreshQueue(credentials);
        return;
      }
      if (error instanceof QueueRequestError && error.code === 'LOGIN_RECOVERY_UNAVAILABLE') {
        retireAmbiguousLoginOperation();
        setQueueTicket(null);
        setIsQueueOpen(false);
        setAmbiguousLogin(false);
        setPassword('');
        setRequestError(
          '이전 로그인 확인이 만료되었어요. 새 비밀번호를 입력해 다시 로그인해 주세요.',
        );
        return;
      }
      setPassword('');
      setAmbiguousLogin(true);
      setIsQueueOpen(false);
      setQueueMessage('로그인 상태를 확인하지 못했어요. 비밀번호를 다시 입력해 시도해 주세요.');
    }
  }

  async function submitAgainstFreshQueue(credentials: {
    email: string;
    password: string;
  }): Promise<void> {
    const requestSequence = statusRequestSequence.current;
    const sharedGeneration = getLoginQueueGeneration();
    const isCurrent = () =>
      requestSequence === statusRequestSequence.current &&
      sharedGeneration === getLoginQueueGeneration();
    const ticket = await confirmNewWaitingTicket(await startOrResumeLoginQueue());
    if (!isCurrent()) return;
    activeSharedQueueGeneration.current = getLoginQueueGeneration();
    setQueueTicket(ticket);
    if (closeTerminalQueue(ticket)) return;
    if (ticket.status === 'READY' || ticket.status === 'RETRYABLE') {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      await submitReadyLogin(credentials, ticket.diagnosticCorrId);
      return;
    }
    if (ticket.status === 'CONSUMED' && ticket.loginOutcome === 'SUCCESS') {
      const recovered = await recoverQueuedLogin();
      finishLogin({ message: 'login success', data: recovered.data });
      return;
    }
    if (ticket.status === 'CONSUMED' && ticket.loginOutcome === 'INVALID_CREDENTIALS') {
      setQueueTicket(null);
      setPassword('');
      setIsQueueOpen(false);
      clearLoginOperationId();
      onLoginFailure?.();
      await showCredentialFailure(credentials.email, isCurrent);
      return;
    }
    setAmbiguousLogin(false);
    setIsQueueOpen(shouldShowQueueDialog(ticket));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    invalidateStatusReads();
    const requestSequence = statusRequestSequence.current;
    const sharedGeneration = getLoginQueueGeneration();
    const isCurrent = () =>
      requestSequence === statusRequestSequence.current &&
      sharedGeneration === getLoginQueueGeneration();
    lastQueuePositionUpdatedAt.current = 0;
    const normalizedEmail = normalizeEmail(email.trim());
    setEmail(normalizedEmail);
    const nextFieldErrors = validate(normalizedEmail, password);
    setFieldErrors(nextFieldErrors);
    const wasAmbiguous = ambiguousLogin;
    setRequestError('');
    setIsLoginSuccessful(false);
    setAmbiguousLogin(false);
    if (!isAuthSupported) {
      setRequestError(authCapabilityMessage);
      return;
    }
    if (Object.keys(nextFieldErrors).length > 0) return;

    setIsSubmitting(true);
    isSubmittingRef.current = true;
    try {
      if (wasAmbiguous) {
        await submitAgainstExistingAmbiguousOperation({
          email: normalizedEmail,
          password,
        });
        return;
      }
      const ticket = await confirmNewWaitingTicket(await startOrResumeLoginQueue());
      if (!isCurrent()) return;
      setCapacityWait(null);
      activeSharedQueueGeneration.current = getLoginQueueGeneration();
      setQueueTicket(ticket);
      if (closeTerminalQueue(ticket)) return;
      setIsQueueOpen(shouldShowQueueDialog(ticket));
      if (ticket.status === 'READY') {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        await submitReadyLogin({ email: normalizedEmail, password }, ticket.diagnosticCorrId);
      } else if (ticket.status === 'RETRYABLE') {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        await submitReadyLogin({ email: normalizedEmail, password }, ticket.diagnosticCorrId);
      } else if (ticket.status === 'CONSUMED' && ticket.loginOutcome === 'SUCCESS') {
        const recovered = await recoverQueuedLogin();
        finishLogin({ message: 'login success', data: recovered.data });
      } else if (ticket.status === 'CONSUMED' && ticket.loginOutcome === 'INVALID_CREDENTIALS') {
        setQueueTicket(null);
        setPassword('');
        setIsQueueOpen(false);
        clearLoginOperationId();
        onLoginFailure?.();
        await showCredentialFailure(normalizedEmail, isCurrent);
      } else if (ticket.status === 'CONSUMED') {
        setRequestError('이전 로그인 시도가 종료되었어요. 비밀번호를 다시 입력해 주세요.');
        setPassword('');
        setIsQueueOpen(false);
      }
    } catch (error) {
      if (
        error instanceof QueueRequestError &&
        [
          'QUEUE_FULL',
          'RATE_LIMITED',
          'OPERATION_IN_PROGRESS',
          'QUEUE_RETRY_WAIT',
          'QUEUE_LOCK_BUSY',
        ].includes(error.code ?? '')
      ) {
        setRequestError('');
        setCapacityWait({
          reason:
            error.code === 'QUEUE_FULL'
              ? 'QUEUE_FULL'
              : error.code === 'RATE_LIMITED'
                ? 'RATE_LIMITED'
                : 'OPERATION_IN_PROGRESS',
          mode: 'waiting',
          delayMs:
            getQueueCreateRetryDelayMs() ?? Math.max(1_000, (error.retryAfterSeconds ?? 5) * 1000),
          message: getQueueErrorMessage(error),
        });
      } else if (
        error instanceof QueueRequestError &&
        ['CREATE_RETRIES_EXHAUSTED', 'QUEUE_STATUS_RETRY_PAUSED'].includes(error.code ?? '')
      ) {
        setRequestError('');
        setCapacityWait({
          reason: 'EXHAUSTED',
          mode: 'paused',
          delayMs: 0,
          message:
            error.code === 'QUEUE_STATUS_RETRY_PAUSED'
              ? '대기 상태 확인이 제한되어 자동 확인을 멈췄어요. 다시 확인할 수 있어요.'
              : '요청 결과를 확인할 수 없어 자동 재시도를 마쳤어요. 취소하거나 상태만 다시 확인해 주세요.',
        });
      } else if (
        error instanceof QueueRequestError &&
        (error.status === null || error.status >= 500)
      ) {
        setRequestError('');
        setCapacityWait({
          reason: 'TRANSPORT',
          mode: 'paused',
          delayMs: 0,
          message: '대기 요청 결과를 확인하지 못했어요. 같은 요청으로 다시 확인할 수 있어요.',
        });
      } else {
        setRequestError(getQueueErrorMessage(error));
      }
      if (error instanceof QueueRequestError && [404, 410].includes(error.status ?? 0)) {
        setQueueTicket(null);
        setIsQueueOpen(false);
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  const retryCapacityWait = useCallback(async () => {
    if (capacityRetryActive.current || !capacityWait) return;
    const requestSequence = statusRequestSequence.current;
    const sharedGeneration = getLoginQueueGeneration();
    const submittedEmail = normalizeEmail(email.trim());
    const isCurrent = () =>
      requestSequence === statusRequestSequence.current &&
      sharedGeneration === getLoginQueueGeneration();
    capacityRetryActive.current = true;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const ticket = await confirmNewWaitingTicket(await startOrResumeLoginQueue());
      if (!isCurrent()) return;
      setCapacityWait(null);
      setQueueTicket(ticket);
      if (closeTerminalQueue(ticket)) return;
      activeSharedQueueGeneration.current = getLoginQueueGeneration();
      setIsQueueOpen(shouldShowQueueDialog(ticket));
      if (ticket.status === 'READY') {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        await submitReadyLogin(
          { email: normalizeEmail(email.trim()), password },
          ticket.diagnosticCorrId,
        );
      } else if (ticket.status === 'RETRYABLE') {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        await submitReadyLogin(
          { email: normalizeEmail(email.trim()), password },
          ticket.diagnosticCorrId,
        );
      } else if (ticket.status === 'CONSUMED' && ticket.loginOutcome === 'SUCCESS') {
        const recovered = await recoverQueuedLogin();
        finishLogin({ message: 'login success', data: recovered.data });
      } else if (ticket.status === 'CONSUMED' && ticket.loginOutcome === 'INVALID_CREDENTIALS') {
        setQueueTicket(null);
        setPassword('');
        setIsQueueOpen(false);
        clearLoginOperationId();
        onLoginFailure?.();
        await showCredentialFailure(submittedEmail, isCurrent);
      } else if (ticket.status === 'CONSUMED') {
        setPassword('');
        setIsQueueOpen(false);
        setRequestError('이전 로그인 시도가 종료되었어요. 비밀번호를 다시 입력해 주세요.');
      }
    } catch (error) {
      if (
        error instanceof QueueRequestError &&
        [
          'QUEUE_FULL',
          'RATE_LIMITED',
          'OPERATION_IN_PROGRESS',
          'QUEUE_RETRY_WAIT',
          'QUEUE_LOCK_BUSY',
        ].includes(error.code ?? '')
      ) {
        setCapacityWait({
          reason:
            error.code === 'QUEUE_FULL'
              ? 'QUEUE_FULL'
              : error.code === 'RATE_LIMITED'
                ? 'RATE_LIMITED'
                : 'OPERATION_IN_PROGRESS',
          mode: 'waiting',
          delayMs:
            getQueueCreateRetryDelayMs() ?? Math.max(1_000, (error.retryAfterSeconds ?? 5) * 1000),
          message: getQueueErrorMessage(error),
        });
      } else {
        if (error instanceof QueueRequestError && error.code === 'CREATE_RETRIES_EXHAUSTED') {
          setCapacityWait({
            reason: 'EXHAUSTED',
            mode: 'paused',
            delayMs: 0,
            message:
              '요청 결과를 확인할 수 없어 자동 재시도를 마쳤어요. 취소하거나 상태만 다시 확인해 주세요.',
          });
          return;
        }
        setCapacityWait({
          reason: 'TRANSPORT',
          mode: 'paused',
          delayMs: 0,
          message: '대기 요청 결과를 확인하지 못했어요. 같은 요청으로 다시 확인할 수 있어요.',
        });
      }
    } finally {
      capacityRetryActive.current = false;
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [
    capacityWait,
    closeTerminalQueue,
    email,
    finishLogin,
    isSubmittingRef,
    onLoginFailure,
    password,
    setIsSubmitting,
    setPassword,
    setRequestError,
    showCredentialFailure,
    submitReadyLogin,
  ]);

  async function reconcileExhaustedQueue() {
    if (isSubmitting) return;
    const requestSequence = statusRequestSequence.current;
    const sharedGeneration = getLoginQueueGeneration();
    const submittedEmail = normalizeEmail(email.trim());
    const isCurrent = () =>
      requestSequence === statusRequestSequence.current &&
      sharedGeneration === getLoginQueueGeneration();
    setIsSubmitting(true);
    try {
      const ticket = await reconcileLoginQueueStatus();
      if (!isCurrent()) return;
      setCapacityWait(null);
      setQueueTicket(ticket);
      if (closeTerminalQueue(ticket)) return;
      setIsQueueOpen(shouldShowQueueDialog(ticket));
      activeSharedQueueGeneration.current = getLoginQueueGeneration();
      if (ticket.status === 'CONSUMED' && ticket.loginOutcome === 'SUCCESS') {
        const recovered = await recoverQueuedLogin();
        finishLogin({ message: 'login success', data: recovered.data });
      } else if (ticket.status === 'CONSUMED' && ticket.loginOutcome === 'INVALID_CREDENTIALS') {
        setQueueTicket(null);
        setPassword('');
        setIsQueueOpen(false);
        clearLoginOperationId();
        onLoginFailure?.();
        await showCredentialFailure(submittedEmail, isCurrent);
      } else if (ticket.status === 'CONSUMED') {
        setPassword('');
        setRequestError('대기 요청이 이미 종료되었어요. 새 로그인을 시작할 수 있어요.');
      } else if (ticket.status === 'READY' && hasNonWhitespacePassword(password)) {
        setIsQueueOpen(false);
        await submitReadyLogin(
          { email: normalizeEmail(email.trim()), password },
          ticket.diagnosticCorrId,
        );
      } else if (ticket.status === 'READY') {
        setIsQueueOpen(false);
        setRequestError('차례가 되었어요. 비밀번호를 입력해 로그인을 이어가 주세요.');
      } else if (ticket.status === 'RETRYABLE' && hasNonWhitespacePassword(password)) {
        await submitReadyLogin(
          { email: normalizeEmail(email.trim()), password },
          ticket.diagnosticCorrId,
        );
      } else if (ticket.status === 'RETRYABLE') {
        setIsQueueOpen(false);
        setRequestError('로그인을 이어가려면 비밀번호를 다시 입력해 주세요.');
      }
    } catch (error) {
      if (error instanceof QueueRequestError && error.status === 404) {
        setCapacityWait(null);
        setQueueTicket(null);
        setIsQueueOpen(false);
        await retryCapacityWait();
        return;
      }
      if (error instanceof QueueRequestError && error.status === 410) {
        setCapacityWait(null);
        setQueueTicket(null);
        setIsQueueOpen(false);
        setPassword('');
        setRequestError('대기 시간이 만료되었어요. 다시 로그인해 주세요.');
        return;
      }
      setCapacityWait((current) =>
        current?.reason === 'EXHAUSTED'
          ? {
              ...current,
              message: '현재 확인된 대기 정보가 없어요. 요청은 유지되고 있어요. 취소할 수 있어요.',
            }
          : current,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  useEffect(() => {
    if (!capacityWait || capacityWait.mode !== 'waiting') return;
    let timer: number | undefined;
    let isActive = true;
    let deadline = performance.now() + Math.max(0, capacityWait.delayMs);
    const schedule = () => {
      if (!isActive || document.visibilityState === 'hidden') return;
      if (timer !== undefined) window.clearTimeout(timer);
      const persistedDeadline = getNextQueueCreateAttemptAt();
      const remaining = Math.max(0, deadline - performance.now());
      const nextChunk = Math.min(remaining, MAX_TIMER_DELAY_MS);
      timer = window.setTimeout(() => {
        if (persistedDeadline && Date.now() < persistedDeadline) {
          deadline = performance.now() + Math.max(0, persistedDeadline - Date.now());
          schedule();
          return;
        }
        if (remaining > MAX_TIMER_DELAY_MS) {
          schedule();
          return;
        }
        if (document.visibilityState !== 'hidden') void retryCapacityWait();
      }, nextChunk);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    const onPageHide = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    window.addEventListener('pageshow', onVisible);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisible);
    schedule();
    return () => {
      isActive = false;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('pageshow', onVisible);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [capacityWait, retryCapacityWait]);

  useEffect(() => {
    if (!queueTicket || !['WAITING', 'VERIFYING'].includes(queueTicket.status)) return;
    let isActive = true;
    const generation = queueGeneration.current;
    const sharedGeneration = activeSharedQueueGeneration.current ?? getLoginQueueGeneration();
    const initialPollDelay =
      queueTicket.statusFetchedAt === undefined
        ? 500
        : Math.max(
            500,
            queueTicket.nextPollSeconds * 1_000 - (Date.now() - queueTicket.statusFetchedAt),
          );
    let timer: number | undefined;
    let consecutivePollErrors = 0;
    let nextPollDelay = Math.max(5_500, queueTicket.nextPollSeconds * 1_000);
    let terminalStatusSeen = false;
    const poll = async () => {
      if (getLoginQueueGeneration() !== sharedGeneration) {
        queueGeneration.current += 1;
        activeSharedQueueGeneration.current = null;
        setPassword('');
        setQueueTicket(null);
        setIsQueueOpen(false);
        setQueueMessage('다른 탭에서 대기 정보가 변경되었어요. 다시 로그인해 주세요.');
        return;
      }
      const requestSequence = ++statusRequestSequence.current;
      try {
        const ticket = await getLoginQueueStatus();
        if (
          !isActive ||
          generation !== queueGeneration.current ||
          requestSequence !== statusRequestSequence.current
        )
          return;
        if (getLoginQueueGeneration() !== sharedGeneration) {
          queueGeneration.current += 1;
          activeSharedQueueGeneration.current = null;
          setPassword('');
          setQueueTicket(null);
          setIsQueueOpen(false);
          setQueueMessage('다른 탭에서 대기 정보가 변경되었어요. 다시 로그인해 주세요.');
          return;
        }
        consecutivePollErrors = 0;
        nextPollDelay = Math.max(5_500, ticket.nextPollSeconds * 1_000);
        setIsQueueOpen(shouldShowQueueDialog(ticket));
        if (ticket.status === 'WAITING') {
          const now = Date.now();
          const shouldUpdatePosition = now - lastQueuePositionUpdatedAt.current >= 10_000;
          if (shouldUpdatePosition) {
            lastQueuePositionUpdatedAt.current = now;
            setQueueTicket((current) =>
              current?.status === 'WAITING' && current.usersAhead === ticket.usersAhead
                ? current
                : ticket,
            );
          }
        } else {
          setQueueTicket(ticket);
        }
        if (closeTerminalQueue(ticket)) {
          terminalStatusSeen = true;
          return;
        }
        if (ticket.status === 'READY') {
          setIsQueueOpen(false);
          if (hasNonWhitespacePassword(password)) {
            setQueueMessage('차례가 되었어요. 로그인을 진행할게요.');
            void submitReadyLogin(
              { email: normalizeEmail(email.trim()), password },
              ticket.diagnosticCorrId,
            );
          } else {
            setIsQueueOpen(false);
            setRequestError('차례가 되었어요. 이메일과 비밀번호를 입력해 로그인을 이어가 주세요.');
          }
        } else if (ticket.status === 'RETRYABLE') {
          setIsQueueOpen(false);
          if (hasNonWhitespacePassword(password)) {
            setQueueMessage('같은 대기 요청으로 다시 등록하고 있어요.');
            void submitReadyLogin(
              { email: normalizeEmail(email.trim()), password },
              ticket.diagnosticCorrId,
            );
          } else {
            setIsQueueOpen(false);
            setQueueMessage(
              '로그인 확인 시간이 만료되었어요. 비밀번호를 다시 입력해 순서를 이어가 주세요.',
            );
            setRequestError('비밀번호를 다시 입력하면 같은 대기 요청으로 이어집니다.');
          }
        } else if (ticket.status === 'CONSUMED' && ticket.loginOutcome === 'SUCCESS') {
          try {
            const recovered = await recoverQueuedLogin();
            if (isActive && generation === queueGeneration.current) {
              finishLogin({ message: 'login success', data: recovered.data });
            }
          } catch {
            if (isActive && generation === queueGeneration.current) {
              setPassword('');
              setAmbiguousLogin(true);
              setQueueMessage(
                '로그인 결과를 확인했지만 세션을 복구하지 못했어요. 다시 시작해 주세요.',
              );
            }
          }
        } else if (ticket.status === 'CONSUMED' && ticket.loginOutcome === 'INVALID_CREDENTIALS') {
          setPassword('');
          setIsQueueOpen(false);
          terminalStatusSeen = true;
          await showCredentialFailure(
            normalizeEmail(email.trim()),
            () =>
              generation === queueGeneration.current &&
              requestSequence === statusRequestSequence.current &&
              getLoginQueueGeneration() === sharedGeneration,
          );
        }
      } catch (error) {
        if (
          !isActive ||
          generation !== queueGeneration.current ||
          requestSequence !== statusRequestSequence.current ||
          getLoginQueueGeneration() !== sharedGeneration
        )
          return;
        consecutivePollErrors += 1;
        if (error instanceof QueueRequestError && [404, 410].includes(error.status ?? 0)) {
          terminalStatusSeen = error.status === 410;
          setQueueTicket(null);
          setQueueMessage('대기 정보가 만료되었어요. 로그인 버튼을 눌러 다시 시작해 주세요.');
          setIsQueueOpen(false);
          setPassword('');
          return;
        }
        setQueueMessage(getQueueErrorMessage(error));
        if (error instanceof QueueRequestError && (error.status === 429 || error.status === 503)) {
          nextPollDelay = calculateQueueStatusRetryDelayMs(
            consecutivePollErrors,
            error.retryAfterSeconds,
          );
        }
        if (consecutivePollErrors >= 3) {
          setQueueMessage('대기 상태를 확인하지 못했어요. 연결이 복구되면 다시 확인할게요.');
        }
      } finally {
        if (
          !terminalStatusSeen &&
          isActive &&
          generation === queueGeneration.current &&
          requestSequence === statusRequestSequence.current &&
          getLoginQueueGeneration() === sharedGeneration
        )
          timer = window.setTimeout(poll, nextPollDelay);
      }
    };
    timer = window.setTimeout(poll, initialPollDelay);
    return () => {
      isActive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    closeTerminalQueue,
    email,
    finishLogin,
    password,
    queueTicket,
    setPassword,
    retryCapacityWait,
    setRequestError,
    showCredentialFailure,
    submitReadyLogin,
  ]);

  useEffect(
    () =>
      subscribeQueueSignals((signal) => {
        if (signal.type === 'queue-cancel-requested') {
          if (signal.queueGeneration !== getLoginQueueGeneration()) return;
          pendingCancelGeneration.current = signal.queueGeneration;
          setPassword('');
          setIsCanceling(true);
          setQueueMessage('다른 탭에서 취소를 요청했어요. 취소 결과를 확인하고 있어요.');
          setCapacityWait((current) =>
            current?.mode === 'waiting'
              ? {
                  ...current,
                  mode: 'paused',
                  message: '다른 탭에서 취소를 요청했어요. 취소 결과를 확인하고 있어요.',
                }
              : current,
          );
          return;
        }
        if (signal.type === 'queue-cancel-unconfirmed') {
          if (signal.queueGeneration !== pendingCancelGeneration.current) return;
          setIsCanceling(false);
          setQueueMessage('취소 결과를 확인하지 못했어요. 다시 취소해 주세요.');
          setCapacityWait((current) =>
            current?.mode === 'paused'
              ? { ...current, message: '취소 결과를 확인하지 못했어요. 다시 취소해 주세요.' }
              : current,
          );
          return;
        }
        if (signal.type === 'queue-logout-reset') {
          if (signal.queueGeneration !== getLoginQueueGeneration()) return;
          statusRequestSequence.current += 1;
          queueGeneration.current += 1;
          activeSharedQueueGeneration.current = null;
          pendingCancelGeneration.current = null;
          setIsCanceling(false);
          setCapacityWait(null);
          setPassword('');
          setIsQueueOpen(false);
          setQueueTicket(null);
          setAmbiguousLogin(false);
          setQueueMessage('');
          setRequestError('');
          return;
        }
        if (
          signal.type === 'queue-create-cancelled' &&
          signal.queueGeneration !== pendingCancelGeneration.current &&
          signal.queueGeneration !== getLoginQueueGeneration()
        ) {
          return;
        }
        if (
          signal.type !== 'queue-create-cancelled' &&
          signal.queueGeneration !== getLoginQueueGeneration()
        )
          return;
        if (signal.type === 'queue-create-cancelled') {
          pendingCancelGeneration.current = null;
          queueGeneration.current += 1;
          activeSharedQueueGeneration.current = null;
          setIsCanceling(false);
          setCapacityWait(null);
          setPassword('');
          setIsQueueOpen(false);
          setQueueTicket(null);
          setQueueMessage('다른 탭에서 대기를 취소했어요.');
          return;
        }
        if (signal.type === 'queue-login-complete') {
          queueGeneration.current += 1;
          setPassword('');
          setIsQueueOpen(false);
          setQueueTicket(null);
          setQueueMessage('로그인이 완료되었어요.');
        } else {
          setPassword('');
          setIsQueueOpen(false);
          setQueueTicket(null);
          setQueueMessage('다른 탭의 로그인 시도가 종료되었어요. 다시 로그인해 주세요.');
        }
      }),
    [setPassword, setRequestError],
  );

  useEffect(() => {
    if (!isQueueOpen) return;
    previouslyFocusedElement.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const firstFocusable = queueDialogRef.current?.querySelector<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    (firstFocusable ?? queueDialogRef.current)?.focus();
    return () => {
      previouslyFocusedElement.current?.focus();
      previouslyFocusedElement.current = null;
    };
  }, [isQueueOpen]);

  async function handleCancelQueue() {
    if (isCanceling) return;
    invalidateStatusReads();
    setIsCanceling(true);
    setQueueMessage('대기를 취소하고 있어요.');
    try {
      await cancelLoginQueue();
      queueGeneration.current += 1;
      activeSharedQueueGeneration.current = null;
      setCapacityWait(null);
      setQueueTicket(null);
      setIsQueueOpen(false);
      setPassword('');
      setQueueMessage('대기를 취소했어요. 로그인 버튼을 눌러 다시 시작할 수 있어요.');
      window.setTimeout(() => emailInputRef.current?.focus(), 0);
    } catch (error) {
      if (error instanceof QueueRequestError && error.code === 'QUEUE_CANCEL_UNCONFIRMED') {
        setCapacityWait({
          reason: 'TRANSPORT',
          mode: 'paused',
          delayMs: 0,
          message: '취소 결과를 확인하지 못했어요. 다시 확인해 주세요.',
        });
        return;
      }
      if (error instanceof QueueRequestError && error.status === 409) {
        setQueueMessage('로그인 진행 중에는 대기를 취소할 수 없어요. 결과를 확인하고 있어요.');
        return;
      }
      try {
        const current = await getLoginQueueStatus();
        setQueueTicket(current);
        if (closeTerminalQueue(current)) {
          return;
        } else if (current.status === 'CONSUMED') {
          setIsQueueOpen(false);
          setPassword('');
          setQueueMessage('로그인 시도가 이미 종료되었어요. 새로 시작할 수 있어요.');
        } else {
          setQueueMessage('취소 여부를 확인하지 못했어요. 대기 화면을 유지할게요.');
        }
      } catch (statusError) {
        if (
          statusError instanceof QueueRequestError &&
          [404, 410].includes(statusError.status ?? 0)
        ) {
          queueGeneration.current += 1;
          setIsQueueOpen(false);
          setQueueTicket(null);
          setPassword('');
          setQueueMessage('대기 정보가 종료되었어요. 다시 로그인할 수 있어요.');
        } else {
          setQueueMessage('취소 여부를 확인할 수 없어요. 잠시 후 다시 확인해 주세요.');
        }
      }
    } finally {
      setIsCanceling(false);
    }
  }

  return {
    queueTicket,
    isQueueOpen,
    capacityWait,
    queueMessage,
    ambiguousLogin,
    isCanceling,
    queueDialogRef,
    emailInputRef,
    isAuthSupported,
    invalidateStatusReads,
    updateEmail,
    handleSubmit,
    retryCapacityWait,
    reconcileExhaustedQueue,
    handleCancelQueue,
  };
}
