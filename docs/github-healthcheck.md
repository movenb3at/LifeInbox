# GitHub Actions 일일 DB 헬스체크

## 설계

PC가 꺼져 있어도 GitHub의 실행 환경에서 Supabase DB에 하루 한 번 HTTP 요청을 보냅니다.
실행 시간은 한국 시간 오전 9시 17분(UTC 00:17)입니다. 정각의 실행 집중을 피하도록 설정했습니다.
이 작업은 Supabase DB의 응답을 확인합니다. 로컬 Next.js·FastAPI·알림 Worker의 상태는 별도입니다.

```text
GitHub Actions (schedule / 수동 실행)
  → scripts/check_supabase_health.py
  → GET https://<project-ref>.supabase.co/rest/v1/rpc/lifeinbox_healthcheck
  → PostgreSQL의 public.lifeinbox_healthcheck()
  → JSON 문자열 "ok"
```

기존 `app` 스키마·테이블·RLS와 로컬 서버의 `/health`는 그대로 사용합니다.
새 DB 객체는 `public.lifeinbox_healthcheck()` 하나입니다. 인자 없이 고정 문자열만 반환하고
테이블·계정·환경변수에 접근하지 않습니다. `STABLE`, `SECURITY INVOKER`, 빈 `search_path`로
만들고 `PUBLIC`의 실행 권한을 회수한 후 `anon`·`authenticated`에 함수 실행만 허용합니다.
GET 호출은 PostgREST의 읽기 전용 트랜잭션으로 실행됩니다.

새 마이그레이션 `0007`은 기존 `0006` 다음에 적용합니다. 데이터나 기존 권한은 변경하지 않습니다.
되돌릴 때는 `alembic downgrade 0006`으로 이 함수만 삭제할 수 있습니다.

추가 파일:

- `.github/workflows/supabase-healthcheck.yml`: 하루 한 번의 예약 실행과 수동 실행
- `scripts/check_supabase_health.py`: 표준 라이브러리만 사용하는 HTTP 검사
- `apps/api/migrations/versions/0007_daily_healthcheck.py`와 `.sql`: DB 함수
- `apps/api/tests/test_healthcheck_script.py`: 실패·재시도·키와 URL 제한 검증

성공 조건은 HTTP 200과 JSON 문자열 `"ok"`가 모두 맞는 경우입니다. 요청 제한 시간은 20초,
네트워크 오류·408·429·일부 5xx는 최대 3회 시도하며 5초·10초 기다립니다.
키 오류·함수 미설치·예상 밖 응답은 즉시 실패합니다. 실패 시 Actions 실행도 실패 상태가 됩니다.
키·응답 본문·개인 데이터는 로그에 출력하지 않습니다.

## GitHub 설정

전체 프로젝트의 공개 저장소 `movenb3at/LifeInbox`에서 실행합니다.
소개 페이지 배포와 헬스체크는 서로 다른 워크플로이며, 헬스체크가 로컬 앱 서버를 실행하지는 않습니다.

워크플로 파일은 GitHub 저장소의 기본 브랜치에 있어야 합니다. 저장소의
Settings → Secrets and variables → Actions에서 아래 두 값을 설정해주세요.

| 구분 | 이름 | 값 |
| --- | --- | --- |
| Repository variable | `SUPABASE_URL` | Dashboard의 Project URL (`https://<project-ref>.supabase.co`) |
| Repository secret | `SUPABASE_PUBLISHABLE_KEY` | Dashboard → Settings → API Keys의 `sb_publishable_...` 공개용 키 |

현재 앱의 `apps/web/.env.local`에 있는 `NEXT_PUBLIC_SUPABASE_URL`과
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 값을 사용할 수 있습니다. 키를 채팅에 보내지 마세요.
헬스체크에는 DB 비밀번호·관리자 키·`service_role`·`sb_secret_...`이 필요하지 않습니다.
검사 스크립트는 공개용 키만 허용하며 다른 종류의 키는 전송하지 않습니다.

설정 후 Actions → Daily Supabase health check → Run workflow로 최초 실행을 확인해주세요.
녹색 완료 표시와 실행 요약의 `Supabase DB health check: passed`를 확인합니다.
GitHub 실행 요약에는 검사 시각(UTC), 성공 여부, 시도 횟수를 남깁니다.
자동 실행은 PC나 로컬 서버를 켜지 않아도 동작합니다.

예약 실행을 중지하려면 Actions에서 이 워크플로를 Disable workflow로 비활성화합니다.
이렇게 해도 앱·DB 데이터·로컬 서버의 사용에는 영향이 없습니다.

## 로컬 검증

프로젝트 루트에서 환경변수 `SUPABASE_URL`과 `SUPABASE_PUBLISHABLE_KEY`를 설정한 후 실행합니다.
스크립트 자체가 `.env.local`이나 관리자 연결값을 읽지는 않습니다.

```powershell
apps/api/.venv/Scripts/python scripts/check_supabase_health.py
cd apps/api
.venv/Scripts/python -m pytest tests/test_healthcheck_script.py
```

## 동작 범위와 운영 주의

Supabase 공식 안내는 최근 7일간 **충분한 사용자 DB 활동**을 기준으로 일시정지를 판단하며,
일반적으로 매일 몇 차례의 DB 요청이면 충분하다고 설명합니다. 이 설정은 요청한 대로 하루 한 번
검사하며 **무료 프로젝트의 일시정지 방지를 보장하지 않습니다**. Supabase의 경고 이메일을
확인하고, 중단 없이 제공해야 하는 서비스는 유료 플랜을 검토해주세요.

GitHub 예약 실행은 지정 시각보다 지연되거나 일부 실행이 누락될 수 있습니다.
공개 저장소는 저장소 활동이 60일 동안 없으면 예약 워크플로가 자동으로 비활성화될 수 있습니다.
비공개 저장소의 Actions 사용량은 계정에 포함된 실행 시간 한도를 확인해주세요.
이미 일시정지된 Supabase 프로젝트를 이 검사로 복구할 수는 없으며 Dashboard에서 Resume project가 필요합니다.

공식 문서:

- [Supabase Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase Database Functions](https://supabase.com/docs/guides/database/functions)
- [Supabase API Keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [PostgREST 읽기 전용 트랜잭션](https://docs.postgrest.org/en/stable/references/transactions.html)
- [GitHub Actions schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
