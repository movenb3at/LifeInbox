# LifeInbox

나에게 들어온 정보를 한곳에 모으고, 잊지 않고 처리하는 개인 생활 Inbox입니다.

MVP 1: 이메일 인증 가입·로그인, 개인 Space 자동 생성, Item CRUD·완료·보관, 11종 Type, 마감·일정, 6종 통화 금액, 한국어 검색, Dashboard, Calendar, 반응형 UI를 제공합니다. 금액은 통화별로 합산하며 환산하지 않습니다. 우선순위는 없습니다.

확장 구현: 여러 Personal/Shared Inbox, 기본 Personal 변경, 역할별 권한, 통합 조회와 공간 필터, Item 이동·독립 복사를 제공합니다. 기존 개인 Inbox와 항목은 유지합니다. 자동화에는 수동 원문 수집, 날짜·금액·종류 분석, 후보 확인·수정, 신뢰도 기준 자동 저장, AND 규칙·우선순위·자동 분류, 앱 내 알림과 실행 근거 기록이 포함됩니다. Item 우선순위와 자동화 Rule 우선순위는 별개입니다.

## 시작하기

이 PC에서 다시 실행할 때는 프로젝트 폴더의 `start-lifeinbox.cmd`를 더블클릭해주세요.
웹·FastAPI·알림 Worker를 함께 실행하며, Node/pnpm이 PATH에 없으면 Codex 내장 런타임을 찾습니다.
실행 창은 사용 중 열어두고, 종료할 때는 그 창에서 Ctrl+C를 눌러주세요.
이미 3000·8000 포트를 사용하는 서버가 있으면 새로 실행하지 않고 안내 메시지를 표시합니다.
접속 주소는 http://localhost:3000 입니다. 이 PC의 기존 DB·환경변수는 다시 설정할 필요가 없습니다.

필요한 도구는 Node.js 24, pnpm 11, Python 3.11 이상, uv입니다. Supabase 관리형 PostgreSQL을 사용하므로 로컬 Docker 설치는 필요하지 않습니다.

```powershell
pnpm install --frozen-lockfile
```

환경변수와 프로젝트 설정은 [Supabase 설정 안내](docs/setup.md)를 따라주세요.
MCP로 스키마를 적용한 프로젝트는 설정 안내에 따라 실제 적용된 버전과 Alembic 기록을 맞춰주세요. 이 PC의 전용 프로젝트에는 0007까지 적용되어 있으므로 DB 설정을 다시 실행할 필요가 없습니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-db.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start-dev.ps1
```

http://localhost:3000 에서 시작하실 수 있습니다. Supabase 설정 전에는 연결 안내가 표시됩니다. 실제 저장을 가짜 데이터나 브라우저 저장소로 대체하지 않습니다.

## 개발 구성

[구조와 DB 설계](docs/design.md)를 먼저 작성하고 구현했습니다. Next.js는 인증·화면·동일 출처 API 중계를, FastAPI는 비즈니스 로직을 담당합니다. API 계약은 [OpenAPI](docs/openapi.json)에 기록하며 생성된 TypeScript 타입을 사용합니다.

다중 Inbox 변경의 조사·보존 정책은 [Space 점검 문서](docs/spaces-audit.md), 자동화 수준과 처리 정책은 [자동화 설계](docs/automation-design.md)에 있습니다. `start-dev.ps1`은 웹·API와 알림 Worker를 함께 실행합니다.

```powershell
# API만 실행
cd apps/api
uv sync --frozen
uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000

# 별도 터미널에서 프로젝트 루트 기준 웹 실행
pnpm dev

# API와 별도 터미널에서 알림 Worker 실행
cd apps/api
uv run --frozen python -m app.automation.scheduler.worker
```

## 검증

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

Python 검증은 입력·금액·날짜·상태·API·JWT를 확인합니다. DB 테스트는 메모리 내 PostgreSQL 엔진 PGlite에 실제 마이그레이션을 적용하고 가입 트리거, FK·제약, RLS와 트랜잭션 컨텍스트를 확인합니다. 브라우저 테스트는 실제 Supabase 계정 없이 로컬 테스트 인증 서버와 API 응답 fixture로 데스크톱·모바일 사용 흐름을 검증합니다. 테스트용 인증 서버는 e2e에서만 실행하며 앱에는 인증 우회 기능을 넣지 않습니다. 이 PC의 Microsoft Edge를 사용합니다.

실제 Supabase 발송·네트워크·DB 연결 검증은 별도입니다. 연결 전 테스트 통과를 실제 서비스 통합 성공으로 표현하지 않습니다. 실행 결과는 [검증 기록](docs/verification.md)에 남깁니다.

Spaces 화면에서 개인·공유 공간을 만들고 기본 Inbox를 지정할 수 있습니다. Shared Owner는 이미 가입된 사용자의 ID로 Member/Viewer를 등록합니다. 이메일 초대와 Owner 이전은 제공하지 않습니다. Item 상세의 저장 공간을 변경해 이동하거나 선택 공간에 복사할 수 있습니다. 기본 Inbox는 다른 Personal을 기본으로 지정한 뒤, 항목과 자동화 참조가 없어야 삭제할 수 있습니다.

자동화의 초기 수준은 “확인 후 추가”입니다. 자동화 화면에서 원문을 붙여넣고 후보를 확인해주세요. 자동 저장은 “자동 저장” 수준과 신뢰도 기준을 설정한 후 적용되며, Item 변경·알림 규칙은 “자동 실행” 수준에서 적용됩니다. 기본 자동 저장 기준은 95%이므로 일반 텍스트의 보수적 분석 결과는 확인 대상으로 남을 수 있습니다.

Email/Calendar 계정 연결·자동 동기화, AI 분석·자연어 규칙·학습, 이메일·기기 푸시, 외부 결제, Update·첨부 화면, 공개 배포는 후속 범위입니다.

자동화 고도화 Phase 1에는 필드별 신뢰도·확인 근거, 카드에서 공간·종류 바로 수정,
한 원본의 여러 후보, 전역·공간·수집 경로 규칙 범위, 분석 전 무시가 포함됩니다.
자동 저장에는 전체와 개별 필드 기준을 함께 적용합니다. 분류는 명시적 규칙 → 수집 경로 기본값 →
분석 제안 → 기본 Personal 순서이며, 모호한 제안은 검토 목록에 남습니다.
명확히 구분된 행동을 한 줄씩 입력하면 최대 20개 후보를 만들며 문장 의미를 AI로 분석하지 않습니다.
동일 우선순위의 규칙은 공간 → 수집 경로 → 전역, 생성 순서로 적용합니다.
자세한 변경과 데이터 이관은 [Phase 1 설계](docs/automation-phase-one.md)를 참고해주세요.

자동화 → 수집·확인 화면에서 스크린샷을 선택·붙여넣기·끌어놓기로 가져올 수 있습니다.
무료 오픈소스 Tesseract.js가 브라우저에서 한국어·영어를 읽고 기존 파서가 후보를 만듭니다.
OCR 서비스 키와 별도 결제는 필요 없습니다. 처음 실행할 때 공식 한국어·영어 모델을 준비하며
이후 판독 파일은 앱에서 직접 제공합니다. 원본 이미지는 본인 계정의 비공개 DB에 보관됩니다.
PNG/JPEG/WebP, 한 파일 5 MiB·25백만 픽셀 이하, 본인 원본 최대 50개를 지원합니다.
스크린샷 후보는 원본의 날짜·금액을 확인한 뒤 추가해주세요. 판독 오류가 있어도 원본을
보관한 스크린샷 목록에서 재시도할 수 있습니다. 원본 삭제 시 텍스트와 기존 Item은 유지됩니다.
자세한 처리와 제한은 [OCR 설계](docs/ocr-design.md)에 있습니다. 최신 DB 마이그레이션은 `0007`입니다.

## GitHub Actions 일일 헬스체크

`.github/workflows/supabase-healthcheck.yml`은 매일 한국 시간 오전 9시 17분에
Supabase의 읽기 전용 DB 함수에 HTTP 요청을 보냅니다. PC와 로컬 서버를 켤 필요가 없습니다.
예약 실행은 GitHub 기본 브랜치에 파일을 올리고 Project URL 변수·공개용 키 Secret을 설정한 뒤 활성화됩니다.
로컬 파일만 준비한 상태에서는 자동 실행되지 않습니다. 별도의 작은 비공개 저장소에서도 사용할 수 있습니다.
설정과 일시정지 방지의 한계는 [일일 헬스체크 안내](docs/github-healthcheck.md)를 참고해주세요.
