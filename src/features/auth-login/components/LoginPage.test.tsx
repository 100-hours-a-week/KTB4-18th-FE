import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { LoginPage } from './LoginPage';

describe('LoginPage email input', () => {
  afterEach(() => cleanup());

  it('removes Korean characters while preserving ASCII email characters', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const emailInput = screen.getByLabelText('이메일');
    await user.type(emailInput, '한글User+tag@Example.com');

    expect(emailInput).toHaveValue('user+tag@example.com');
  });

  it('enables the login button only after the email and password are valid', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const loginButton = screen.getByRole('button', { name: '로그인' });
    expect(loginButton).toBeDisabled();

    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'password');

    expect(loginButton).toBeEnabled();
  });
});
