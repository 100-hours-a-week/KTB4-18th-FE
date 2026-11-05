const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVALID_EMAIL_CHARACTER_PATTERN = /[^\p{Script=Hangul}A-Za-z0-9._+@-]/gu;

export type FieldErrors = {
  email?: string;
  password?: string;
  emailNeedsSignup?: boolean;
};

export const EMAIL_NOT_REGISTERED_ERROR = '가입된 계정이 없는 이메일이에요.';

export function normalizeEmail(value: string) {
  return value.replace(INVALID_EMAIL_CHARACTER_PATTERN, '').toLowerCase();
}

export function hasNonWhitespacePassword(password: string): boolean {
  return password.trim().length > 0;
}

export function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) errors.email = '이메일을 입력해 주세요.';
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = '이메일 형식을 확인해 주세요.';
  if (!hasNonWhitespacePassword(password)) errors.password = '비밀번호를 입력해 주세요.';
  return errors;
}
