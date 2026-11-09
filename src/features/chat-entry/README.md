# 지역 실시간 텍스트 채팅 (#133, #134)

- `/chat` 진입 시 현재 시군구 자동 입장, 방 topic과 개인 이벤트 queue의 구독 receipt가 모두 확인된 후 입력 활성화.
- `chatMessages.ts`의 런타임 검증을 거쳐 `chatParticipation.ts`에서 현재 방/참여의 이벤트만 반영.
- ACK와 broadcast는 순서와 관계없이 `messageId`로 중복 제거. 개인 ACK로 해당 UUID의 전송 상태를 확정. 새 전송은 새 UUID, ACK 미확인 메시지의 명시적 재전송은 기존 UUID/본문 유지.
- 서버의 길이·빈도·반복·URL·개인정보 차단 결과를 안내. 욕설·음란성 제재 시 종료 시각 표시, 입력/자동 재연결 중지. FE는 탐지 목록으로 자체 제재하지 않음.
- trim 후 1~300 Unicode code points. Enter 전송, Shift+Enter 줄바꿈, 한글 조합 Enter 보호. 본문은 React text로 렌더링.
- 실제 퇴장·방 이동·새 입장에서는 목록·대기 항목·타이머·작성 중 본문 초기화. 이전 참여의 지연 이벤트 무시. 일시 단절 시 기존 참여의 상태 유지. 연결이 복구된 동안 메시지 재생 기능은 후속 이슈 범위.
- 본문·개인정보·토큰 로그 없음. 기본 화면은 기존 스타일을 사용하며 입력창·버튼은 모바일 폭 안에 배치.

서버 이벤트 계약과 승인한 초기 탐지 기준: BE 저장소 `api/chat-messaging.md`, `api/chat-moderation-policy.md`. 공동 재생·비텍스트·이전 내역 조회는 이 작업에서 제외.

검증: 이벤트 파싱 오류, ACK/broadcast 역순, 기존 UUID 재전송, 퇴장 뒤 늦은 이벤트, 연결 전 전송 방지, 개인정보 차단 안내, 제재 종료 시각/재연결 중단, 안전한 텍스트 표시와 키보드/한글 조합 입력. 전체 format:check, lint, test, build 실행.

## P1 9단계 최신 연결·복구 기준 (2026-10-27)

앞선 범위 설명은 당시 이력이다. 현재는 같은 membership/view의 재연결 후 receipt·READY·recovery·계정 history를 마쳐 전송한다.
1013/503 일시 장애는 로그인을 삭제하지 않고, 종료된 탭/sid는 자동 새 입장하지 않는다.
ACK 유실 UUID는 서버 이력으로도 확정하며,500개 버퍼/30초 복구 상한 초과는 명시적 재시도로 처리한다.
자세한 판단 근거·프록시 설정·실제 두 Task 검증은 루트 README의 P1 9단계 절을 따른다.

## 공동 재생 7단계 (2026-11-09)

`music/`에서 `/신청` 검색·페이지·현재 곡·대기열·활성 참여자의 대기 곡 취소를 제공한다.
`VITE_CHAT_MUSIC_QUEUE_ENABLED=false` 기본값이며 BE 음악 큐/재생/전파 준비 후 활성화한다.
API는 계정/sid/member/view에 고정하고 재연결 이전 결과를 버린다. 결과 미확정 명령은 같은 UUID로만
명시적으로 확인하며 자동 재전송하지 않는다. 같은 version의 음악 이벤트는 허용하고 더 높은 version에서
목록을 합쳐 재조회한다. 8단계 플레이어/재생 제어/개인 음량과 9단계 추가 복구는 후속이다.
설정·구조·재현 명령·실제 두 Task 통합과 합성 HTTP 브라우저 검증의 구분·기존 실패는 루트 README의 7단계를 따른다.

## 공동 재생 8단계 (2026-11-09)

`music/ChatMusicPlayerView`와 `chatMusicPlayer.ts`가 공식 YouTube 플레이어를 서버 snapshot에 맞춰 제어한다.
기존 큐 UI와 PLAYER 플래그를 모두 켜야 하며 기본값은 false다. 공통 명령의 버전/현재 곡·원 UUID는 큐 저장소를 공유한다.
같은 version의 최신 SYNC를 반영하며 2초 초과 위치 차이는 최소5초 간격으로 보정한다. PAUSED·클라이언트 ENDED는 서버 상태를 임의 변경하지 않는다.
개인 음량/음소거·브라우저 자동재생 허용은 서버 명령을 보내지 않는다. 연결 상실/퇴장에는 iframe을 정리한다.
설정·시각 계산·범위/한계·실제 Core/두 Chat 및 YouTube smoke check는 루트 README의8단계를 따른다.
