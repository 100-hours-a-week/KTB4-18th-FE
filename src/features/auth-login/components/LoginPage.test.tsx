import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { login, LoginRequestError, type LoginSuccessResponse } from '../api/loginApi';
import { LoginPage } from './LoginPage';

vi.mock('../api/loginApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/loginApi')>()),
  login: vi.fn(),
}));

const successResponse: LoginSuccessResponse = {
  message: 'login success',
  data: { access_token: 'test-token', expires_in: 3600 },
};

beforeEach(() => {
  vi.mocked(login).mockReset().mockResolvedValue(successResponse);
});
afterEach(() => cleanup());

describe('LoginPage email input', () => {
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
    expect(login).toHaveBeenCalledExactlyOnceWith({
      email: 'user@한글.com',
      password: 'password',
    });
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
    expect(login).toHaveBeenCalledExactlyOnceWith({
      email: 'user@한글.com',
      password: 'password',
    });
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
    expect(login).not.toHaveBeenCalled();
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
    expect(login).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    expect(login).toHaveBeenCalledExactlyOnceWith({
      email: longEmail.toLowerCase(),
      password: 'password',
    });
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
    expect(login).not.toHaveBeenCalled();
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
    expect(login).toHaveBeenCalledExactlyOnceWith({
      email: 'abc@example.com',
      password: ' PaSs한글! ',
    });
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
    expect(login).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('이메일 형식을 확인해 주세요.');
    await user.clear(screen.getByLabelText('이메일'));
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    expect(loginButton).toBeEnabled();
  });

  it('keeps normalized ASCII input and the existing authentication error on login failure', async () => {
    vi.mocked(login).mockRejectedValueOnce(new LoginRequestError(401));
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText('이메일'), 'abc@Example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이메일 또는 비밀번호를 확인해 주세요.',
    );
    expect(screen.getByLabelText('이메일')).toHaveValue('abc@example.com');
    expect(screen.getByLabelText('비밀번호')).toHaveValue('password');
    expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled();
  });

  it('blocks duplicate submits while the login request is pending', async () => {
    let finishLogin!: (response: LoginSuccessResponse) => void;
    vi.mocked(login).mockImplementationOnce(
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
    expect(login).toHaveBeenCalledTimes(1);
    await act(async () => finishLogin(successResponse));
    expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled();
  });
});
