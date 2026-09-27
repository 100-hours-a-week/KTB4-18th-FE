import { describe, expect, it } from 'vitest';

import { validateProfileFields } from './profileValidation';

describe('validateProfileFields', () => {
  it('applies signup nickname length and character rules', () => {
    expect(validateProfileFields('가', '', 2026).nickname).toBe(
      '닉네임은 2자 이상 12자 이하로 입력해 주세요.',
    );
    expect(validateProfileFields('사용자1234567890', '', 2026).nickname).toBe(
      '닉네임은 2자 이상 12자 이하로 입력해 주세요.',
    );
    expect(validateProfileFields('사용자!', '', 2026).nickname).toBe(
      '한글, 영문, 숫자만 사용할 수 있어요.',
    );
    expect(validateProfileFields('사용자12', '', 2026).nickname).toBe('');
  });

  it('allows an omitted birth year and the signup year range only', () => {
    expect(validateProfileFields('사용자', '', 2026).birthYear).toBe('');
    expect(validateProfileFields('사용자', '1900', 2026).birthYear).toBe('');
    expect(validateProfileFields('사용자', '2026', 2026).birthYear).toBe('');
    expect(validateProfileFields('사용자', '1899', 2026).birthYear).toBe(
      '출생연도는 1900년부터 2026년 사이로 입력해 주세요.',
    );
    expect(validateProfileFields('사용자', '2027', 2026).birthYear).toBe(
      '출생연도는 1900년부터 2026년 사이로 입력해 주세요.',
    );
  });
});
