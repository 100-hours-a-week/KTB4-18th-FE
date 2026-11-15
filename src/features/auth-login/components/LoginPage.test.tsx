import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LoginPage } from './LoginPage';

afterEach(cleanup);

describe('direct login page', () => {
  it('renders the direct login form without queue UI', () => {
    render(<LoginPage />);

    expect(screen.getByLabelText('이메일')).toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '로그인' })).toBeInTheDocument();
    expect(screen.queryByText(/대기열|접속 대기/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /상태 확인|세션 복구|인증 상태 다시 준비|로그아웃 다시 시도/,
      }),
    ).not.toBeInTheDocument();
  });
});
