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
