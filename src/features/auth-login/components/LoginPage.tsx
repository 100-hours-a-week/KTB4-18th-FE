import type { LoginSuccessResponse } from '../api/loginTypes';
import { isDirectAuthEnabled } from '../api/authProtocolMode';
import { DirectLoginPage } from './DirectLoginPage';

export type LoginPageProps = {
  authCapabilityMessage?: string;
  authRestoreError?: string;
  onRetryAuthRestore?: () => void;
  onLoginSuccess?: (response: LoginSuccessResponse) => void;
  onLoginStart?: () => void;
  onLoginFailure?: () => void;
  passwordChangedNotice?: boolean;
  onPasswordChangedNoticeDismiss?: () => void;
};

export function LoginPage(props: LoginPageProps) {
  const directEnabled = isDirectAuthEnabled();
  return (
    <DirectLoginPage
      authCapabilityMessage={
        directEnabled
          ? props.authCapabilityMessage
          : '현재 로그인 기능을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.'
      }
      authRestoreError={props.authRestoreError}
      onRetryAuthRestore={props.onRetryAuthRestore}
      onLoginStart={props.onLoginStart}
      onLoginFailure={props.onLoginFailure}
      onLoginSuccess={props.onLoginSuccess}
      passwordChangedNotice={props.passwordChangedNotice}
      onPasswordChangedNoticeDismiss={props.onPasswordChangedNoticeDismiss}
      protocolEnabled={directEnabled}
    />
  );
}
