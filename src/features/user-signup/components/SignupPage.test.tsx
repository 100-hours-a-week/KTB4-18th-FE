import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signup } from '../api/signupApi';
import { getCurrentTerms, TermType } from '../api/termsApi';
import { checkUserAvailability } from '../api/userAvailabilityApi';
import { SignupPage } from './SignupPage';

vi.mock('../api/signupApi', () => ({ signup: vi.fn() }));
vi.mock('../api/userAvailabilityApi', () => ({ checkUserAvailability: vi.fn() }));
vi.mock('../api/termsApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/termsApi')>();
  return { ...original, getCurrentTerms: vi.fn(), getTermDetail: vi.fn() };
});

function nicknameInput() {
  return screen.getByLabelText(/닉네임/);
}

async function prepareForm(nickname = '한글Ab12') {
  render(<SignupPage />);
  await waitFor(() => expect(screen.getByLabelText('전체선택')).toBeEnabled());
  fireEvent.change(nicknameInput(), { target: { value: nickname } });
  fireEvent.change(screen.getByLabelText(/이메일/), { target: { value: 'qa@example.com' } });
  fireEvent.change(screen.getByLabelText(/^비밀번호/, { selector: 'input' }), {
    target: { value: 'Password1!' },
  });
  fireEvent.click(screen.getByLabelText('전체선택'));
}

describe('SignupPage nickname policy', () => {
  beforeEach(() => {
    vi.mocked(getCurrentTerms).mockResolvedValue(
      Object.values(TermType).map((type, index) => ({
        terms_id: index + 1,
        type,
        title: type,
        version: '1.0',
        is_required: true,
        effective_at: '2026-01-01T00:00:00Z',
      })),
    );
    vi.mocked(signup).mockResolvedValue({ message: 'register success', data: { user_id: 1 } });
    vi.mocked(checkUserAvailability).mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('preserves Korean syllables, English case and numbers through composition', async () => {
    await prepareForm();
    expect(nicknameInput()).toHaveValue('한글Ab12');
    fireEvent.blur(nicknameInput());
    fireEvent.compositionStart(nicknameInput());
    fireEvent.input(nicknameInput(), { target: { value: 'ㅎ' }, isComposing: true });
    expect(nicknameInput()).toHaveValue('ㅎ');
    expect(nicknameInput()).toHaveAttribute('aria-invalid', 'false');
    fireEvent.input(nicknameInput(), { target: { value: '한글Ab12' }, isComposing: true });
    fireEvent.compositionEnd(nicknameInput(), { data: '한글Ab12' });
    expect(nicknameInput()).toHaveValue('한글Ab12');
    expect(screen.getByRole('button', { name: '회원가입' })).toBeEnabled();
  });

  it('trims outer whitespace on blur and sends the normalized nickname', async () => {
    await prepareForm('  한글Ab12  ');
    fireEvent.blur(nicknameInput());
    expect(nicknameInput()).toHaveValue('한글Ab12');
    fireEvent.click(screen.getByRole('button', { name: '회원가입' }));
    await waitFor(() =>
      expect(signup).toHaveBeenCalledWith(expect.objectContaining({ nickname: '한글Ab12' })),
    );
  });

  it('trims the outgoing nickname even when the field has not blurred', async () => {
    await prepareForm('  한글Ab12  ');
    const nickname = nicknameInput();
    expect(nickname).toHaveValue('  한글Ab12  ');
    fireEvent.submit(nickname.closest('form')!);
    await waitFor(() =>
      expect(signup).toHaveBeenCalledWith(expect.objectContaining({ nickname: '한글Ab12' })),
    );
  });

  it.each([
    ['nickname', '  한글Ab12  ', '한글Ab12'],
    ['email', ' QA@EXAMPLE.COM ', 'qa@example.com'],
  ] as const)(
    'checks %s availability on blur with the canonical value',
    async (field, inputValue, expected) => {
      await prepareForm();
      const input = screen.getByLabelText(field === 'nickname' ? /닉네임/ : /이메일/);
      fireEvent.change(input, { target: { value: inputValue } });
      fireEvent.blur(input);

      await waitFor(() => expect(checkUserAvailability).toHaveBeenCalledWith(field, expected));
      expect(input).toHaveValue(expected);
    },
  );

  it.each([
    ['nickname', '닉네임을 입력해 주세요.'],
    ['email', '이메일을 입력해 주세요.'],
  ] as const)('does not check invalid %s values', async (field, inputValue) => {
    await prepareForm();
    const input = screen.getByLabelText(field === 'nickname' ? /닉네임/ : /이메일/);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(checkUserAvailability).not.toHaveBeenCalled();
    expect(screen.getByText(inputValue)).toBeVisible();
  });

  it.each([
    ['nickname', '이미 사용 중인 닉네임이에요.'],
    ['email', '이미 가입된 이메일이에요.'],
  ] as const)('shows the %s availability result below that field', async (field, helper) => {
    vi.mocked(checkUserAvailability).mockResolvedValueOnce(false);
    await prepareForm();
    const input = screen.getByLabelText(field === 'nickname' ? /닉네임/ : /이메일/);
    fireEvent.blur(input);

    expect(await screen.findByText(helper)).toBeVisible();
    expect(input).toHaveAttribute('aria-describedby', `${field}-error`);
    expect(input.closest('.signup-input-wrap')).toHaveClass('has-error');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores an availability result after the user changes the field value', async () => {
    let resolveAvailability: (available: boolean) => void = () => {};
    vi.mocked(checkUserAvailability).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAvailability = resolve;
        }),
    );
    await prepareForm();
    fireEvent.blur(nicknameInput());
    fireEvent.change(nicknameInput(), { target: { value: '새닉네임' } });

    await act(async () => resolveAvailability(false));

    expect(screen.queryByText('이미 사용 중인 닉네임이에요.')).not.toBeInTheDocument();
    expect(nicknameInput()).toHaveValue('새닉네임');
  });

  it('keeps a final signup duplicate error when an older availability result resolves later', async () => {
    let resolveAvailability: (available: boolean) => void = () => {};
    vi.mocked(checkUserAvailability).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAvailability = resolve;
        }),
    );
    vi.mocked(signup).mockRejectedValueOnce(new Error('nickname already exists'));
    await prepareForm();
    fireEvent.blur(nicknameInput());
    fireEvent.click(screen.getByRole('button', { name: '회원가입' }));
    expect(await screen.findByText('이미 사용 중인 닉네임이에요.')).toBeVisible();

    await act(async () => resolveAvailability(true));

    expect(screen.getByText('이미 사용 중인 닉네임이에요.')).toBeVisible();
  });

  it('shows a retryable helper when an availability request fails', async () => {
    vi.mocked(checkUserAvailability).mockRejectedValueOnce(new Error('availability unavailable'));
    await prepareForm();
    fireEvent.blur(nicknameInput());

    expect(
      await screen.findByText('중복 여부를 확인하지 못했어요. 다시 확인해 주세요.'),
    ).toBeVisible();
    vi.mocked(checkUserAvailability).mockResolvedValueOnce(false);
    fireEvent.blur(nicknameInput());
    expect(await screen.findByText('이미 사용 중인 닉네임이에요.')).toBeVisible();
  });

  it('shows a retry hint when the availability API rate limit is reached', async () => {
    vi.mocked(checkUserAvailability).mockRejectedValueOnce(new Error('too many requests'));
    await prepareForm();
    fireEvent.blur(nicknameInput());

    expect(await screen.findByText('요청이 많아 잠시 후 다시 확인해 주세요.')).toBeVisible();
  });

  it.each(['가', '가'.repeat(13), '한 글', '한\t글', '한글!', '한글🙂', 'ㄱㄴ', '   '])(
    'rejects invalid nickname %j without silently replacing it',
    async (value) => {
      await prepareForm(value);
      expect(nicknameInput()).toHaveValue(value);
      expect(nicknameInput()).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('button', { name: '회원가입' })).toBeDisabled();
      expect(signup).not.toHaveBeenCalled();
    },
  );

  it.each(['가나', '한글AB12345678', '  가나  '])(
    'allows normalized 2 to 12 characters: %j',
    async (value) => {
      await prepareForm(value);
      expect(screen.getByRole('button', { name: '회원가입' })).toBeEnabled();
    },
  );

  it('shows the server duplicate nickname error and retains the entered values', async () => {
    vi.mocked(signup).mockRejectedValueOnce(new Error('nickname already exists'));
    await prepareForm();
    fireEvent.click(screen.getByRole('button', { name: '회원가입' }));
    expect(await screen.findByText('이미 사용 중인 닉네임이에요.')).toBeVisible();
    expect(nicknameInput()).toHaveValue('한글Ab12');
    expect(screen.getByLabelText(/^비밀번호/, { selector: 'input' })).toHaveValue('Password1!');
    fireEvent.change(nicknameInput(), { target: { value: '새닉네임' } });
    expect(screen.queryByText('이미 사용 중인 닉네임이에요.')).not.toBeInTheDocument();
  });

  it.each([
    [
      'nickname',
      'nickname already exists',
      '이미 사용 중인 닉네임이에요.',
      '한글Ab12',
      '  한글Ab12  ',
      '새닉네임',
    ],
    [
      'email',
      'email already exists',
      '이미 가입된 이메일이에요.',
      'qa@example.com',
      ' QA@EXAMPLE.COM ',
      'new@example.com',
    ],
  ])(
    'keeps the %s duplicate helper until a different normalized value is entered',
    async (field, serverMessage, helper, value, equivalent, replacement) => {
      vi.mocked(signup).mockRejectedValueOnce(new Error(serverMessage));
      await prepareForm();
      const input = screen.getByLabelText(field === 'nickname' ? /닉네임/ : /이메일/);
      const button = screen.getByRole('button', { name: '회원가입' });
      fireEvent.click(button);
      expect(await screen.findByText(helper)).toBeVisible();
      expect(input).toHaveValue(value);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAttribute('aria-describedby', `${field}-error`);
      expect(document.getElementById(`${field}-error`)).toHaveTextContent(helper);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      fireEvent.blur(input);
      expect(screen.getByText(helper)).toBeVisible();
      fireEvent.change(input, { target: { value: equivalent } });
      fireEvent.blur(input);
      expect(screen.getByText(helper)).toBeVisible();
      fireEvent.change(screen.getByLabelText(/^비밀번호/, { selector: 'input' }), {
        target: { value: 'Other123!' },
      });
      expect(screen.getByText(helper)).toBeVisible();
      expect(button).toBeDisabled();
      fireEvent.submit(input.closest('form')!);
      expect(signup).toHaveBeenCalledTimes(1);
      fireEvent.change(input, { target: { value: replacement } });
      expect(screen.queryByText(helper)).not.toBeInTheDocument();
      expect(input).toHaveAttribute('aria-invalid', 'false');
      expect(input).not.toHaveAttribute('aria-describedby');
      expect(button).toBeEnabled();
      fireEvent.click(button);
      await waitFor(() => expect(signup).toHaveBeenCalledTimes(2));
      expect(signup).toHaveBeenLastCalledWith(
        expect.objectContaining({ [field]: replacement, password: 'Other123!' }),
      );
      expect(await screen.findByText(/회원가입이 완료되었어요/)).toBeVisible();
    },
  );

  it.each([
    [
      'nickname',
      'nickname already exists',
      '이미 사용 중인 닉네임이에요.',
      '한 글',
      '한글, 영문, 숫자만 사용할 수 있어요.',
    ],
    [
      'email',
      'email already exists',
      '이미 가입된 이메일이에요.',
      'invalid',
      '올바른 이메일 형식으로 입력해 주세요.',
    ],
  ])(
    'shows local validation when the duplicate %s is edited to an invalid value',
    async (field, serverMessage, helper, value, localError) => {
      vi.mocked(signup).mockRejectedValueOnce(new Error(serverMessage));
      await prepareForm();
      fireEvent.click(screen.getByRole('button', { name: '회원가입' }));
      expect(await screen.findByText(helper)).toBeVisible();
      const input = screen.getByLabelText(field === 'nickname' ? /닉네임/ : /이메일/);
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
      expect(screen.queryByText(helper)).not.toBeInTheDocument();
      expect(screen.getByText(localError)).toBeVisible();
      expect(screen.getByRole('button', { name: '회원가입' })).toBeDisabled();
      expect(signup).toHaveBeenCalledTimes(1);
    },
  );

  it('disables the form while pending and preserves values after a request failure', async () => {
    let rejectRequest: (error: Error) => void = () => {};
    vi.mocked(signup).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    );
    await prepareForm();
    fireEvent.click(screen.getByRole('button', { name: '회원가입' }));
    expect(nicknameInput()).toBeDisabled();
    expect(screen.getByRole('button', { name: '회원가입' })).toBeDisabled();
    await act(async () => rejectRequest(new Error('internal server error')));
    expect(await screen.findByRole('alert')).toHaveTextContent('회원가입을 완료하지 못했어요.');
    expect(nicknameInput()).toHaveValue('한글Ab12');
    expect(nicknameInput()).toBeEnabled();
  });
});
