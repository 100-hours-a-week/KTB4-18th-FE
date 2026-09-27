const MIN_NICKNAME_LENGTH = 2;
const MAX_NICKNAME_LENGTH = 12;
const MIN_BIRTH_YEAR = 1900;
const NICKNAME_PATTERN = /^[가-힣A-Za-z0-9]+$/;

export type ProfileValidationErrors = {
  nickname: string;
  birthYear: string;
};

export function validateProfileFields(
  nickname: string,
  birthYear: string,
  currentYear = new Date().getFullYear(),
): ProfileValidationErrors {
  let nicknameError = '';
  if (nickname.trim() === '') {
    nicknameError = '닉네임을 입력해 주세요.';
  } else if (nickname.length < MIN_NICKNAME_LENGTH || nickname.length > MAX_NICKNAME_LENGTH) {
    nicknameError = '닉네임은 2자 이상 12자 이하로 입력해 주세요.';
  } else if (!NICKNAME_PATTERN.test(nickname)) {
    nicknameError = '한글, 영문, 숫자만 사용할 수 있어요.';
  }

  let birthYearError = '';
  if (birthYear !== '') {
    const year = Number(birthYear);
    if (!Number.isInteger(year) || year < MIN_BIRTH_YEAR || year > currentYear) {
      birthYearError = `출생연도는 ${MIN_BIRTH_YEAR}년부터 ${currentYear}년 사이로 입력해 주세요.`;
    }
  }

  return { nickname: nicknameError, birthYear: birthYearError };
}
