# Meomuneum Frontend

Meomuneum 프로젝트의 웹 클라이언트입니다. React, TypeScript, Vite를 기반으로 사용자 화면을 개발하기 위한 초기 프로젝트입니다. 현재는 Vite 기본 예제 화면과 빌드·린트 설정이 준비되어 있으며 서비스 화면, API 연동 및 인증 흐름은 아직 구현되지 않았습니다.

## 기술 및 실행 환경

| 항목              | 버전 / 구성 |
| ----------------- | ----------- |
| Node.js           | `24.18.0`   |
| npm               | `11.16.0`   |
| React / React DOM | `^19.2.8`   |
| TypeScript        | `~6.0.2`    |
| Vite              | `^8.3.0`    |
| ESLint            | `^10.10.0`  |

Vite 자체의 Node.js 지원 범위는 `^20.19.0` 또는 `>=22.12.0`입니다. Node.js와 npm은 위 버전을 기준으로 개발합니다. React 등 의존성의 버전 범위는 `package.json`, 실제 설치 버전은 `package-lock.json`을 기준으로 하며, `npm ci`로 설치합니다.

```sh
node --version
npm --version
```

아래 명령은 프론트엔드 디렉토리에서 실행합니다.

## 설치 및 개발 실행

```sh
# 잠금 파일에 기록된 의존성 설치
npm ci

# 개발 서버 실행
npm run dev
```

기본 개발 서버 주소는 `http://localhost:5173`입니다. 포트가 사용 중이면 다른 포트가 선택될 수 있으므로 터미널에 표시된 주소를 확인하세요. 소스 변경은 개발 서버에서 자동 반영됩니다.

새 의존성을 추가할 때는 `npm install <패키지명>`을 사용하고 `package.json`과 `package-lock.json`을 함께 커밋합니다.

## 검증 및 빌드

```sh
# ESLint 검사
npm run lint

# TypeScript 검사 및 배포용 빌드
npm run build

# build 실행 후 빌드 결과 확인
npm run preview
```

빌드 산출물은 `dist/`에 생성됩니다. 미리보기 기본 주소는 `http://localhost:4173`이며 실제 주소는 터미널 출력에서 확인합니다. `preview`는 빌드 확인용이며 운영 서버로 사용하지 않습니다.

현재 `npm test` 스크립트와 단위·통합·E2E 테스트 도구는 구성되어 있지 않습니다. 현재 검증은 린트, TypeScript 검사, 빌드 및 브라우저에서의 수동 확인으로 수행합니다. 예제 화면에서는 카운터 버튼 동작과 브라우저 콘솔 오류 여부를 확인할 수 있습니다.

## DB 준비 및 백엔드 연결

프론트엔드 예제 화면 실행에는 DB나 백엔드가 필요하지 않습니다. 브라우저는 MySQL에 직접 접속하지 않고 백엔드 API를 통해 데이터를 주고받습니다.

백엔드와 함께 개발할 때는 다음 순서로 준비합니다.

1. 백엔드 README를 따라 개발용·테스트용 MySQL DB와 사용자를 만듭니다.
2. 백엔드 환경변수를 설정하고 `dev` 프로필로 서버를 실행합니다. 기본 주소는 `http://localhost:8080`입니다.
3. 구현한 API에 맞춰 프론트엔드 요청 코드와 API 주소 설정을 추가합니다.

현재 `vite.config.ts`에는 API 프록시가 없고 API 요청 코드나 API 주소 환경변수도 없습니다. API 연동 시에는 백엔드의 CORS·인증 설정 또는 개발 서버 프록시를 요청 방식에 맞게 구성해야 합니다.

Vite의 `VITE_` 접두사 환경변수는 클라이언트 코드에 노출됩니다. 향후 API 주소 설정에 사용할 수 있지만 DB 비밀번호나 비밀키는 넣지 마세요. 환경변수 파일을 도입할 때는 로컬 파일의 `.gitignore` 제외 규칙과 비밀값이 없는 예시 파일도 함께 준비하세요. 현재는 환경변수 파일을 만들 필요가 없습니다.

## 디렉토리 구성

```text
public/             정적 파일
src/assets/         소스에서 사용하는 이미지 등
src/App.tsx         현재 예제 화면
src/App.css         예제 화면 스타일
src/index.css       전역 스타일
src/main.tsx        React 진입점
index.html          HTML 진입점
vite.config.ts      Vite 설정
eslint.config.js    ESLint 설정
tsconfig*.json     TypeScript 설정
package.json        의존성 및 실행 스크립트
package-lock.json   의존성 잠금 파일
```

`node_modules/`와 `dist/`는 Git 제외 대상입니다. 설치된 의존성이나 빌드 결과를 소스와 함께 커밋하지 않습니다.

## 실행 문제 확인

- Node.js 버전 오류: 위 지원 범위를 만족하는 버전인지 확인합니다.
- 설치 오류: npm 레지스트리 네트워크 연결과 두 package 파일의 일치 여부를 확인합니다.
- 빌드 오류: 터미널에 표시된 TypeScript 또는 Vite 오류를 수정합니다.
- API 호출 오류: 백엔드 실행 여부, 요청 주소, CORS 및 인증 설정을 확인합니다. 현재 예제 화면에는 API 호출이 없습니다.
- 포트 충돌: 터미널에 표시된 실제 주소를 사용하거나 `npm run dev -- --port 5174`로 포트를 지정합니다.

## 텍스트 음악 추천 기능

텍스트 입력과 향후 STT 전사문은 같은 추천 요청 함수를 사용합니다.
추천 결과는 POST 응답으로 바로 표시하며 최초 결과를 위한 GET 폴링은 하지 않습니다.
입력 문장은 연속 추천을 위해 대화별로 저장되며, 검색 결과가 없거나 외부 서비스가 실패하면 입력 문장을 복구해 다시 전송할 수 있습니다.

## 음악 기록 삭제

기록 목록에서 상세를 열고 `기록 삭제`를 누르면 확인 대화상자가 열립니다. 취소·Escape는
요청을 보내지 않고 이전 포커스를 복원하며, 처리 중에는 중복 삭제와 수정을 막습니다.
기존 인증 클라이언트로 `DELETE /api/v1/music-records/{record_id}`를 호출하고 본문 없는
`204`를 받은 뒤 지도 캐시·ETag를 무효화하고 목록을 다시 조회합니다. 마지막 기록을
삭제하면 빈 목록을 표시합니다. `404`는 이미 없는 기록으로 안내하고 목록을 다시 조회합니다.
`401`은 다시 로그인, `403`은 소유권 안내, 서버·네트워크 오류는 재시도를 제공합니다.
10초 응답 제한 이후 서버 처리 여부는 확정하지 않으며 재시도 결과로 목록을 갱신합니다.

BE #99의 삭제 API를 먼저 배포해야 합니다. 지도 앨범 커버는 별도
`feature/map-latest-album-cover` 작업 통합 후 최신 기록 삭제 시 이전 커버 선택과 마지막
공개 기록 삭제 시 커버 제거를 확인합니다. 삭제 전에 시작한 지도 응답은 새 캐시를
덮어쓰지 않도록 세대를 비교합니다.

`npm run test -- src/features/music-record/musicRecordDelete.test.tsx src/features/mainMap/mapApi.test.ts`는
Mock API와 jsdom으로 취소·성공·실패·중복 요청·이탈·지도 캐시를 검증합니다. 배포 전 실제
브라우저에서 Tab·Escape·포커스 복원, 모바일·긴 곡 제목과 BE 연동을 추가 확인합니다.
Feature Flag는 없으며 롤백은 FE 삭제 UI를 먼저 되돌린 뒤 BE를 되돌립니다. 코드 롤백은
이미 소프트 삭제된 데이터를 복원하지 않습니다.

### 음악 기록 다중 선택 삭제 (#75)

목록 오른쪽 상단의 `기록하기`를 `삭제하기`로 바꿨습니다. 삭제 모드에서 카드를 누르면
상세 이동 대신 선택·해제하며 주황색 테두리·옅은 배경·선택 표시와 `aria-pressed`로
상태를 전달합니다. 최대 100개를 선택하고 개수를 확인한 뒤 한 번의 확인으로 삭제합니다.
더 불러온 기록도 함께 선택할 수 있으며 선택 취소·목록 새로고침 시 선택을 초기화합니다.

BE #101의 `DELETE /api/v1/music-records`에 `{ "record_ids": [7, 8] }`를 보냅니다.
실패한 대상이 하나라도 있으면 서버가 전체를 롤백하므로 FE도 기록과 선택을 유지합니다.
404·시간 초과는 취소 후 목록 새로고침으로 현재 상태를 확인하도록 안내합니다.
성공 후 첫 페이지를 재조회하고 지도 캐시를 갱신합니다. 처리 중 선택 변경과 중복
요청을 차단하며 확인 대화상자는 기존 키보드·포커스 동작을 공유합니다.

`npm test -- --run src/features/music-record/musicRecordBulkDelete.test.tsx`에서
다중 선택, 취소, 요청 ID·인증, 성공·오류, 중복 차단, 페이지 추가와 선택 개수 제한을
검증합니다. BE 선배포, 실제 브라우저 검증, 지도 작업 의존성과 롤백 기준은 위와 같습니다.

## 긴 아티스트명 및 저장 실패 안내 (#80)

음악 검색과 선택 화면은 아티스트명 원문을 유지합니다. 정상 저장 요청은
`music.provider`와 `music.external_music_id`를 보내며 아티스트명은 백엔드에서 조회합니다.
100자를 넘는다는 이유로 곡 선택을 차단하거나 이름을 잘라 전송하지 않습니다.

백엔드가 HTTP 502와 `{ "message": "music metadata invalid", "data": null }`을 반환하면
"선택한 곡의 음악 정보를 저장할 수 없습니다. 다른 곡을 선택해 주세요."를 표시합니다.
뒤로가기에서 다른 곡을 선택할 수 있으며 장소명과 메모는 보존됩니다.
일반적인 500 응답에는 기존 서버 오류 및 재시도 안내를 유지합니다.
저장 중 버튼은 비활성화하고 실패 후 다시 활성화합니다.

`musicRecordMetadata.test.tsx`는 제보된 긴 아티스트명을 사용해 검색·선택,
실패 후 입력 보존과 버튼 복구, 진행 중 중복 클릭 방지, 재시도 성공,
비정상 메타데이터 안내를 검증합니다. API와 위치 조회는 테스트 대역입니다.
실제 백엔드 연동과 운영·스테이징 화면 검증은 배포 전에 별도로 수행해야 합니다.

```sh
npm run test -- src/features/music-record/musicRecordMetadata.test.tsx
```

배포는 백엔드의 아티스트명 컬럼 확대 및 새 오류 응답 적용 후 진행합니다.
안내에 문제가 있으면 이전 프론트엔드 배포로 복구할 수 있습니다.
관련 백엔드 이슈: https://github.com/100-hours-a-week/KTB4-18th-BE/issues/103

## 챗봇 200자 입력 정책 (#104)

직접 입력은 textarea의 200자 한도를 적용하고 현재 입력 길이 / 200을 표시합니다.
길이는 JavaScript `String.length`와 브라우저 `maxLength`의 UTF-16 코드 단위 기준으로,
백엔드 `@Size(max = 200)`와 동일합니다. 공백과 줄바꿈을 포함하며 일반 한글은 1자,
보조 평면 이모지는 2자로 계산합니다. 전송할 때 앞뒤 공백은 제거합니다.

음성 전사문은 200자를 넘더라도 원문을 그대로 입력창에 표시합니다. 초과 시 수정 안내를 제공하고
버튼과 Enter 전송을 막습니다. 사용자가 200자 이내로 줄이면 전송할 수 있습니다.
한글 조합이나 프로그램 입력으로 초과 상태가 되더라도 자동 절단하지 않고 동일하게 전송을 차단합니다.
전사 완료만으로 추천을 요청하지 않습니다. 백엔드의 400 안내는 입력창에 내용을 보존한 채 표시합니다.
DB TEXT 타입, 녹음 제한 및 추천 SSE 계약은 변경하지 않습니다.

프론트엔드를 먼저 배포한 다음 백엔드 #109의 200자 검증을 적용합니다.
정상 텍스트·음성 추천, 글자 수, 201자 전사문 원문 보존과 전송 차단 및 수정 후 전송을
실제 브라우저와 스테이징 AI 연동에서 확인합니다.
앱 테스트는 붙여넣기·공백·199/200/201자·줄바꿈·이모지·한글 조합 Enter 흐름을 검증하며,
AI와 STT는 테스트 대역입니다. 백엔드 롤백 시에도 프론트 제한은 유지해 이전 자동 절단 문제를 완화합니다.
관련 백엔드 이슈: https://github.com/100-hours-a-week/KTB4-18th-BE/issues/109

## 음성 녹음 자동 종료와 전사

음성 녹음은 최대 60초에 자동 종료합니다. 자동·수동 종료가 겹쳐도 마지막 녹음 데이터가
도착한 뒤 전사 요청을 한 번만 전송하며, 자동 종료 후에는 “녹음이 자동 종료되었어요.
음성을 변환하고 있어요.”라고 안내합니다. 전사 결과는 입력창에 표시하고 사용자가 확인·수정한
뒤에만 추천을 요청합니다. 200자를 초과한 전사문은 원문을 유지하고 사용자가 줄이도록 안내합니다.
취소하거나 화면을 벗어나면 녹음·타이머·마이크를 정리하며 지연된 종료 이벤트로 전사하지 않습니다.

백엔드 #119는 60초를 초과한 정상 음성도 앞부분을 최대 60초 이내로 준비하여 AI에 전송합니다.
WebM·MP4와 10MB 제한은 유지합니다. 공개 오류의 안전한 `message`를 표시해 형식·손상·파일 준비
오류를 구분하며, 5xx/네트워크 오류는 같은 녹음으로 재시도할 수 있습니다. 내부 AI 오류 본문을
직접 해석하지 않습니다. 백엔드의 FFmpeg 실행 환경과 수정 사항을 먼저 적용한 뒤 프론트엔드 #122를
배포하고 실제 브라우저의 WebM·MP4 녹음과 AI 전사를 확인합니다.

## 지역 채팅 탭 자동 입퇴장 (#133)

채팅 탭을 열면 정확도 100m 이내 위치 확인 → 지역 방 조회 → 참여 REST → STOMP CONNECT →
방 구독 receipt 순서로 입장한다. `useChatParticipation().isReady`는 연결과 구독이 확인된 뒤에만
true이며, 후속 메시지 UI는 이 값이 false일 때 전송을 비활성화해야 한다.
위치 권한/확인 실패, 정원 초과, 인증 실패와 일주일 제재는 안내하며 허용되는 실패 상태에서
사용자가 직접 다시 입장할 수 있다. 제재와 다른 기기 퇴장 뒤 자동 입장하지 않는다.
메시지 입력·표시·복원과 공동 음악 재생은 이번 작업에 포함되지 않는다.

다른 내비게이션 탭, 뒤로가기, 퇴장, pagehide와 인증 종료에서는 즉시 연결을 끊고
참여 ID를 포함한 DELETE를 keepalive로 전달한다. 탈퇴/로그아웃에 따른 서버의 계정 전체 연결
종료를 포함한다. 실패한 unload 네트워크 요청의 도착은 브라우저에서 보장할 수 없으며,
마지막 연결 종료 후 서버의 30초 유예로 자리가 회수된다.
이전 계정의 퇴장을 새 계정 토큰으로 보내지 않는다. 같은 계정/세션의 갱신 토큰만 사용할 수 있다.
화면 전환 중 이미 전송한 입장 요청은 응답의 참여 ID를 받아 퇴장하며, 다음 입장과 퇴장을
직렬화해 늦은 응답이 새 입장 상태를 덮거나 새 참여를 취소하지 않게 한다.

일시 단절은 새 access token으로 재연결하며 30초 안에 복구하지 못하면 중지한다.
10분마다 위치를 재확인하고 다른 지역이 15초 뒤에도 같으면 기존 방을 먼저 퇴장한다.
새 방 조회/입장 실패나 정원 초과에도 기존 방에 남지 않는다. 위치 확인 실패 또는 경계 결과가
서로 다르면 기존 방을 유지한다.

`VITE_API_BASE_URL`의 origin에서 `/ws`로 접속한다. HTTPS API는 WSS를 사용한다.
로컬은 기존 `VITE_API_PROXY_TARGET`으로 `/api`와 `/ws`를 함께 프록시한다.
BE #140을 먼저 배포하고 운영 프록시의 WebSocket upgrade와 CORS 허용 Origin을 설정한다.
모바일 360px/데스크톱에서 위치 권한 거부와 재시도, 키보드 탭·Enter, 탭 변경, 두 기기 전체 퇴장,
30초 단절과 지역 이동 실패를 스테이징에서 확인한다. 롤백은 FE를 먼저 이전 버전으로 복구한다.

## 실시간 지역 채팅 화면과 접속 인원 (#134)

실시간 텍스트·ACK·전송 차단은 BE #141 계약을 사용하며, 욕설·음란성 처리는 BE #155의 마스킹 정책을 따른다.
상단 지역·접속 인원, 가운데 목록, 하단 입력창을 고정 영역으로 구성한다.
내 메시지는 오른쪽에 표시하며 전체 페이지 대신 목록만 스크롤한다. 하단을 보고 있을 때만
새 메시지를 따라가고 이전 메시지를 읽는 위치는 유지한다. 공동 음악 재생은 포함하지 않는다.

BE #152의 `CHAT_PRESENCE` 최초 스냅샷과 최신 변경 순번으로 실제 접속 계정 수를 표시한다.
같은 계정 여러 연결은 1명이고 예약·단절 유예는 표시에서 제외한다. 초기 확인 중·단절·
확인 실패를 구분하며 재연결 후 이전 연결의 이벤트를 버린다. 준비 후 10초 동안 인원 이벤트가
없으면 확인 실패를 표시하고 다음 이벤트에서 복구한다. BE #152 배포 후 FE를 배포한다.

화면 캡처와 자동·실제 계약 연동 검증 결과는
[지역 채팅 검증 기록](docs/verification/region-chat.md)을 참고한다.

## 마스킹 ACK 호환성 (BE #155)

서버가 반환한 마스킹 content를 표시한다. ACK 본문은 입력 원문과 다를 수 있으므로
현재 방·참여·인증 계정·전송 UUID로 대기를 확인하고 타이머와 원문 대기를 정리한다.
ACK/broadcast 역순에도 메시지는 한 번 표시한다. FE에 탐지 목록을 복제하지 않는다.
BE #155를 배포하기 전에 이 FE 호환성 변경을 먼저 배포한다.

## 다중 서버 FE 연결·복구 연동 (P1 9단계)

2026-10-27 기준으로 아래 내용이 앞선 단일 앱/30초 재연결/계정 전체 퇴장 설명보다 우선한다.
지역 채팅·방당1000계정·탭별 퇴장·sid별 이동/폐기·계정의 유효 참여 구간 합집합 history를 유지한다.
서버가 다른 Task로 바뀌어도 FE는 Task 주소를 선택하거나 새 membership을 자동 생성하지 않는다.

| 상황           | 동작과 판단 근거                                                                                                                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 공개 연결      | 기존 VITE_API_BASE_URL origin의 /ws(HTTPS→WSS)와 기존 채팅 REST 경로를 사용한다. CloudFront/ALB가 Chat으로 경로 분리하므로 별도 운영 Chat 도메인·Task 주소를 FE에 추가하지 않는다.                                                                         |
| 일시 중단/1013 | 전송을 막고 기존 목록·membership/view·미확인 UUID를 유지한다. STOMP 재접속은 초기1~2초 분산 후 지수 증가·최대30초이며 서버가 참여와 소유권을 다시 검증한다.                                                                                                |
| 재접속 성공    | 현재 sub/sid와 같은 인증으로 CONNECT한다. 방/개인queue receipt 두 개·현재 view의 CHAT_READY·고정 snapshot recovery·계정 history를 완료한 뒤 전송한다. 오래된 연결/요청 응답은 세대와 AbortSignal로 버린다.                                                 |
| 복구 대기 제한 | READY 대기10초, recovery+history 전체30초, live/ACK 대기500개를 넘으면 연결/요청을 취소하고 기존 “복구 다시 시도”를 제공한다. 부분 결과를 성공으로 표시하거나 버퍼를 조용히 유실하지 않는다. 복구 메시지도 기존 캐시와 같은 최근200개만 메모리에 유지한다. |
| ACK 유실       | 대기 전송은 불확정으로 표시하고 임의 재전송하지 않는다. 서버 history/recovery/ACK에서 현재 계정의 UUID가 확인되면 원문 대기·타이머를 지우고 저장된 마스킹 결과를 표시한다. 미확인 메시지의 명시적 재전송만 같은 UUID/본문을 유지한다.                      |
| 오류·종료      | 503/토큰 확인의 일시 실패는 로그인과 참여를 보존하고 재시도를 안내한다.401·membership 종료·4100/4101은 연결을 끝내며 자동 새 입장하지 않는다.4103/view 오류는 기존 복구 재시도로 분리한다.                                                                 |

history/recovery는 연결 소유 sub/sid에 고정한 chatSessionFetch로 요청하고 cache:no-store를 사용한다.
동일 sid의 토큰 갱신은 허용하고 다른 sid/계정으로 바뀐 요청은 재발행하지 않는다.
현재 view 복구 권한과 과거 계정 history 권한, 부재·24시간 만료 제외는 서버가 결정한다.
재연결을 새 입장으로 우회하거나 캐시로 조회 권한을 확대하지 않는다.
연결 유지 중 조용한 누락 자동 탐지/sync는 P2다. Redis 전역 epoch 복구·자동 개방·배포 drain은 BE 후속이며
이번 FE 연동을 운영 다중Task 활성화·무중단/종료지연 SLO 보장으로 표시하지 않는다.

로컬 분리 앱 실행:

```dotenv
VITE_API_BASE_URL=
VITE_API_PROXY_TARGET=http://localhost:8080
VITE_CHAT_PROXY_TARGET=http://localhost:8081
```

선택 변수 VITE_CHAT_PROXY_TARGET을 비우면 기존 단일 앱 프록시로 전달한다.
지정하면 /ws·/api/v1/chat-rooms/_·/api/v1/regions/_/chat-room을 Chat으로,
인증/refresh·위치 해석 등 나머지 /api는 Core로 전달한다. 이 프록시는 Vite 개발 서버용이며 운영 ALB 설정이 아니다.
.env.example에는 선택 변수와 용도를 기록하며 내부주소·Redis/서비스Bearer/JWT키는 FE에 넣지 않는다.
클라우드 팀은 기존 경로의 캐시 비활성·Authorization/X-Chat-View-Session/쿼리 전달·WS upgrade/Origin을
실환경에서 확인해야 한다. 이번에는 클라우드 설정을 변경하지 않는다.

검증 명령:

```sh
npm run format:check
npm run lint
npm run test -- --maxWorkers=4
npm run verify:chat:types
npm run build
npm run verify:chat:distributed
```

마지막 명령은 Docker·JDK·Node·Git/tar와 선행8단계를 포함한 로컬 BE가 필요하다.
CHAT_BACKEND_DIR(기본 ../meomuneum-backend)의 커밋된 HEAD를 임시 폴더로 복사하고 기존 CoreAuthProcessTest에
테스트 전용 bridge를 넣는다. 원래 BE 파일/브랜치/운영 설정을 바꾸지 않는다. MySQL·Redis·실제 Core·두 Chat JAR와
합성 세션·격리 TLS를 띄운 뒤 실제 FE ChatParticipation/STOMP/REST 클라이언트를 검증한다.
테스트의 인증 저장소·GPS 입력만 합성 대역이며 운영 로그인 브라우저 E2E와 구분한다.
loopback fault proxy가 REST는 Task A, 첫 WS는 Task B로 전달하고 ACK/broadcast 유실·1013 종료·다음 복구503을 주입한다.
명시적 복구 재시도는 Task A에서 같은 membership/view·입장1회·마스킹된 저장 결과·대기 해제를 확인한다.
프록시는 오류 주입을 위해 압축 협상을 제외한다. 실제 ALB/CloudFront·물리 모바일·1000연결 부하 검증은 아니다.
자식 앱/테스트 컨테이너는 하네스 종료 시 정리하며 기존 실행 환경을 유지한다. 합성 토큰 config는 시험 후 삭제한다.
증빙은 node_modules/.tmp/chat-multiserver-verification/의 JSON, harness-path.txt가 가리키는 임시 BE의
build/core-auth-integration 및 build/test-results/chatControlEventsTest다.
기존 Node 실제서버 조건부 시험도 새 소유 세션 고정 요청을 기다릴 수 있도록 fixture를 맞췄다.

2026-10-27 최종 검증: 전체830개 중824통과·6조건부 제외·실패0, 채팅/API/프록시162개 중158통과·4조건부 제외·실패0.
실제 Core/두 Chat/FE 통합1개 통과, format:check·lint·verify:chat:types·build 통과.
최초 전체 시험의 로그인 refresh1개5초 timeout은 단독53개 통과·동시 실행4개로 제한한 전체 재실행 통과로 확인했다.
초기 오류 주입 프록시가 압축된 ACK를 인식하지 못한 문제는 협상 제외로 보완했다.
중간 하네스 실행의 초기 복구 실패1회는 상세 HTTP 증빙이 없어 원인을 단정하지 않는다.
최종 시험은 초기 복구 실패가 실제 HTTP503인 경우에만 명시적 재시도를1회 허용하고 그 여부를 결과에 남기며,
그 외 초기 오류는 실패로 처리한다. 최종 결과와 최초 full 결과 모두 summary.json·각 JSON에 보존한다.
이 검증은 운영 세션·모바일·부하 승인이나 BE 전역 복구 완료를 뜻하지 않는다.

## 공동 재생 7단계 `/신청`·검색·대기열 UI (2026-11-09)

FE `feature/chat-music-request`에서 BE 2~6단계 계약에 맞춰 구현했다.
`VITE_CHAT_MUSIC_QUEUE_ENABLED=false`가 기본값이며, 활성화하려면 BE의 음악 큐·재생·이벤트와
기존 분산 참여·메시지 relay 의존성이 준비돼야 한다. 이 플래그는 비밀이나 서버 권한을 대신하지 않는다.
운영 설정은 변경하지 않았다. YouTube 플레이어·재생 조작·개인 음량은 8단계, 추가 복구는 9단계다.

- `/신청` 또는 `/신청 검색어`는 일반 메시지로 보내지 않고 검색 창을 연다. 일반 채팅·한글 조합 Enter는 유지한다.
- 지역 공개/본인 기록·본인 추천에서 검수된 신청 가능 곡만 검색한다. 검색 300ms 대기·20곡 페이지·출처·빈 결과·오류 재시도를 제공한다.
- 현재 곡과 WAITING 대기열을 분리한다. 신청자와 관계없이 모든 활성 참여자가 대기 곡을 취소한다.
  재생 중 곡에는 취소 버튼을 두지 않으며, 건너뛰기는 8단계에서 연결한다. 전원 퇴장 정리는 BE 책임이다.
- 네이티브 dialog에 이름·초기 포커스·Escape 닫기·원래 포커스 복원·모바일 스크롤을 적용한다.
  신청/취소 중 중복 입력을 막고, 요청 결과를 모르면 같은 UUID·본문·expected_version으로 명시적으로 확인한다.
  자동 재전송이나 로컬 낙관적 큐 변경은 없다. 미확정 명령은 해당 계정/sid/방/member/view의 메모리에서만 유지한다.
  같은 문맥의 재연결은 유지하고 다른 문맥·새로고침에서는 폐기한다.
- API는 기존 `chatSessionFetch`로 소유 계정/sid에 고정하고 같은 sid의 토큰 회전을 허용한다.
  시작/반영 시 소유권·연결 세대·요청 순서를 검사하고 늦은 응답을 버린다. 재연결 ready 이후 새 목록을 읽는다.
- 음악 이벤트는 기존 topic/parser/receipt·recovery 흐름을 사용한다. 방·epoch·최대 version을 검사하며
  같은 version의 두 유형은 허용한다. 더 높은 version이면 200ms로 조회를 합치고, 같은 version SYNC는 재조회하지 않는다.
  페이지 간 version 충돌·만료 cursor는 첫 페이지로 한 번 재조회한다. 서버 snapshot이 기준이며 전체 인원 동시 수신 보장은 아니다.
- API·런타임 타입, 명령/목록 상태, React 화면을 `src/features/chat-entry/music/`로 나눴다.
  로딩·연결 중·429·버전 충돌·불확실한 응답·이미지 실패를 처리하며 토큰/원문/실제 곡을 로그나 fixture에 추가하지 않는다.

검증 명령:

```sh
npm test -- src/features/chat-entry src/api/chatRooms.test.ts --maxWorkers=4
npm run lint
npm run verify:chat:types
npm run build
npm run verify:chat:music:browser
npm run verify:chat:music:integration
```

브라우저 명령은 설치된 Chrome(선택 `CHAT_BROWSER_CHANNEL`)·Playwright로 실제 React 화면을 검증한다.
HTTP만 합성 대역이며 320×568·390×844·1280×900에서 검색·이웃 곡 취소·UUID 재확인·재연결 차단·포커스·overflow를 확인한다.
실제 음악·로그인·물리 모바일 시험은 아니다. 증빙은 `node_modules/.tmp/chat-music-request-verification/browser/`다.

통합 명령은 Docker·JDK·Node·Git/tar와 선행 BE 커밋이 필요하다.
`CHAT_BACKEND_DIR`(기본 `../meomuneum-backend`)의 커밋된 HEAD를 임시 복사해 test-only bridge를 주입한다.
원본 BE는 수정하지 않는다. 실제 MySQL/Redis·HTTPS Core·두 Chat JAR와 FE ChatParticipation/STOMP/API를 연결한다.
인증 저장소/GPS 입력만 합성이며 REST Task A / WS Task B에서 24곡 페이지, 첫 신청 자동 재생,
서버 commit 후 응답 유실→원 UUID 확인·중복 없음, 음악 이벤트·대기 곡 취소를 검증했다.
합성 토큰 config는 종료 시 삭제하고 자식/시험 컨테이너를 정리한다. 운영 DB/Redis/YouTube/배포·1000연결 검증이 아니다.
증빙 `node_modules/.tmp/chat-music-request-verification/process-result.json`, `harness-path.txt`가 가리키는
임시 BE의 `build/core-auth-integration/`·`build/test-results/chatMusicEventsProcessTest/`를 따른다.

전체 시험은 964개 중 913통과·44실패·7조건부 제외다. 시작 HEAD의 임시 사본에서도 942개 중
892통과·동일한 44개 실패·6제외를 재현했으며 추가 실패는 없다. 기존 인증/음악 기록/마이페이지
기대 문구·동작 불일치를 이번 범위에서 바꾸지 않았다. 원본 결과와 baseline JSON을 함께 보존한다.
전체 포맷 검사는 기존 `locationRecommendationCoordinator.ts` 한 곳으로 실패하며 이번 변경 파일은 별도 검사한다.
린트·전용 타입 검사는 통과했다. 전체 green이나 운영 활성화 완료로 표시하지 않는다.

### 기존 검증 실패 후속 수정 (2026-11-09)

위 44건 실패·포맷 오류는 최초 7단계 검증 이력이며, 후속 수정으로 해소했다.
전체 재실행에서 동일한 44건을 재현한 뒤 변경 이력을 대조했다.
음악 기록·마이페이지 테스트는 현재 버튼·검색·빈 목록·메뉴·뒤로가기 이름과 달랐고,
인증 테스트는 복구 실패 시 로그인 경로 안내 및 명시적 세션 무효 응답의 로컬 표식 해제와 달랐다.
현재 동작에 맞춰 요소 조회·기대 결과를 수정하고, 미확정 요청 보존·중복 POST 방지·입력 보존·
500자 제한·삭제·지역 유지 검증은 유지했다. 생성 폼과 상세 화면의 메모 라벨도 구분했다.
제품 동작·API 계약은 변경하지 않았으며 추천 조정기의 중복 빈 줄 두 곳만 별도 포맷 커밋으로 정리했다.

- 수정 대상296건 전부 통과. 최종 전체964건 중957통과·7조건부 제외·실패0.
  테스트 삭제나 제외 추가는 없다. 기본 실행의7건은 실제 서버 환경이 필요한 기존 통합 테스트다.
- `npm run format:check`, `npm run lint`, `npm run verify:chat:types`, `npm run build` 통과.
- `npm run verify:chat:music:integration`으로 실제 MySQL/Redis·Core·두 Chat 프로세스의
  검색·신청·응답 유실 후 원UUID 확인·이벤트·취소를 별도 검증했다. 합성 인증·곡을 사용하는 격리 환경이다.
- `npm run verify:chat:music:browser`의 Chromium320/390/1280px 검증도 통과했다.
  실제 React와 합성 HTTP를 사용하며 실제 OAuth·YouTube·물리기기·운영 부하 검증은 아니다.
- 수정 전·중간·최종 JSON과 요약은 로컬 `node_modules/.tmp/fe-existing-failures-verification/`에 보존한다.
  서버·브라우저 증빙은 기존 `node_modules/.tmp/chat-music-request-verification/`을 사용한다.

## 공동 재생 8단계 YouTube 플레이어·기본 위치 보정 (2026-11-09)

지역 채팅의 현재 곡을 공식 YouTube IFrame API로 재생하고, 모든 활성 참여자에게 방 전체 재생/일시정지/재개/다음 곡 조작을 제공한다.
`feature/chat-music-player`의 시작 HEAD는 cc55c92(7단계 병합)다. BE 원본·DB·외부 문서·운영 설정은 변경하지 않았다.

`VITE_CHAT_MUSIC_QUEUE_ENABLED=true`와 새 `VITE_CHAT_MUSIC_PLAYER_ENABLED=true`가 모두 필요하다.
두 플래그는 기본 false다. BE의 음악 큐·재생·이벤트 및 기존 참여/전파 의존성도 먼저 준비한다.
SDK는 현재 곡이 있을 때만 로드하며 별도 YouTube API key나 사용자 토큰을 전달하지 않는다.
중앙 오디오 추출/중계가 아니라 각 브라우저가 공식 영상 플레이어로 같은 서버 상태를 따른다.

- `ChatMusicQueueController`가 조회/음악 이벤트의 재생 snapshot과 수신 시점 `performance.now()`를 관리한다.
  `(연결 세대, epoch, version)`을 확인하며 같은 version의 새 server_time SYNC도 수용한다.
  오래된 큐 조회나 원 UUID 재현 응답으로 최신 재생 상태를 되돌리지 않는다.
- `chatMusicPlayer.ts`는 `position_seconds + (server_time - state_changed_at) + 수신 후 단조 시계 경과`로 PLAYING 목표 위치를 계산한다.
  PAUSED 위치는 동결하고 고정 길이로 상한을 둔다. 기기 벽시계 변경을 사용하지 않는다.
  새 곡은 고정 `source_video_id`를 목표 위치에 로드하고, PAUSED 입장은 cue만 한다.
  1초마다 확인해 2초 초과 오차를 보정하되 반복 seek는 최소5초 간격으로 제한한다. 정지는 즉시 반영한다.
  첫 네트워크 전달 지연·광고·YouTube 버퍼링·기기 차이는 제거하지 못하므로 무오차 동시 재생 보장은 아니다.
- `ChatMusicPlayerView`는 플레이어·곡/가수·공통 상태와 내 기기의 상태·목표 위치를 구분한다.
  공식 iframe/컨트롤을 가리거나 소리를 추출하지 않고 최소200×200 크기를 유지한다.
  작은 높이에서는 플레이어 영역을 스크롤해 채팅 입력을 유지한다. 로컬 iframe 탐색/정지는 서버 상태를 변경하지 않는다.
- 공통 명령은 POST `playback/commands`에 `action`, `queue_item_id`, `expected_version`과 원 UUID를 보낸다.
  sid/member/view 고정, 중복 입력/계정 속도 제한·충돌/불확실한 요청의 명시적 확인은7단계 저장소를 공유한다.
  응답을 낙관적으로 적용하지 않고 fresh 조회/이벤트를 따른다. 재생 중 다음 곡은 SKIP이며 대기 곡 취소와 구분한다.
- 내 음량(초기70%)·음소거는 현재 참여/탭 메모리 설정이다. 재연결에는 유지하고 새 방/계정/새로고침에는 초기화한다.
  서버 명령·다른 참여자의 볼륨에 영향이 없다. 청취 시작/중지 선택 기능은 없다.
- `onAutoplayBlocked`에서는 정상 재생으로 표시하지 않고 ‘브라우저 재생 허용’ 버튼으로 현재 위치에서 다시 시도한다.
  이 버튼은 서버 재생 명령을 보내지 않는다. 삭제/임베드 불가·153/네트워크·SDK/iframe 준비15초 상한은 오류/재시도 안내로 처리한다.
  클라이언트 ENDED/영상 오류는 자동 SKIP이나 방 상태 전이를 발생시키지 않는다. 서버가 다음 곡을 결정한다.
  연결 상실·IDLE·퇴장/문맥 변경 시 플레이어와 타이머를 정리하고 이전 SDK 콜백을 무시한다.
  추가 입장/누락/장애 복구는9단계다.

공식 근거: [IFrame API](https://developers.google.com/youtube/iframe_api_reference),
[플레이어 매개변수](https://developers.google.com/youtube/player_parameters).
운영에서 CSP의 YouTube script/frame 허용·실제 origin/Referer·자동재생 정책을 확인해야 한다.
이번에 운영 헤더/클라우드 설정을 변경하지 않았다.

재현 명령:

```sh
npm run format:check
npm run lint
npm run verify:chat:types
npm test -- --maxWorkers=4
npm run build
npm run verify:chat:music:player:browser
npm run verify:chat:music:player:browser -- --live
npm run verify:chat:music:player:integration
```

기본 브라우저 시험은 실제 React/Chrome에 합성 HTTP·YT SDK를 주입해 세 화면 크기의 공통 조작·음량 격리·차단·seek·오류·정리를 검증한다.
`--live`는 실제 YouTube SDK/embed와 공식 API 데모 영상만 사용하는 별도 smoke check이며 카탈로그 곡을 등록하지 않는다.
이 환경에서는 SDK/iframe/재생 이벤트를 확인했고 자동재생 차단은 발생하지 않았다. 차단 경로는 합성 시험에서 확인한다.
실제 음악 카탈로그·물리 모바일·동시 기기 정밀도·운영 로그인/라우팅을 검증한 것은 아니다.

통합 시험은7단계 하네스에 PAUSE/RESUME/SKIP·고정 영상/길이·저장 위치 재개 검증을 추가한다.
BE 커밋 HEAD의 임시 사본에 test-only bridge를 주입하고 실제 MySQL/Redis·HTTPS Core·두 Chat JAR와
FE ChatParticipation/STOMP/API를 연결한다. REST Task A/WS Task B, 합성 인증 저장소/GPS·곡 데이터를 사용한다.
원본 BE를 수정하지 않으며 합성 token config·자식/시험 컨테이너를 정리한다.
증빙 `node_modules/.tmp/chat-music-player-verification/`의 JSON·로그·browser screenshot 및 harness-path의 임시 BE 시험 결과를 따른다.
커밋·push·PR·배포/운영 활성화는 수행하지 않았다.

최종 검증: 전체983개 중976통과·7조건부 제외·실패0, 채팅186개 중182통과·4조건부 제외·실패0.
포맷·린트·전용 타입·프로덕션 빌드 통과. 실제 Core/두 Chat 통합과 Chrome320/390/1280px 시험 통과.
추가300px 높이에서 입력창 경계를 확인했고, 최초 보정5초 간격과 검증 대기시간의 차이·작은 높이의 입력창 밀림은
대기시간/음악 영역 스크롤·대화 여백을 보완한 뒤 재검증했다. 실제 YouTube SDK/embed·공식 데모의 PLAYING도 관측했다.
이 결과는 물리 모바일/운영 음악 카탈로그·전체9~10단계 완료를 뜻하지 않는다.

## 공동 재생 9단계 입장·재연결·이벤트 누락·장애 복구 (2026-11-09)

FE `feature/chat-music-sync`, 시작390e4ad(8단계 PR252 병합)에서 기존 음악 저장소/Hook을 확장했다.
BE·공개 API/DB·기존 플래그와 운영 설정은 바꾸지 않았다. 기존7·8단계에서 후속으로 남긴 음악 복구 기준은 이 절을 따른다.

- 최초 입장/재연결은 기존 채팅 receipt·READY·recovery/history 완료 뒤 새 음악 snapshot을 읽는다.
  읽기 전에는 음악을 재생하거나 공통 명령을 보내지 않는다. PLAYING은 새 서버 위치, PAUSED는 동결 위치를 따른다.
  같은 계정/sid/방/member/view의 미확정 UUID·개인 음량은 유지하지만 명령을 자동으로 재전송하지 않는다.
- 변경 알림이 빠져도 다음 PLAYBACK_SYNC의 상위 version으로 큐/재생을 복구한다.
  음악 수신이15초간 없으면 읽기 전용 GET을 수행한다. 같은 version의 새 server_time도 수신으로 인정하되
  중복/구 버전/다른 방/epoch 알림은 상태를 되돌리거나 감시 시간을 계속 연장하지 않는다.
  이 동작은 음악에만 적용하며 일반 채팅의 별도 자동 누락 sync를 추가하지 않는다.
- `visibilitychange`로 화면이 다시 보이면 최신 상태를 확인한다. offline에서는 요청·재생을 중단하고
  online에서도 채팅 ready가 확인된 후 새 조회를 수행한다. 기존 요청의 늦은 응답/이전 SDK 콜백은 적용하지 않는다.
- 상태는 waiting/loading/ready/recovering/error/denied로 구분한다. 조회 실패/최신 버전 미확인 시 플레이어를 정리하고
  공통 조작·신청·취소·미확정 명령 확인을 잠근다. 큐 캐시는 읽을 수 있어도 권한이나 재생 근거로 쓰지 않는다.
  일시 실패는1/2/4초 + 최대249ms jitter로 최대3회 GET을 재시도한다(각 요청10초 상한).
  한도를 넘으면 자동 조회를 멈추고 수동 ‘음악 상태 다시 확인’을 제공한다. 새 연결/online/화면 복귀도 재확인 계기다.
  401/403/404는 자동 재시도하지 않으며 live 음악 알림만으로 이용 권한을 다시 승인하지 않는다.
- 결과 불확실한 쓰기는 UUID/원 tuple을 남기고 읽기 전용 재확인을 시작한다. 최신 상태 복구 후 사용자가 원 UUID로
  결과를 확인할 수 있다. 영수증의 과거 응답으로 재생을 되돌리거나 새 UUID로 임의 재신청하지 않는다.
- 복구 안내·명시적 확인 버튼은 검색/대기열 dialog 내부에서도 제공한다. native modal 뒤의 버튼만으로 복구하게 하지 않는다.
  연결 실패와 YouTube 영상 자체의 차단/오류를 구분한다. 개인 음량/음소거는 복구 과정에서도 현재 참여/탭에 유지한다.

서버의 큐/재생/명령은 기존 DB와 서버 시각이 기준이다. 기존 마지막 유효 참여 종료는 현재 곡·WAITING을 함께 취소한다.
이번 실제 통합 시험에서 현재 곡+대기 곡이 있는 마지막 탭 퇴장 후 재입장 시 IDLE/current=null/빈 큐를 확인했다.
Redis 전역 장애는 기존 lifecycle의 fail-closed·1013과 운영자 복구 명령→Chat 재기동 계약을 유지한다.
FE가 Redis를 초기화하거나 운영 복구 명령을 호출하지 않는다. 전역 Redis 재시작/epoch CLI 자체는 이번에 새로 실행하지 않았다.
기존10단계 운영 복구 검증 이력과 구분하며 실제 배포·운영 복구/1000연결 승인으로 표시하지 않는다.

```sh
npm run format:check
npm run lint
npm run verify:chat:types
npm test -- --maxWorkers=4
npm run build
npm run verify:chat:music:sync:browser
npm run verify:chat:music:sync:integration
```

브라우저 명령은 실제 React/Chrome과 합성 HTTP/YT SDK로320/390/1280px·300px 높이를 검증한다.
390px에서는 화면 복귀→GET503 두 번→PAUSED 복원·알림 없는 RESUME의15초 감시 복구·offline/online과
음량25%/음소거 유지·추가 쓰기0을 확인한다. 물리 모바일/실제 YouTube 장애 시험은 아니다.

통합 명령은7·8단계의 BE HEAD 임시 archive 하네스를 사용한다. 원본 BE를 수정하지 않고 test-only bridge로
실제 MySQL/Redis·HTTPS Core·두 Chat JAR·FE ChatParticipation/STOMP/API를 연결한다.
REST A/WS B에서 음악 힌트를 FE 전달 경계에서 누락시키고 음악 GET503 두 번과 실제 소켓 단절을 주입한다.
같은 membership/view의 재연결·PAUSED 위치/고정 소스 복원·음악 수신 침묵 복구·마지막 퇴장/재입장을 확인한다.
서버 전체 프로세스 강제 종료·Redis 전역 복구를 주입한 시험과는 구분한다. 인증 저장소/GPS/곡은 합성이며
합성 token config·자식 프로세스/시험 컨테이너는 기존 하네스 종료 흐름으로 정리한다.

증빙은 `node_modules/.tmp/chat-music-sync-verification/`의 전체/채팅/통합 JSON·로그·browser 결과와 screenshot,
`harness-path.txt`가 가리키는 임시 BE의 `build/core-auth-integration/`·전용 test-results다.
최초 실제 통합의 원 UUID 확인 시도가 fresh 조회 완료 전 실행되어 차단된 것은 시험이 새 readiness 조건을 기다리도록 보완했다.
UI가 복구 중 허용하지 않는 명령을 시험에서 직접 호출해 성공했다고 간주하지 않는다.
커밋·push·PR·외부 문서·운영 설정·배포는 수행하지 않았다.

최종 전체990개 중983통과·7조건부 제외·실패0, 채팅193개 중189통과·4조건부 제외·실패0.
포맷·린트·전용 타입·프로덕션 빌드 통과. 음악 복구 단위/화면 시험39개·실제 Core/두 Chat 통합1개 통과.
브라우저 세 크기·조회 실패/침묵/온라인 복구 및 screenshot을 확인했다. 최초 단위 시험의 쓰기 요청 인덱스는
추가된 읽기 재확인과 구분하도록 수정했고, 권한 오류의 dialog 내부 재시도도 회귀 시험에 포함했다.

### 9단계 BE 연동 보완 (2026-11-10)

위9단계의 ‘BE 변경 없음/전역 복구 미실행’은 FE 선행 구현 당시의 이력이다.
후속 BE `feature/chat-music-recovery`는30초 검증 유예·늦은 join/claim 전 빈 방 정리·PAUSED scan·조회 reconcile·CLI 구 음악 Outbox 만료를 구현했다.
QueueSnapshot의 선택 `epoch`(OpenAPI1.2.0)를 파싱하고 첫 이벤트보다 먼저 고정해 구 세대 알림을 차단한다.
필드 없는 구 BE도 지원한다. 다른epoch의 GET은 재생을 승인하지 않고 새 채팅 연결 후 fresh조회가 필요하다.
`npm run verify:chat:music:sync:integration -- --worktree`로 src/build.gradle의 추적 BE 변경을 임시 사본에 적용해 검증한다.
환경 파일/원본 BE는 변경하지 않고 diff SHA256을 남기며 미추적 BE src는 누락시키지 않고 거부한다.
BE에서 실제 SIGTERM/SIGKILL·Redis 재시작·전용 CLI 복구를 별도로 검증했다. 실제 운영 설정/배포/SLO 승인은 아니다.

## 공동 재생 10단계 통합 검증·운영 반영 준비 (2026-11-10)

양쪽 `feature/chat-music-verification`의 릴리스 후보는 다음 명령으로 검증한다.

```sh
npm run verify:chat:music:readiness -- --live-youtube
```

BE의 `scripts/verify-chat-music-release.py`가 전체 회귀·실제 서버 복구·참여 회귀·세 JAR와
FE 포맷/린트/타입/전체 시험/빌드·실제 서버에 연결한 세 Chrome 창·계약·기존 복구 UI·선택 YouTube smoke를 실행한다.
Docker/JDK25·설치 Chrome·양쪽 의존성이 필요하다. 양쪽 작업 트리는 실행 중 고정하며 먼저 포맷을 끝낸다.
실행별 증빙은 BE `build/chat-music-release-verification/<UTC시각>/summary.json`과 단계 로그/XML에 보존한다.

개별 실제 서버 브라우저 검증은 `npm run verify:chat:music:release -- --worktree`,
실제 응답/이벤트와 FE 파서·JSON Schema의 대조는 `npm run verify:chat:music:contracts`다.
`--worktree`는 BE 추적 src/build.gradle 변경을 임시 사본에 적용하고, 새로운 미추적 BE src가 있으면 거부한다.
서로 다른2계정·3탭이 신청/공동 정지/대기 곡 취소/정지 입장/건너뛰기/개인 음량/음악 중 채팅/마지막 퇴장을 검증한다.
인증 저장/GPS와 YouTube SDK만 합성이다. 실제 OAuth·음원·물리 모바일·1000기기 동기화 시험으로 표시하지 않는다.

이 과정에서 빠른 `/신청` 재개방 뒤 이전 native dialog close가 새 창을 닫을 수 있는 문제를 보완했다.
늦은 close 시 이미 다시 열린 dialog라면 닫힘을 적용하지 않으며 재현/실제 브라우저 회귀를 포함한다.
음악 API/공통 제어/음량 정책은 유지한다. 동시에 변경된 큐의 새 version을 수신한 뒤 공통 조작하는 시험과
정상적인409 충돌 처리도 구분한다.

운영 반영 순서/승인 조건은 BE README의 `10단계 운영 체크리스트와 반영 절차`, 미확인 gate는 `api/chat-music-release-gates.json`을 따른다.
검수 곡·실제 라우팅/ACL/키/관측·물리 모바일·1000연결/SLO 검증이 남아 있으며 음악 두 FE 플래그는false다.
로컬 검증 통과를 실제 배포/운영 승인으로 표시하지 않고 커밋·push·PR·운영 설정 변경은 수행하지 않는다.

### 10단계 최종 로컬 검증 결과

2026-11-10 `20261110T011615Z` 실행은 `localVerificationPassed=true`,
`operationalActivationAllowed=false`다. 증빙은 BE
`build/chat-music-release-verification/20261110T011615Z/summary.json`과 단계 로그/XML에 있다.

- BE 전체 977개: 954 통과·23 조건부 제외·실패0. 별도 음악 복구20개·참여49개 전부 통과.
- FE 전체 994개: 987 통과·7 조건부 제외·실패0. 포맷/린트/채팅 타입/빌드 통과.
- 실제 Core·두 Chat·MySQL/Redis·2계정3탭에서 공동 제어/타인 대기 곡 취소/정지 입장/개인 음량/채팅/마지막 퇴장 정리 통과.
- 실제 STOMP30건·queue20건을 스키마/FE 파서로 검사하고 OpenAPI 참조82개·잘못된 이벤트3개 거부 확인.
- 기존 복구 UI 브라우저 회귀 통과. 별도 실제 YouTube SDK/iframe1개/PLAYING 관측·오류/실패 요청0.
  공식 데모·합성 방 상태의 smoke이며 운영 곡·물리 모바일 동시 청취 검증은 아니다.
- BE 소스 SHA256 `b7193d22e0ce23835a1f9cf7ae44c33344575e2457ba48f3cd981edfa69fecb5`와 세 JAR manifest가 일치한다.
  FE 소스 SHA256 `ad5983fc5cacb5b152795a3721b1383b450cd5900c07d891ffe081bdd965ae9d`도 실행 중 변경이 없었다.

검수 곡·운영 migration/권한/ACL/키/라우팅·물리 모바일·1000연결/SLO·관측/복구 훈련·릴리스 승인 gate는 모두 pending이다.
기본 플래그false를 유지하며 운영 활성화·DB/클라우드 변경·커밋·push·PR·배포는 수행하지 않았다.
