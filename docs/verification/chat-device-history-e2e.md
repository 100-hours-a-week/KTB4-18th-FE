# F7 다중 기기 대화 복원 E2E 검증

## 실행

```sh
npm run verify:chat:device-e2e
npm run verify:chat:tab-types
```

Docker, JDK 25, 설치된 Chrome이 필요하다. 기본 백엔드 경로는 ../meomuneum-backend이고 CHAT_E2E_BACKEND_DIR로 지정할 수 있다. 별도 실행한 서버가 아닌 기존 BE chatProcessTest의 선택 브라우저 fixture를 이용한다. CHAT_E2E_BROWSER_CHANNEL=bundled이면 설치된 Playwright Chromium을 사용한다.

기존 F4는 npm run verify:chat:tab-e2e로 실행한다. 두 명령은 동일 fixture와 5175 포트를 사용하므로 동시에 실행하지 않는다. 기존 fixture가 있으면 실행을 거절한다.

## 검증 구성

- 격리 MySQL 9.7.0·실제 Spring child JVM에 HTTP·STOMP로 연결한다.
- 브라우저 컨텍스트마다 쿠키·localStorage·sessionStorage가 독립적이다. 채팅 진입 전에 대화 캐시가 비어 있는지 확인한다.
- Node runner가 해당 테스트 서버 전용 키로 같은 sub·서로 다른 sid의 합성 JWT를 발급한다. runner의 actor별 토큰 매핑은 실행 중 메모리에만 유지한다. 기존 임시 fixture는 종료 시 BE가 삭제한다.
- 실제 ChatEntryPage·Hook·API·캐시·연결 서비스를 사용한다. 검증용 화면 이동 버튼으로 실제 navigate/unmount를 호출한다.
- Chrome 데스크톱 1280×900과 모바일 viewport 390×844 각각에서 동일 시나리오를 실행한다. 새 컨텍스트에도 해당 viewport·touch·isMobile 옵션을 적용한다.
- 메시지 전송은 서버의 계정별 전송 간격을 지킨다. 자동 재시도는 0회다.

## 시나리오

| 시나리오                  | 확인 내용                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 빈 캐시의 새 기기         | 같은 계정·다른 sid·다른 membership/view, 서버의 과거 대화 복원, 방 인원 1명, 다른 계정의 과거 이력 제외                      |
| 기기별 퇴장과 계정 부재   | 한 기기가 없을 때 다른 기기가 참여한 대화는 복원, 모든 기기 퇴장 후 발생한 대화는 제외, 새로운 sid에서도 이전 참여 이력 유지 |
| 짧은 단절                 | 다른 기기는 송수신 유지, 실제 CONNECT의 기존 view 재사용, 누락 메시지 한 번 복구, 복구 후 양방향 전송                        |
| 지연된 이력과 실시간 수신 | 실제 history 응답을 받은 뒤 전달만 보류, 입력 차단, 그 사이의 live 메시지와 과거 이력 병합, 재입장 후에도 중복 없음          |
| 조회 실패와 수동 재시도   | history 요청 한 번에 503 주입, 입력 차단·오류 안내, 키보드 Enter로 복구 재시도 후 대화와 전송 복구                           |
| 퇴장 뒤 늦은 응답         | history 전달 보류 중 확정 DELETE204, 늦은 응답 후 지도 화면 유지, 다른 기기 전송 유지, 새 입장으로 복원                      |

## 증빙과 한계

실행마다 node_modules/.tmp/chat-device-history-e2e/run-*/에 results.json, backend.log, 실패 시 화면 캡처를 보존한다. trace·video·HAR는 기록하지 않는다. JWT·쿠키 원문을 문서나 결과 첨부에 넣지 않는다. BE의 JUnit XML로 fixture 준비·정리 성공도 확인한다.

단절은 테스트용 WebSocket 제어로 연결을 닫아 재현한다. 물리 네트워크 단절이나 운영 모바일 백그라운드 전환을 재현한 것은 아니다. 모바일은 데스크톱 Chrome의 viewport·touch 에뮬레이션이다. 실제 Android/iOS/Safari, 물리 GPS·지역 이동, 로그인 화면·refresh 쿠키·인증 세션 폐기 및 기기 간 로그아웃은 검증하지 않는다. 인증 담당자의 B7 이벤트 발행 연동 의존성도 유지한다. 서버 강제 재시작 검증은 B10의 별도 프로세스 테스트를 따른다.

제품 src·인증 정책·BE 코드·공개 API·DB·의존성은 변경하지 않았다. 테스트 전용 명령 하나와 기존 브라우저 runner의 suite 선택·합성 sid 발급만 추가했다. 전체 App 라우팅·내비게이션 외형 검증과는 구분한다.

## 결과

- 다중 기기 E2E: Chrome 데스크톱 6개·모바일 viewport 6개, 총 12개 통과. 실패·제외·재시도 0개, 56.0초.
- 증빙: node_modules/.tmp/chat-device-history-e2e/run-1792307968855-7214/. BE fixture 검증 XML도 backend-fixture-results/에 복사했다. 실행 후 인증 fixture 삭제를 확인했다.
- 전용 TypeScript·ESLint·runner 구문·변경 파일 Prettier·프로덕션 빌드 통과.
- 전체 Vitest: 601개 중 595개 통과, 조건부 5개 제외, 기존 이미지 추천 dialog 이름 기대값 불일치 1개 실패. JSON은 node_modules/.tmp/f7-all-tests.json에 보존했다.
- 전체 Prettier: 기존 인증 관련 6개 파일 위반. 해당 파일은 변경하지 않았다. 빌드의 500kB 청크 경고도 유지한다.
- 기존 F4 다중 탭 E2E도 12개 전부 통과했다. 실패·제외·재시도 0개, 39.9초. 증빙은 node_modules/.tmp/chat-tab-leave-e2e/run-1792307883699-6680/이다.
- 실제 물리 기기·운영 인증·GPS까지 검증 완료했다고 표시하지 않는다.

실제 STOMP CONNECT의 view 재사용 확인을 보강한 뒤 위 12개를 다시 실행한 최종 결과다. 초기 실행도 12개 통과했으며 run-1792307771341-5945/에 보존했다.
