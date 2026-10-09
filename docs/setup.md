# Supabase 설정

## 전용 프로젝트와 인증

1. Supabase Dashboard에서 LifeInbox용 새 프로젝트를 만들어주세요. 기존 서비스 DB와 분리합니다.
2. Authentication → Sign In / Providers에서 이메일·비밀번호와 Confirm email을 켜주세요. 비밀번호 최소 길이는 8자로 설정해주세요.
3. Authentication → URL Configuration에서 Site URL을 `http://localhost:3000`, Redirect URL을 `http://localhost:3000/auth/confirm`으로 설정해주세요.
4. Authentication → Email Templates → Confirm signup의 링크를 아래와 같이 설정해주세요. SSR에서 토큰을 교환하고 세션 쿠키를 설정합니다. 기본 ConfirmationURL 템플릿도 같은 브라우저에서 `code`를 교환하는 PKCE 방식으로 처리합니다. 아래 템플릿은 다른 브라우저에서 링크를 열 때도 사용할 수 있습니다.

```html
<h2>LifeInbox에 오신 것을 환영합니다.</h2>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">이메일 인증하기</a></p>
```

5. 기본 SMTP는 Supabase 조직의 팀원 이메일에만 발송합니다. 이번 로컬 검증에서는 해당 본인 이메일을 사용해주세요. 발송 제한에 걸리면 잠시 기다려주세요. 일반 사용자 가입에는 custom SMTP를 설정해야 합니다.
6. JWT Signing Keys에서 비대칭 서명 키(ES256 또는 RS256)를 사용해주세요. API는 JWKS로 서명을 검증하며 기존 HS256 공유 비밀 방식은 지원하지 않습니다.

참고: [사용자 데이터](https://supabase.com/docs/guides/auth/managing-user-data), [이메일 발송](https://supabase.com/docs/guides/auth/auth-smtp), [JWKS](https://supabase.com/docs/guides/auth/jwts).

## 로컬 환경변수

`apps/web/.env.example`을 `apps/web/.env.local`로 복사하고 Project URL과 publishable key를 설정해주세요. 관리자 secret key는 프론트엔드에 넣지 않습니다.

`apps/api/.env.example`을 `apps/api/.env`로 복사하고 `SUPABASE_URL`, `MIGRATION_DATABASE_URL`을 설정해주세요. 연결값은 Dashboard → Connect → Session pooler의 실제 호스트·사용자 이름을 복사해주세요. IPv4를 지원하는 5432 포트를 사용합니다. 비밀번호의 특수문자는 URL 인코딩이 필요합니다. 예를 들어 `@`는 `%40`입니다.

처음에는 `DATABASE_URL` 예제 값을 그대로 두셔도 됩니다. 다음 명령이 스키마와 트리거를 만들고 실행 계정의 새 비밀번호를 생성하여 `DATABASE_URL`을 로컬 파일에 기록합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-db.ps1
```

설정 스크립트는 비밀번호를 출력하지 않습니다. 다시 실행하면 실행 계정의 비밀번호가 변경되므로 API를 재시작해주세요. 관리자 연결값은 마이그레이션에만 사용합니다. 앱 테이블의 소유자는 관리자이며 실행 계정 `lifeinbox_app`에는 RLS가 적용된 Item·Space·멤버·자동화 테이블의 필요한 작업만 허용하며 실행 기록은 조회·추가만 허용합니다. 앱 스키마를 Supabase Data API의 exposed schemas에 추가하지 않습니다.

## 실행과 실제 확인

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-dev.ps1
```

- 웹: http://localhost:3000
- API 문서: http://127.0.0.1:8000/docs
- API 준비 상태: http://127.0.0.1:8000/health

웹 접속과 인증 링크는 `localhost`로 통일해주세요. Origin 검사는 APP_URL과 일치해야 합니다. 환경변수를 변경하면 서버를 다시 시작해주세요.

본인 이메일로 가입 → 메일 링크 인증 → 개인 Inbox 확인 → 항목 생성·수정·완료 → 검색·Calendar 확인 → 새로고침 → 로그아웃·재로그인을 확인해주세요. 가입 직후 Default Personal Space와 Owner 멤버십이 각각 하나인지, `/health`가 `ok`인지도 확인해주세요. 이후 Personal Space는 여러 개 만들 수 있습니다. 다른 사용자의 항목은 읽거나 수정할 수 없어야 합니다.

## MCP로 연결하시는 경우

Supabase MCP는 개발자가 DB를 조회하고 마이그레이션을 적용하는 연결입니다. LifeInbox 앱 자체의 Auth·PostgreSQL 환경변수는 별도로 필요합니다. 전용 프로젝트에 범위를 지정해주세요. MCP로 이미 마이그레이션을 적용한 경우 Alembic과 중복 실행하지 않도록 적용된 SQL과 버전 기록을 확인하고 실제 적용된 revision으로 버전을 맞춘 뒤 실행 계정 설정을 진행합니다.

관리자 DB 비밀번호 없이 MCP로 실행 역할을 설정할 수도 있습니다. Dashboard의 Session pooler Host를 확인하고 다음 명령을 실행합니다.

```powershell
apps/api/.venv/Scripts/python scripts/prepare_mcp_connection.py --project-ref PROJECT_REF --pooler-host POOLER_HOST
```

스크립트는 `apps/api/.env`와 `.local/runtime-role.sql`을 만듭니다. SQL을 해당 전용 프로젝트에 MCP로 적용한 뒤 SQL 파일을 삭제해주세요. 두 파일은 Git에서 제외됩니다. 실제 실행에는 앱 전용 연결값만 필요합니다. 관리자 연결값 없이 `setup-db.ps1`을 실행할 필요는 없습니다. 이후 Alembic으로 변경할 때 관리자 연결값을 설정하고 현재 버전을 먼저 확인해주세요. 초기 0001 SQL만 적용되고 기록이 없다면 `alembic stamp 0001`을 실행한 뒤 `alembic upgrade head`로 확장합니다. 여러 SQL을 MCP로 적용했다면 실제 적용한 마지막 revision을 기록해야 합니다. 기존 0005 프로젝트를 0001로 stamp하지 마세요. 이 PC의 전용 프로젝트는 MCP로 0007까지 적용하고 버전도 0007로 기록했습니다.

MCP용 SQL에는 실행 비밀번호의 SCRAM 검증값만 포함됩니다. 원래 비밀번호는 로컬 `apps/api/.env`에만 저장하며, 채팅이나 MCP에 전달하지 않습니다.

## 설정 오류

설정이 없으면 웹에 연결 안내가 표시되고 API는 setup_required를 반환합니다. 관리자 DB 계정을 실행용으로 사용하면 준비 상태가 실패합니다. DB 연결 실패·인증 만료·입력 오류는 화면에서 안내하고 입력값은 유지합니다. 로그에는 비밀번호와 토큰을 기록하지 않습니다.


## 확장 스키마와 Worker

마이그레이션 순서는 0001 초기 MVP → 0002 다중 Space → 0003 자동화 → 0004 멤버 참조·권한 보완 → 0005 자동화 고도화 Phase 1 → 0006 스크린샷 OCR → 0007 일일 DB 헬스체크입니다. 기존 DB를 초기화하지 않습니다. 기존 Personal은 Default로 유지하며 Item ID·내용·시각을 보존합니다. 데이터 보존을 위해 0002–0006의 자동 downgrade는 제공하지 않습니다. 0007은 헬스체크 함수만 삭제하여 되돌릴 수 있습니다.

관리자 연결로 기존 프로젝트를 업데이트하려면 다음 명령을 사용하세요. 현재 PC의 프로젝트에는 0007까지 적용되어 있으므로 다시 적용할 필요가 없습니다.

```powershell
cd apps/api
uv run --frozen alembic current
uv run --frozen alembic upgrade head
```

MCP로 업데이트할 때에는 versions의 SQL을 revision 순서대로 apply_migration으로 실행하고, 성공한 마지막 revision과 app_migrations.alembic_version을 일치시킵니다. 관리자 권한은 마이그레이션에만 사용합니다.

`scripts/start-dev.ps1`은 웹·API·15초 주기의 알림 Worker를 함께 실행하고 종료 시 자신이 실행한 API·Worker를 정리합니다. 수동으로 각각 실행하면 API와 별도 터미널에서 `uv run --frozen python -m app.automation.scheduler.worker`도 실행해주세요. API·Worker 로그는 Git에서 제외한 .local에 기록합니다.

Spaces에서 여러 개인·공유 Inbox를 만들 수 있습니다. 공유 멤버 등록은 이미 가입된 사용자 ID를 사용합니다. Home·Inbox·Calendar·Search는 모든 접근 가능한 Space를 기본 조회하고 공간 필터를 제공합니다. 기본 Inbox를 삭제하려면 다른 Personal을 기본으로 지정하고 항목·자동화 참조를 먼저 옮겨주세요.

## GitHub Actions 일일 DB 헬스체크

0007은 `public.lifeinbox_healthcheck()` 함수만 추가합니다. 함수는 테이블에 접근하지 않고
`"ok"`만 반환합니다. `app` 스키마를 Data API에 공개할 필요가 없습니다.
현재 전용 Supabase 프로젝트에 이 함수를 적용하고 공개용 키를 사용한 실제 HTTP 호출을 확인했습니다.
GitHub의 변수·Secret과 기본 브랜치 설정은 [일일 헬스체크 안내](github-healthcheck.md)에 있습니다.
