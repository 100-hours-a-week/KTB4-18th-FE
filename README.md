# Meomuneum Frontend

Meomuneum 프로젝트의 웹 클라이언트입니다. React, TypeScript, Vite를 기반으로 사용자 화면을 개발하기 위한 초기 프로젝트입니다. 현재는 Vite 기본 예제 화면과 빌드·린트 설정이 준비되어 있으며 서비스 화면, API 연동 및 인증 흐름은 아직 구현되지 않았습니다.

## 기술 및 실행 환경

| 항목 | 버전 / 구성 |
| --- | --- |
| Node.js | `24.18.0` |
| npm | `11.16.0` |
| React / React DOM | `^19.2.8` |
| TypeScript | `~6.0.2` |
| Vite | `^8.3.0` |
| ESLint | `^10.10.0` |

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
현재는 AI 분석 연동 전으로 iTunes 검색 결과 1~5곡을 표시합니다.
입력 문장은 연속 추천을 위해 대화별로 저장되며, 검색 결과가 없거나 외부 서비스가 실패하면 입력 문장을 복구해 다시 전송할 수 있습니다.
