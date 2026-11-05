import { useDirectLoginRecovery } from './useDirectLoginRecovery';
import {
  inspectCommittedDirectLogout,
  performDirectLogout,
  releaseExpiredDirectLogout,
} from '../api/directAuthLogoutFlow';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { beginDirectAuthIntent, directAuthVersion } from '../api/directAuthSessionState';
import {
  completeDirectLogin,
  inspectDirectLogin,
  startDirectLogin,
  unresolvedDirectOperation,
  resolveDirectLoginFailure,
  releaseRejectedDirectLogin,
} from '../api/directAuthSessionFlow';
import { inspectDirectRecovery } from '../api/directAuthRecovery';
import { readCurrentDirectOperation } from '../api/directAuthFlowApi';
import {
  clearExpiredDirectAuthRefreshOperation,
  readDirectAuthOperation,
  snapshotDirectAuthOperations,
} from '../api/directAuthOperationStore';
import type { DirectAuthOperation } from '../api/directAuthTypes';
import type { LoginSuccessResponse } from '../api/loginTypes';
import { validate, type FieldErrors } from '../components/loginPage/loginFormValidation';

function pendingLogoutOperation(): DirectAuthOperation | null {
  try {
    return readDirectAuthOperation('LOGOUT');
  } catch {
    return null;
  }
}

type Options = {
  onRetryAuthRestore?: () => void;
  onLoginStart?: () => void;
  onLoginFailure?: () => void;
  onLoginSuccess?: (response: LoginSuccessResponse) => void;
};

export function useDirectLoginFlow(options: Options) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [hasPendingLogout, setHasPendingLogout] = useState(() => {
    return Boolean(pendingLogoutOperation());
  });
  const [canRetryPendingLogout, setCanRetryPendingLogout] = useState(false);
  const [isLocked, setIsLocked] = useState(() => {
    try {
      return Boolean(unresolvedDirectOperation());
    } catch {
      return true;
    }
  });
  const [message, setMessage] = useState(() => {
    try {
      return unresolvedDirectOperation()
        ? '로그인 결과를 확인하지 못했어요. 상태를 확인해 주세요.'
        : '';
    } catch {
      return '인증 요청을 안전하게 저장할 수 없어요.';
    }
  });
  const recovery = useDirectLoginRecovery({
    onLoginSuccess: options.onLoginSuccess,
    onReleased: () => setIsLocked(false),
    onMessage: setMessage,
  });
  const emailInputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const activeIntent = useRef<number | null>(null);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resolveDelay = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    let expirationTimer: ReturnType<typeof setTimeout> | undefined;
    const updateRetryAvailability = () => {
      const operation = pendingLogoutOperation();
      const remaining = operation ? operation.expiresAt - Date.now() : 0;
      setCanRetryPendingLogout(remaining > 0);
      if (remaining > 0) {
        expirationTimer = setTimeout(updateRetryAvailability, remaining);
      }
    };
    updateRetryAvailability();
    return () => {
      if (expirationTimer !== undefined) clearTimeout(expirationTimer);
    };
  }, [hasPendingLogout]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (activeIntent.current === directAuthVersion()) beginDirectAuthIntent();
      clearTimeout(timer.current);
      resolveDelay.current?.();
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current || isLocked || recovery.isRecovering) return;
    const submittedEmail =
      event.currentTarget.querySelector<HTMLInputElement>('#email')?.value ?? email;
    const submittedPassword =
      event.currentTarget.querySelector<HTMLInputElement>('#password')?.value ?? password;
    setEmail(submittedEmail);
    setPassword(submittedPassword);
    const errors = validate(submittedEmail, submittedPassword);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    busy.current = true;
    setIsPending(true);
    setIsLocked(true);
    setMessage('');
    options.onLoginStart?.();
    const version = beginDirectAuthIntent();
    activeIntent.current = version;
    const credentials = { email: submittedEmail.trim(), password: submittedPassword };
    try {
      const result = await startDirectLogin(credentials, version);
      credentials.password = '';
      if (!mounted.current || version !== directAuthVersion()) return;
      if (result.token) {
        if (!(await completeDirectLogin(result.operation, result.token, version)))
          throw new Error();
        setPassword('');
        activeIntent.current = null;
        if (mounted.current)
          options.onLoginSuccess?.({
            message: 'login success',
            data: {
              access_token: result.token.access_token,
              expires_in: Number(result.token.expires_in),
            },
          });
        return;
      }
      await poll(result.operation, version);
    } catch (error) {
      let rejected: boolean;
      try {
        rejected = await resolveDirectLoginFailure(error, version);
      } catch {
        rejected = false;
      }
      if (mounted.current && version === directAuthVersion()) {
        setIsLocked(!rejected);
        setMessage(
          rejected
            ? '로그인하지 못했어요. 입력 내용과 연결 상태를 확인하고 다시 시도해 주세요.'
            : '로그인 결과를 확인하지 못했어요. 상태를 확인해 주세요.',
        );
        options.onLoginFailure?.();
      }
    } finally {
      credentials.password = '';
      busy.current = false;
      if (mounted.current) setIsPending(false);
    }
  };

  const poll = async (operation: DirectAuthOperation, version: number) => {
    for (let count = 0; count < 10; count += 1) {
      if (!mounted.current || version !== directAuthVersion() || operation.expiresAt <= Date.now())
        break;
      await new Promise<void>((resolve) => {
        resolveDelay.current = resolve;
        timer.current = setTimeout(resolve, Math.min(1000, operation.expiresAt - Date.now()));
      });
      if (!mounted.current || version !== directAuthVersion() || operation.expiresAt <= Date.now())
        return;
      const result = await inspectDirectLogin(operation);
      if (!mounted.current || version !== directAuthVersion()) return;
      if (result.terminal) {
        if (result.rejected && releaseRejectedDirectLogin(operation, version)) {
          setIsLocked(false);
          setMessage('이메일 또는 비밀번호를 확인하고 다시 로그인해 주세요.');
          options.onLoginFailure?.();
          return;
        }
        setMessage(
          result.canonicalMatches
            ? '로그인 결과가 확인됐어요. 안전한 세션 복구를 아직 사용할 수 없어요.'
            : '로그인 요청이 종료됐어요. 인증 상태를 다시 확인해 주세요.',
        );
        options.onLoginFailure?.();
        return;
      }
    }
    if (mounted.current) setMessage('로그인 결과를 확인하지 못했어요. 상태를 확인해 주세요.');
    options.onLoginFailure?.();
  };

  const checkStatus = async () => {
    if (busy.current || recovery.isRecovering) return;
    busy.current = true;
    setIsPending(true);
    const version = directAuthVersion();
    try {
      const refresh = readDirectAuthOperation('REFRESH');
      if (refresh && refresh.expiresAt <= Date.now()) {
        const snapshot = snapshotDirectAuthOperations();
        if (Object.entries(snapshot).some(([kind, raw]) => kind !== 'REFRESH' && raw !== null)) {
          if (mounted.current && version === directAuthVersion()) {
            setIsLocked(true);
            setMessage(
              '다른 인증 요청이 남아 있어 자동으로 정리하지 않았어요. 인증 상태를 다시 확인해 주세요.',
            );
          }
          return;
        }
        try {
          const current = await readCurrentDirectOperation();
          if (
            current.data.operation === null &&
            clearExpiredDirectAuthRefreshOperation(snapshot, refresh)
          ) {
            if (mounted.current && version === directAuthVersion()) {
              setIsLocked(false);
              if (current.data.flow.authenticated) {
                setMessage('이전에 완료된 로그인 상태를 복구하고 있어요.');
                options.onRetryAuthRestore?.();
              } else {
                setMessage('만료된 로그인 요청을 정리했어요. 다시 로그인해 주세요.');
              }
            }
          } else if (mounted.current && version === directAuthVersion()) {
            setIsLocked(true);
            setMessage('인증 상태를 안전하게 확인하지 못했어요. 다시 시도해 주세요.');
          }
        } catch {
          if (mounted.current && version === directAuthVersion()) {
            setIsLocked(true);
            setMessage('인증 상태를 안전하게 확인하지 못했어요. 다시 시도해 주세요.');
          }
        }
        return;
      }
      const source = readDirectAuthOperation('LOGIN') ?? readDirectAuthOperation('LOGIN_RECOVERY');
      const logout = readDirectAuthOperation('LOGOUT');
      const status = logout
        ? await (async () => {
            const committed = await inspectCommittedDirectLogout(logout, version);
            const expiredAndSafeToRelease =
              !committed &&
              logout.expiresAt <= Date.now() &&
              (await releaseExpiredDirectLogout(logout, version));
            return {
              released: committed || expiredAndSafeToRelease,
              message: expiredAndSafeToRelease
                ? '만료된 로그아웃 작업을 확인했어요. 인증 상태를 다시 확인해 주세요.'
                : '로그아웃 상태를 확인했어요. 완료되지 않았다면 같은 작업을 다시 시도해 주세요.',
            };
          })()
        : source
          ? await inspectDirectRecovery(source, version)
          : {
              message:
                '이 인증 요청은 안전하게 복구할 수 없어요. 기존 요청은 다시 전송하지 않아요.',
              released: false,
            };
      if (mounted.current && version === directAuthVersion()) {
        setHasPendingLogout(Boolean(pendingLogoutOperation()));
        const hasActions = await recovery.inspectActions();
        if (!mounted.current || version !== directAuthVersion()) return;
        if (hasActions) setIsLocked(true);
        setMessage(
          hasActions
            ? '인증 요청을 확인했어요. 아래 버튼으로 복구를 진행해 주세요.'
            : status.message,
        );
        if (status.released) {
          setIsLocked(false);
          if (logout?.expiresAt && logout.expiresAt <= Date.now()) options.onRetryAuthRestore?.();
        }
      }
    } catch {
      const hasActions = await recovery.inspectActions();
      if (mounted.current && version === directAuthVersion()) if (hasActions) setIsLocked(true);
      setMessage(
        hasActions
          ? '인증 요청을 확인했어요. 아래 버튼으로 복구를 진행해 주세요.'
          : '로그인 결과를 확인하지 못했어요. 잠시 후 상태를 확인해 주세요.',
      );
    } finally {
      busy.current = false;
      if (mounted.current) setIsPending(false);
    }
  };

  const retryPendingLogout = async () => {
    if (busy.current || recovery.isRecovering) return;
    const operation = pendingLogoutOperation();
    if (!operation) {
      setHasPendingLogout(false);
      return;
    }
    if (operation.expiresAt <= Date.now()) {
      setMessage('로그아웃 작업이 만료됐어요. 상태를 확인해 주세요.');
      return;
    }
    busy.current = true;
    setIsPending(true);
    setIsLocked(true);
    try {
      await performDirectLogout();
      if (!mounted.current) return;
      setHasPendingLogout(Boolean(pendingLogoutOperation()));
      setIsLocked(Boolean(pendingLogoutOperation()));
      setMessage('로그아웃이 완료됐어요. 다시 로그인할 수 있어요.');
    } catch {
      if (mounted.current) {
        setHasPendingLogout(Boolean(pendingLogoutOperation()));
        setIsLocked(true);
        setMessage('로그아웃 결과를 확인하지 못했어요. 같은 작업으로 다시 시도해 주세요.');
      }
    } finally {
      busy.current = false;
      if (mounted.current) setIsPending(false);
    }
  };

  return {
    email,
    password,
    fieldErrors,
    emailInputRef,
    isPasswordVisible,
    setIsPasswordVisible,
    updateEmail: setEmail,
    updatePassword: setPassword,
    handleSubmit,
    checkStatus,
    retryPendingLogout,
    hasPendingLogout,
    canRetryPendingLogout,
    recovery,
    isPending,
    isLocked,
    message,
    isFormValid: Object.keys(validate(email, password)).length === 0,
  };
}
