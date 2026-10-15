import { QueueRequestError } from '../api/loginQueueErrors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVALID_EMAIL_CHARACTER_PATTERN = /[^\p{Script=Hangul}A-Za-z0-9._+@-]/gu;

export type FieldErrors = {
  email?: string;
  password?: string;
};

export type CapacityWait = {
  reason: 'QUEUE_FULL' | 'RATE_LIMITED' | 'OPERATION_IN_PROGRESS' | 'TRANSPORT' | 'EXHAUSTED';
  mode: 'waiting' | 'paused';
  delayMs: number;
  message: string;
};

export function normalizeEmail(value: string) {
  return value.replace(INVALID_EMAIL_CHARACTER_PATTERN, '').toLowerCase();
}

export function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) errors.email = '이메일을 입력해 주세요.';
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = '이메일 형식을 확인해 주세요.';
  if (password.length === 0) errors.password = '비밀번호를 입력해 주세요.';
  return errors;
}

export function getQueueErrorMessage(error: unknown): string {
  if (!(error instanceof QueueRequestError)) return '잠시 후 다시 시도해 주세요.';
  switch (error.code) {
    case 'QUEUE_FULL':
      return '대기열이 가득 찼어요. 잠시 후 다시 시도해 주세요.';
    case 'RATE_LIMITED':
      return '요청이 많아요. 잠시 후 다시 대기해 주세요.';
    case 'OPERATION_IN_PROGRESS':
      return '대기 요청을 확인하고 있어요. 확인되는 대기 정보가 있으면 이어서 진행할게요.';
    case 'QUEUE_CANCEL_UNCONFIRMED':
      return '취소 결과를 확인하지 못했어요. 다시 확인해 주세요.';
    case 'AUTH_STATE_BUSY':
    case 'AUTH_STATE_UNAVAILABLE':
      return '로그인 대기 상태를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.';
    case 'QUEUE_LOGIN_IN_PROGRESS':
      return '다른 탭에서 로그인을 진행하고 있어요. 이 화면에서 상태를 확인할게요.';
    case 'QUEUE_OPERATION_REPLACED':
    case 'QUEUE_CANCELLED':
      return '다른 탭에서 대기 요청이 변경되었어요. 최신 상태를 확인해 주세요.';
    case 'TICKET_EXPIRED':
    case 'TICKET_UNKNOWN':
      return '대기 정보가 만료되었어요. 로그인 버튼을 다시 눌러 대기를 시작해 주세요.';
    default:
      if (error.status === 401) return '이메일 또는 비밀번호를 확인해 주세요.';
      if (error.status === null)
        return '로그인 결과를 확인할 수 없어요. 다시 전송하지 않고 대기 상태를 확인해 주세요.';
      return '로그인 대기 요청에 실패했어요. 잠시 후 다시 시도해 주세요.';
  }
}

export function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
