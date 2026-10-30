import { ActionButton, ContentDialog } from '@seed-design/react';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { withdrawMyAccount } from '../../api/mypageApi';
import { message } from './useMyPageOverview';

export function WithdrawalDialog({
  open,
  setOpen,
  onWithdrawn,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  onWithdrawn: () => void | Promise<void>;
}) {
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  function change(opened: boolean) {
    setOpen(opened);
  }
  function changePasswordDialog(opened: boolean) {
    setPasswordDialogOpen(opened);
    if (!opened) {
      setPassword('');
      setNotice('');
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setNotice('');
    try {
      await withdrawMyAccount(password);
      setPassword('');
      setPasswordDialogOpen(false);
      await onWithdrawn();
    } catch (error) {
      setNotice(message(error, '회원 탈퇴를 처리하지 못했어요.'));
    } finally {
      setPassword('');
      setSubmitting(false);
    }
  }
  return (
    <>
      <ContentDialog.Root open={open} onOpenChange={change}>
        <ContentDialog.Backdrop className="mypage-withdrawal-backdrop" />
        <ContentDialog.Positioner>
          <ContentDialog.Content className="mypage-withdrawal-dialog">
            <div className="mypage-withdrawal-warning-content">
              <div className="mypage-withdrawal-icon" aria-hidden="true">
                <svg viewBox="0 0 100 100" focusable="false">
                  <circle cx="50" cy="50" r="42" />
                  <circle className="mypage-info-dot" cx="50" cy="31" r="4" />
                  <path d="M50 44v24" />
                </svg>
              </div>
              <ContentDialog.Header className="mypage-withdrawal-header">
                <ContentDialog.Title className="mypage-withdrawal-title">
                  회원 탈퇴하시겠습니까?
                </ContentDialog.Title>
                <ContentDialog.Description className="mypage-withdrawal-description">
                  지도에 남긴 기록과 추천이 모두 삭제되며 복구할 수 없습니다.
                </ContentDialog.Description>
                <ContentDialog.CloseButton
                  className="mypage-visually-hidden"
                  aria-label="회원 탈퇴 닫기"
                >
                  닫기
                </ContentDialog.CloseButton>
              </ContentDialog.Header>
            </div>
            <ContentDialog.Footer className="mypage-withdrawal-actions">
              <button
                className="mypage-withdrawal-cancel"
                type="button"
                onClick={() => change(false)}
              >
                취소
              </button>
              <ActionButton
                className="mypage-withdrawal-confirm"
                type="button"
                variant="brandSolid"
                size="medium"
                onClick={() => {
                  setPassword('');
                  setNotice('');
                  change(false);
                  setPasswordDialogOpen(true);
                }}
              >
                탈퇴
              </ActionButton>
            </ContentDialog.Footer>
          </ContentDialog.Content>
        </ContentDialog.Positioner>
      </ContentDialog.Root>

      <ContentDialog.Root open={passwordDialogOpen} onOpenChange={changePasswordDialog}>
        <ContentDialog.Backdrop className="mypage-withdrawal-backdrop" />
        <ContentDialog.Positioner>
          <ContentDialog.Content className="mypage-withdrawal-dialog mypage-withdrawal-password-dialog">
            <ContentDialog.Header className="mypage-withdrawal-header">
              <ContentDialog.Title className="mypage-withdrawal-title">
                현재 비밀번호를 입력해주세요
              </ContentDialog.Title>
              <ContentDialog.Description className="mypage-withdrawal-description">
                본인 확인을 위해 현재 비밀번호가 필요합니다.
              </ContentDialog.Description>
              <ContentDialog.CloseButton
                className="mypage-visually-hidden"
                aria-label="비밀번호 입력 닫기"
              >
                닫기
              </ContentDialog.CloseButton>
            </ContentDialog.Header>
            <form className="mypage-withdrawal-password-form" onSubmit={submit}>
              <label className="mypage-withdrawal-password-label">
                현재 비밀번호
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus
                />
              </label>
              {notice && (
                <p className="mypage-notice" role="alert">
                  {notice}
                </p>
              )}
              <ContentDialog.Footer className="mypage-withdrawal-actions">
                <button
                  className="mypage-withdrawal-cancel"
                  type="button"
                  onClick={() => changePasswordDialog(false)}
                >
                  취소
                </button>
                <ActionButton
                  className="mypage-withdrawal-confirm"
                  type="submit"
                  variant="brandSolid"
                  size="medium"
                  loading={submitting}
                  disabled={!password}
                >
                  탈퇴하기
                </ActionButton>
              </ContentDialog.Footer>
            </form>
          </ContentDialog.Content>
        </ContentDialog.Positioner>
      </ContentDialog.Root>
    </>
  );
}
