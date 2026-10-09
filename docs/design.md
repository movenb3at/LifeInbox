# LifeInbox MVP 1 설계

구현 전에 확정한 설계입니다. 목표는 외부에서 들어온 생활 정보를 빠르게 수집하고 정리하는 개인 Inbox입니다.

이 문서는 초기 MVP 1의 기준 설계를 보존합니다. 현재 구현은 0002–0004에서 다중 Personal/Shared Space와 자동화를 추가했습니다. 사용자당 Personal 하나 제약·기본 공간만 조회하던 정책은 폐지됐습니다. 현재 구조·권한은 [Space 점검](spaces-audit.md)과 [자동화 설계](automation-design.md)가 우선합니다.

## 디렉터리 구조

```text
apps/web/src/
  app/          Next.js 페이지, 인증 콜백, API 중계
  components/   공통 UI, 레이아웃
  features/     auth, items, search, dashboard, calendar
  lib/          Supabase, API 타입·클라이언트, 날짜·금액
apps/api/
  app/api/      라우터, 사용자·트랜잭션 의존성
  app/core/     환경설정, JWT 검증, DB 연결
  app/models/   SQLAlchemy 모델
  app/schemas/  Pydantic 입력·출력
  app/services/ 비즈니스 로직
  app/repositories/ SQL 쿼리
  migrations/   Alembic 스키마, 가입 트리거, RLS
  tests/        단위·API·PostgreSQL 테스트
docs/           설계와 Supabase 설정
scripts/        Windows 실행·설정·검증·OpenAPI 생성
e2e/            데스크톱·모바일 Playwright 검증
```

## 아키텍처

브라우저 → Next.js 동일 출처 API 중계 → FastAPI → Service → Repository → PostgreSQL.

Next.js 16 / React / TypeScript / Tailwind CSS / shadcn 방식의 Radix UI 컴포넌트,
Python 3.11 / FastAPI / Pydantic / SQLAlchemy 2 / psycopg 3 / Alembic을 사용합니다.
프론트엔드 타입은 FastAPI OpenAPI에서 생성합니다. 관리자 DB 연결과 앱 실행 연결을 분리합니다.

## DB 스키마

앱 테이블은 Supabase Data API에 노출하지 않는 `app` 스키마에 둡니다.
Alembic 버전 기록은 별도의 비공개 `app_migrations` 스키마에 저장합니다. 실행 계정에는 해당 스키마 접근 권한이 없습니다.
ID는 UUID, 기록·일정 시각은 UTC TIMESTAMPTZ, 마감일은 DATE입니다.

| 테이블 | 필드 |
| --- | --- |
| users | id (auth.users FK), display_name, timezone, created_at, updated_at |
| spaces | id, name, type (personal/group), owner_id, created_at, updated_at |
| space_members | space_id + user_id (복합 PK), role (owner/member/viewer), joined_at |
| items | id, space_id, creator_id, assignee_id nullable, title, description, type, status, deadline, start_datetime, end_datetime, amount NUMERIC(14,2) nullable, currency, source_type, source_text, created_at, updated_at, completed_at |
| item_updates | id, item_id, user_id nullable, type, content, created_at |
| attachments | id, item_id, uploaded_by, file_name, mime_type, size_bytes, storage_bucket, storage_path, created_at |

개인 Space의 owner_id에는 partial unique index를 둡니다. 담당자는 (space_id, assignee_id) → space_members 복합 FK로 같은 Space에 소속되어야 합니다. items의 (space_id, status, deadline), (space_id, start_datetime), 하위 모델의 item_id에 인덱스를 둡니다. 종료 시각은 시작 시각 이후여야 합니다.

가입 트리거는 auth.users 신규 행에 대해 users, personal Space, owner 멤버십을 원자적으로 생성합니다. 트리거는 제한된 SECURITY DEFINER 함수이며 search_path를 비우고 완전한 테이블명을 사용합니다. 앱 역할에는 users/spaces/members 쓰기 권한이 없습니다. MVP 2용 모델을 만들어 두되 그룹, 담당자, Update, 업로드 API와 화면은 제공하지 않습니다.

## 접근 제한

Supabase SSR 쿠키를 사용하고 Next.js Proxy에서 세션을 갱신합니다. FastAPI는 JWKS를 이용해 서명(ES256/RS256), issuer, audience=authenticated, exp, sub, role을 검증합니다. 매 DB 트랜잭션 시작 시 검증된 sub를 `set_config('app.user_id', ..., true)`로 설정합니다. 트랜잭션 종료 시 설정이 사라집니다.

실행 계정 lifeinbox_app은 테이블 소유자도 BYPASSRLS 역할도 아닙니다. 모든 앱 테이블에서 RLS를 켜고 본인의 personal Space에 연결된 데이터만 접근하도록 합니다. Repository도 Space 범위를 지정합니다. Next.js 중계는 고정 API 경로만 허용하고 쓰기 요청의 Origin을 검증합니다. 인증 데이터는 no-store입니다. 토큰·비밀번호는 로그에 남기지 않습니다.

## 항목 정책

- Type: task, deadline, event, reservation, payment, delivery, purchase, return, document, note, other. 기본값 other.
- Status: inbox, todo, in_progress, completed, archived. 신규 상태 inbox. 완료 취소·보관 복원은 todo. completed_at은 완료 시 기록하고 활성 상태로 돌아가면 제거합니다. 완료 항목 보관 시 이력은 유지합니다.
- 제목 1~200자, 설명·원문 최대 10,000자. 날짜·금액 등 부가 입력은 선택 사항입니다.
- 금액은 0 이상 999,999,999,999.99 이하이며 JSON에서 decimal 문자열로 전달합니다. KRW/JPY는 정수, USD/EUR/GBP/CNY는 소수 둘째 자리까지 허용합니다. 기본 통화 KRW. 환산 없이 통화별 합산합니다.
- 원문은 최초 입력을 보존하며 자동 추출은 구현하지 않습니다.
- 생성·수정 요청은 creator_id, space_id, assignee_id를 받지 않습니다. 서버가 인증된 개인 Space를 사용합니다.

## API와 화면

`/api/v1/me`, `/me/space`, `/items` GET/POST, `/items/{id}` GET/PATCH/DELETE, `/dashboard`, `/calendar?month=YYYY-MM`.
목록: q, status, type, page, page_size(최대 100). 응답: items, total, page, page_size. 정렬: created_at DESC, id DESC. 검색은 제목·설명·원문의 escaped ILIKE이며 기본적으로 완료·보관도 검색합니다. 사용자 범위 밖의 ID는 404, 인증 실패는 401, 검증 실패는 422입니다.

홈(/)은 Dashboard, /inbox는 상태별 리스트, /search는 검색, /calendar는 월별 달력입니다. 로그인·가입·인증 대기는 별도 화면입니다. 한국어 리스트 중심 UI, 데스크톱 사이드바·모바일 하단 내비게이션, 전역 빠른 입력을 제공합니다.

날짜는 Asia/Seoul, 주 시작은 월요일입니다. 오늘 항목은 마감일 또는 일정 구간이 오늘과 겹치는 활성 항목입니다. 지연은 마감일이 오늘 이전인 활성 항목입니다. 이번 주 마감은 월요일~다음 월요일 미만입니다. 이번 주 예정 결제는 오늘~다음 월요일 미만인 활성 payment이며 마감일, 없으면 일정 시작일을 사용합니다. 금액 없는 결제 건수를 별도 표시합니다.

Calendar는 보관 항목을 제외하고 완료 항목은 흐리게 표시합니다. 마감은 종일, 일정은 [start, end) 구간이며 종료가 없으면 시점 항목입니다. 마감과 일정은 별도 종류로 반환합니다. 월별 일정 조회는 월 경계를 넘는 구간도 포함합니다.

## 검증과 외부 설정

Next.js 빌드·타입·린트, Python 테스트, PostgreSQL 마이그레이션·RLS·가입 트리거 통합 테스트, Playwright 데스크톱·모바일 흐름을 검증합니다. DB 통합 테스트는 전용 테스트 DB에만 실행합니다. 실제 Supabase 연결과 본인 이메일 인증 성공은 별도로 기록합니다.

새 Supabase 프로젝트, publishable key, 관리자/앱 DB 연결이 필요합니다. 본인 이메일 인증은 기본 SMTP의 프로젝트 팀원 이메일 제한 안에서 검증합니다. 일반 이메일에는 custom SMTP가 필요합니다. 연결값 미설정 시 설정 안내를 제공하고 가짜 데이터로 성공 처리하지 않습니다.
