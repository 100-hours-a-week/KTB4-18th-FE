# 지역 채팅 재연결 복구

[FE #136](https://github.com/100-hours-a-week/KTB4-18th-FE/issues/136).
서버 계약은 BE의 `api/chat-message-query.openapi.yaml`과 `api/chat-message-recovery.md`를 따른다.

## 동작

- 같은 참여에서 서버 발급 view UUID와 실제 표시한 마지막 message_id를 연결 클로저에 유지한다.
  다른 탭·기기와 공유하거나 새 참여에 이전 값을 재사용하지 않는다. 이전 대화 로컬 캐시는 FE #140 범위다.
- 재연결 시 CONNECT에 view_session_id·last_message_id를 전달한다. 방과 개인 이벤트 receipt 및
  CHAT_READY를 모두 받은 뒤 recovery_cursor로 모든 페이지를 요청한다.
- 복구 중 MESSAGE·ACK는 보관한다. 전체 페이지의 snapshot 일치와 응답을 검증한 후 서버 ID로 정렬하고
  현재 대화·live 버퍼와 중복 제거한다. 본인 저장 메시지는 유실 ACK의 전송 대기도 정리한다.
- 입력은 LIVE(ready)에서만 활성화한다. 부재·24시간 보관 만료 안내는 서버 gaps를 사용하며
  클라이언트 시각으로 숨겨진 범위를 계산하거나 다른 API로 채우지 않는다.
- 복구 실패 안내와 다시 시도 버튼은 같은 문맥으로 연결을 재시도한다. 자동 REST 새 입장은 하지 않는다.
  서버가 만료·퇴장 문맥을 거부하면 과거 조회로 우회하지 않는다.
- 단절·퇴장·지역 전환·제재 시 요청을 abort하고 연결 세대로 늦은 응답과 버퍼를 폐기한다.
  서버 제재·인증 오류는 기존 종료 경로를 따른다. 상태·공백 안내에 role=status를 유지한다.

## 검증

- 단위/컴포넌트: receipt만 수신·READY 범위 오류, 여러 페이지·live 중첩,
  동일 view 재연결·30초 초과, snapshot 변경·cursor 반복/오류,
  늦은 응답·단절/퇴장·수동 재시도·제재, 저장 메시지의 유실 ACK 정리,
  복구 실패 버튼·보관/부재 안내·입력 차단.
- 실제 연동: BE 테스트에서 CHAT_RECOVERY_FE_DIR에 이 저장소 절대 경로를 지정하면
  합성 사용자/방과 실제 MySQL9.7.0·HTTP·WebSocket을 사용해 이 저장소의
  chatRecovery.integration.test.ts를 실행한다. 재연결 누락과 live 중첩·퇴장 중 응답을 확인한다.
  운영 인증/데이터 없이 실행하며 이 환경변수가 없으면 연동1건은 제외한다.
- 실제 브라우저에서 장기 단절·제재·지역 이동을 조작하는 수동 QA는 이번 자동화 결과와 구분한다.

## 적용 순서

BE #143의 DB 기록과 BE #145의 CHAT_READY·조회 API가 먼저 적용되어야 한다.
이 FE를 구버전 BE와 조합하면 복구를 완료하지 못하므로 FE 롤백도 함께 진행한다.
이번 작업은 API 계약을 로컬 문서로 기록하며 외부 원본 문서를 직접 변경하지 않는다.

### 2026-10-13 실행 결과

- format:check·ESLint·Vitest446개·TypeScript/Vite build 통과. 실제 서버가 없는 일반 실행의 연동1건은 제외.
- BE 전체 검증 중 실제 MySQL/HTTP/WebSocket 연동1건 별도 통과.
  짧은 단절 누락, 복구 중 live 버퍼 병합, 입력 차단, 퇴장 후 지연 응답 폐기를 확인했다.
- 최초 jsdom Event/Node WebSocket 충돌은 연동 파일을 node 환경으로 실행하도록 수정했다.
  DOM 테스트 공통 설정은 node 실행에서도 안전하게 건너뛰도록 변경했다.
- 기존 번들500kB 경고는 남아 있다. 실제 브라우저 수동 QA·운영 배포는 실행하지 않았다.
