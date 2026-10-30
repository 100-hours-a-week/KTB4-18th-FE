import { useState } from 'react';

import { updateMySettings, type UserSettings } from '../../api/mypageApi';
import { MyPageHeader } from './MyPageHeader';
import { message } from './useMyPageOverview';

export function SettingsPage({
  settings,
  reload,
  back,
}: {
  settings: UserSettings;
  reload: () => void;
  back: () => void;
}) {
  const [value, setValue] = useState(settings);
  const [notice, setNotice] = useState('');
  async function save(next: UserSettings) {
    const previous = value;
    setValue(next);
    setNotice('');
    try {
      await updateMySettings(next);
      reload();
    } catch (error) {
      setValue(previous);
      setNotice(message(error, '설정을 저장하지 못했어요.'));
    }
  }
  return (
    <>
      <MyPageHeader title="설정" onBack={back} />
      <section className="mypage-page-content">
        <h2>개인 설정</h2>
        <label className="mypage-switch-row">
          <span>
            <strong>지도 공개</strong>
            <small>내 음악 지도를 다른 사용자에게 보여줘요.</small>
          </span>
          <input
            type="checkbox"
            checked={value.map_visibility === 'PUBLIC'}
            onChange={(event) =>
              void save({ ...value, map_visibility: event.target.checked ? 'PUBLIC' : 'PRIVATE' })
            }
          />
        </label>
        <label className="mypage-switch-row">
          <span>
            <strong>미기록 도트 추천</strong>
            <small>아직 기록하지 않은 장소의 음악을 추천해요.</small>
          </span>
          <input
            type="checkbox"
            checked={value.is_unrecorded_dot_recommendation_enabled}
            onChange={(event) =>
              void save({
                ...value,
                is_unrecorded_dot_recommendation_enabled: event.target.checked,
              })
            }
          />
        </label>
        {notice && (
          <p className="mypage-notice" role="alert">
            {notice}
          </p>
        )}
      </section>
    </>
  );
}
