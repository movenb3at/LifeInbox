# 프로젝트 공개와 GitHub Pages

## 공개 구성

전체 앱 소스는 `movenb3at/LifeInbox` 저장소에서 관리하고, 소개 페이지는
`https://movenb3at.github.io/LifeInbox/`에 정적 파일로 배포합니다.
GitHub Pages는 Next.js 서버, FastAPI, Supabase DB, 알림 Worker를 실행하지 않습니다.
앱 실행은 [설정 안내](setup.md)와 루트 README를 따라 별도로 준비합니다.

소개 페이지의 항목과 화면은 모두 합성 예시입니다. 실제 계정, 사용자 항목,
Supabase 연결값을 페이지에 넣지 않습니다. 3D 장면·접근성·성능 설계는
[소개 페이지 설계](landing-design.md)를 참고해주세요.

## 개발과 검증

Node.js 24와 pnpm 11을 설치한 뒤 프로젝트 루트에서 실행합니다.

```powershell
pnpm install --frozen-lockfile
pnpm landing:dev
```

개발 주소는 `http://127.0.0.1:5173/LifeInbox/`입니다.
프로덕션 결과와 브라우저 검증은 다음과 같습니다.

```powershell
pnpm landing:check
pnpm landing:build
pnpm test:landing
# 직접 확인할 때
pnpm landing:preview
```

미리보기 주소는 `http://127.0.0.1:4173/LifeInbox/`입니다.
Windows 브라우저 테스트는 설치된 Microsoft Edge를 사용합니다. CI에서는
Playwright Chromium을 설치합니다. 기존 앱의 검증은 `scripts/verify.ps1`로 별도 실행합니다.
소개 페이지 테스트는 기존 앱의 테스트 서버와 분리되어 있습니다.

Vite의 `base`는 `/LifeInbox/`입니다. 저장소 이름을 변경하면 `vite.config.ts`,
HTML의 정적 이미지 경로·메타데이터, 테스트의 URL을 함께 수정해주세요.
모션 감소 설정에는 SVG를 표시하며, WebGL이나 3D 파일 로딩 실패에도 같은 그림을 표시합니다.
본문과 탐색 링크는 HTML에 있어 JavaScript 없이도 사용할 수 있습니다.

## 배포

저장소 Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 설정합니다.
`.github/workflows/pages.yml`은 `main` 푸시와 수동 실행에서 검사·빌드·브라우저 테스트 후
`apps/landing/dist`만 업로드하고 배포합니다. PR에서는 검사와 빌드·테스트를 수행합니다.
공식 Actions와 pnpm 설정 Action은 커밋 SHA로 고정했습니다.
Pages·OIDC 쓰기 권한은 배포 job에만 있습니다. 빌드와 PR job에는 저장소 읽기 권한만 있습니다.

GitHub CLI로 워크플로 파일을 푸시하려면 계정 인증에 `workflow` 권한이 필요합니다.
키·토큰·DB 비밀번호를 소스나 채팅에 넣지 마세요.

## 공개 파일 기준

공개 대상은 앱 소스, 마이그레이션, 테스트, 문서, 실행 스크립트, 잠금 파일,
환경변수 예제입니다. `.gitignore`는 다음 파일을 제외합니다.

- `.env`, `.env.local`, 기타 실제 환경변수 파일 (`.env.example`은 포함)
- `node_modules`, `.venv`, Next.js/Vite 빌드 결과와 캐시
- 자동 생성되는 `apps/web/next-env.d.ts` (`pnpm typecheck`가 먼저 타입을 생성)
- `.local`, 테스트 결과와 로그, 로컬 보존 사본
- 내려받은 OCR 모델·Worker 파일 (`prepare:ocr`로 다시 준비)

커밋 전에는 공개할 경로 목록과 비밀값 검사 결과를 확인합니다. DB 연결용 비밀번호,
JWT Secret, Supabase 관리자 키와 실제 사용자 데이터는 포함하지 않습니다.
일일 헬스체크의 공개용 키도 소스 대신 GitHub Secret으로 설정합니다.

## 일일 헬스체크

같은 저장소에서 [일일 헬스체크 설정](github-healthcheck.md)을 적용합니다.
기본 브랜치의 `supabase-healthcheck.yml`은 매일 한국 시간 오전 9시 17분에 실행합니다.
설정 후 수동 실행으로 HTTP 요청과 DB 함수 응답을 먼저 확인합니다.

공개 저장소는 60일간 저장소 활동이 없으면 예약 워크플로가 비활성화될 수 있습니다.
하루 한 번의 검사와 실행 지연·누락 가능성을 고려해야 하며, Supabase의 일시정지 방지를
보장하지 않습니다. 실제 사용자 요청과 경고 이메일도 확인해주세요.

참고 문서:

- [Vite GitHub Pages 배포](https://vite.dev/guide/static-deploy.html#github-pages)
- [GitHub Pages 사용자 정의 워크플로](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub Actions 예약 실행](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
