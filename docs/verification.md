# 구현·마이그레이션 검증 기록

검증일: 2026-10-06. Windows, Node.js 24.19.0, pnpm 11.19.0, Python 3.11, Microsoft Edge 기준입니다. 초기 MVP 1 회귀 검증을 유지하면서 다중 Inbox, 자동화 고도화 Phase 1, 무료 브라우저 OCR을 검증했습니다.

## 최종 결과

| 항목 | 결과 |
| --- | --- |
| 백엔드 pytest | 60개 통과 |
| Ruff | 오류 없음 |
| TypeScript·ESLint | 통과, 오류·경고 없음 |
| Next.js 프로덕션 빌드 | 통과; /spaces·/automation 포함 |
| Playwright | 데스크톱 18개·모바일 18개, 총 36개 시나리오 통과 (전체 30개 + 추가 6개; 변경한 OCR 4개도 재검증) |
| 초기 DB 회귀 검사 | 0001 가입·FK·RLS·트랜잭션·한국어 검색 검사 통과 |
| 0001 → 0002 → 0003 → 0004 → 0005 → 0006 | 기존 행·시각·기록·후보 보존, 다중 Personal·후보, 기본 Inbox 보호, Shared 역할·규칙 범위·이미지 FK 검사 통과 |
| Alembic head SQL 신규 적용 | 빈 PostgreSQL에 0006까지 적용 성공; 신규 가입의 한글 이름·Default·Owner 생성 확인 |
| 실제 Supabase | 0006 적용, 새 이미지 테이블의 RLS·소유자 정책 확인 |
| 실제 PostgreSQL API | 기존 흐름 및 필드 신뢰도·다중 후보·범위 충돌·분석 전 무시·재시도 검사 통과 |
| 기존 사용자 데이터 | Item 1개·Space 1개: 기존 필드와 시각의 해시 동일 |
| 실행 서버 | 웹 3000·FastAPI 8000·알림 Worker를 최종 코드로 재시작 |

`scripts/verify.ps1`은 의존성 잠금 확인, 백엔드 검사, OpenAPI·타입 생성, PostgreSQL 검사, 브라우저 검사, 빌드를 순서대로 실행합니다. SQL 내보내기는 Python에서 UTF-8로 저장해 PowerShell의 한글 변환을 피하고 Alembic offline의 percent 이스케이프가 실제 SQL로 남지 않도록 구성했습니다. 생성한 SQL의 신규 적용도 검사합니다. 테스트용 Next.js는 .next-e2e를 사용합니다.

Starlette의 테스트용 httpx 사용에 대한 폐기 예정 경고 1건과 Playwright 실행 환경의 색상 변수 경고가 있으며 실패는 없습니다.

## 검증한 동작

기존 Item CRUD·완료·보관·복원·삭제, 저장 실패 시 입력 유지, 금액 문자열·통화별 정밀도, 날짜·다일 일정·서울 시간 경계, 결제 통화별 합계, 한국어 검색과 완료·보관 검색, Calendar 표시, 인증 대기·로그인·로그아웃, BFF Origin 검사를 유지했습니다. 인증 링크 처리 실패 시 이메일 만료라고 단정하지 않고 기존 계정 로그인도 안내합니다.

다중 Space DB 검사는 변경 전 Personal·Group·Item·Update 데이터를 만들고 0002 이후 기존 행의 ID·시각·내용과 관계를 비교했습니다. Personal 개수 제한은 제거했고 사용자별 Default 하나만 허용합니다. 기본 Inbox 변경·삭제 방지, 기본 해제만 하는 트랜잭션 거부, 추가 개인 공간의 외부 멤버 금지, 새 가입의 Default·Owner 자동 생성, 개인 격리, Shared Owner/Member/Viewer 읽기·쓰기와 이동 후 접근 차단을 확인했습니다. 공유 멤버 삭제 시 Item·후보를 보존하면서 담당자만 해제하며, 권한을 잃은 사용자는 공유 실행 기록을 읽지 못합니다. 개인 후보 무시와 오래된 알림 취소는 가능합니다.

자동화 검사는 한국어 날짜·금액·종류와 모호한 입력, AND 조건·Decimal 비교, 규칙 우선순위 충돌, 실행 상태의 success/failed/skipped 구분, Rule별 savepoint 실패 격리, 수집 중복·수락 재요청의 Item 재사용, 후보 원본·수정 전후 보존, 신뢰도 기준 자동 저장과 근거 기록, Rule → Integration → Default routing, 날짜 변경 시 알림 재예약, 제목 수정 시 예약 유지, 완료 시 예약 취소, 즉시 알림·읽음·Item 삭제 후 알림 기록 보존을 확인했습니다. 위험한 외부 전송·결제·삭제 Action과 잘못된 임계값은 422로 거부합니다. 동시 수락에 필요한 행 잠금·고유 키는 구현했으며 병렬 실제 Auth 요청 부하 검증은 수행하지 않았습니다.

브라우저는 여러 Personal 생성·Default 변경, 저장·이동·복사, 빈 선택의 기본 Inbox 복귀, 자동화 원문 수집·규칙 생성·후보 수정·수락·원문 보기, Integration 목적지 설정·해제, 실행 이유·알림 읽음, Shared Viewer의 읽기 전용 UI를 추가 검증했습니다. 데스크톱·모바일 가로 넘침도 검사했습니다. 브라우저 테스트는 로컬 인증 서버와 API fixture를 사용하며 실제 Supabase 저장 검증과 구분합니다.

PGlite는 PostgreSQL 엔진입니다. auth.users는 DB 테스트에서만 최소 모델을 사용하고 production 앱에는 테스트 인증 우회를 추가하지 않았습니다. 초기 0001의 단일 Personal 제약 검사는 과거 기준 회귀용이며, 현재 0005 검사에서는 여러 Personal 생성 성공을 검증합니다.

## 실제 Supabase 보존·API 검증

변경 전 데이터와 0005 및 실제 API 검증 후 데이터를 비교했습니다.

| 대상 | 변경 전/후 수 | 기존 필드 MD5 |
| --- | --- | --- |
| Item | 1 / 1 | c340e0a29d5d5baeabb2c85bbac82708 |
| Space | 1 / 1 | f109d20c8d9966260908165b51494b4d |

Space 비교에서는 새 is_default 컬럼만 제외하고 ID·이름·type·owner·기존 시각을 포함했습니다. 기존 개인 Inbox는 같은 ID로 is_default=true가 됐습니다. 사용자 “연결 확인” 항목은 그대로 남아 있습니다. 사용자 1명과 Default 1개를 유지했고 테스트 후 automation_settings·inbound_events는 0개입니다.

`scripts/verify_live_automation.py`는 실제 Session pooler와 production Router·Repository·Service를 사용했습니다. 테스트 프로세스의 repository 의존성에만 사용자 ID를 설정하고 각 요청을 savepoint로 실행한 뒤 최상위 트랜잭션을 rollback했습니다. 임시 Space·Item·규칙·수집·후보·알림 및 설정 변경은 모두 되돌렸습니다. 실제 JWT 검증이나 두 Auth 계정의 로그인 증거로 이 결과를 사용하지 않습니다. 다른 UUID 컨텍스트에서 개인 Item·후보 접근은 404이고 원문·알림 목록은 비어 있었습니다.

초기 MVP에서 실제 이메일 발송·인증·로그인·PostgreSQL 저장은 사용자 확인과 DB 기록으로 검증했습니다. 사용자는 “연결 확인” 항목을 저장하고 새로고침·로그아웃·재로그인 후 유지된다고 확인했습니다. 두 실제 Auth 계정의 로그인 토큰으로 Shared/교차 접근을 검증하는 단계는 수행하지 않았으며, 여러 사용자 PostgreSQL RLS 검사와 다른 UUID 실제 DB 검증을 통과했습니다.

## 권한·운영 점검

앱 테이블 소유자는 postgres이며 lifeinbox_app은 SUPERUSER·BYPASSRLS·상속·역할 생성·DB 생성 권한이 없습니다. 비공개 app 스키마에 필요한 작업만 부여하며 app_migrations에는 runtime 권한이 없습니다. Worker는 같은 제한된 역할을 사용합니다. 관리자 비밀번호·secret key를 프론트엔드나 Git에 넣지 않았고 로컬 연결값은 Git에서 제외했습니다.

0005 적용 후 Supabase 보안 점검에는 기존 Auth의 유출 비밀번호 보호 비활성화 WARN 1건과 비공개 버전 테이블의 정책 부재 INFO 1건만 있습니다. 이번 추가 테이블의 RLS·정책 누락은 없습니다. Auth 설정은 변경하지 않았습니다. [비밀번호 보호 설정](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [비공개 RLS 정책 점검 항목](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

앱 내 알림은 Worker 실행 중 전달하며 이메일·기기 푸시를 보내지 않습니다. 외부 Email/Calendar 계정 연결·동기화와 AI 분석은 후속 단계입니다. 현재 수집 입력은 원문 붙여넣기이며 종류·날짜·금액은 규칙 기반 제안입니다.


## Phase 1 추가 검증

- 높은 전체 신뢰도(.99) + 낮은 공간 신뢰도(.8)는 자동 저장하지 않고 space를 확인할 필드로 표시했습니다.
  공간·종류 수정은 해당 필드만 확인하고 최초 분석 신뢰도·payload와 수정 기록을 보존했습니다.
- 한 원본의 내일 제출·금요일 18시 회의는 두 후보와 독립 Item을 생성했습니다.
  원본 재처리·후보 재승인에서 기존 ID를 재사용했습니다.
- 같은 우선순위에서 공간 > 수집 경로 > 전역, 높은 priority에서 구체성보다 priority가 우선함을
  수집 단계의 서로 다른 Trigger 사이에서도 실제 DB에서 확인했습니다.
- 학교 발신자 → 학교 Personal, GitHub 출처 입력 → 개발 Personal, SnapPocket → Shared 분류를 확인했습니다.
  실제 외부 계정에서 이벤트를 가져오는 테스트는 아닙니다.
- 분석 최대치를 넘는 원본에 newsletter ignore를 적용하여 파서 호출 전에 ignored 처리하고 원본·실행 근거를 유지했습니다.
  ignore가 없는 최대치 초과 원본은 failed로 보존하고 재시도에서 attempts만 증가했습니다.
- PostgreSQL 이관 검사는 기존 accepted 후보의 모든 기존 필드·시각과 Item 참조를 그대로 비교했습니다.
  기존 공간 규칙을 space 범위로 이관하고, 후보 index 중복과 다른 사용자 Integration 참조를 거부했습니다.
- 브라우저에서 개별 신뢰도·확인 이유, 공간·종류 바로 수정, 경로 규칙의 중지·편집 및 공간 범위 전환을 확인했습니다.
  첫 실행의 4건은 새 select와 기존 텍스트의 선택자 중복 및 정확한 접근성 이름 문제였으며 수정 후 모두 통과했습니다.
- 실제 0005 적용 및 API 검증 후 Item 해시 `c340e0a29d5d5baeabb2c85bbac82708`,
  Space 전체 해시 `117985f375cdef7c72c0e09ca3b9dda1`이 변경 전과 같습니다. 임시 후보·규칙은 남지 않았습니다.

분석 값의 confidence는 결정론적 파서의 보수적인 점수이며 통계적으로 보정된 AI 확률이 아닙니다.
요약 알림·되돌리기·학습 추천·템플릿은 이번 Phase 1에 포함하지 않았습니다.

## 무료 스크린샷 OCR 검증

Tesseract.js 7.0.0·코어 7.0.0과 공식 tessdata_fast의 한국어·영어 모델을 사용했습니다.
모델은 고정 커밋 `87416418657359cb625c412a48b6e1d6d41c29bd`와 SHA-256으로 준비합니다.
맑은 고딕으로 만든 1200×360 테스트 이미지에서 다음 문장을 실제로 읽었습니다.

```text
학교 납부 안내
10월 20일까지 35,000원 입금해주세요.
```

Node 샘플 판독의 엔진 신뢰도는 92%였습니다. 이 값은 정확도 확률이 아니며 다른 이미지의
인식률로 일반화하지 않습니다. 한국어 날짜 `2026-10-20`, 금액 `35000`, 통화 KRW가 실제
API 분석에 연결되는 것을 확인했습니다. OCR 줄바꿈으로 제목과 본문이 두 후보로 분리되는
문제를 확인하고, 스크린샷은 문서 전체를 한 후보로 분석하도록 조정했습니다.

- 실제 브라우저 Web Worker가 로컬 Worker·WASM·kor/eng 모델을 사용했습니다.
  판독 중 외부 HTTP 요청이 없었고 데스크톱·모바일에서 후보·원본 미리보기·추가·삭제를 확인했습니다.
- 결과 저장 요청 실패 후에도 원본이 남고, 새로고침 후 원본 목록에서 재판독했습니다.
  클립보드 테스트는 실제 Ctrl+V와 동일한 ClipboardEvent/File 입력이며 OS 클립보드 조작은 아닙니다.
  첫 테스트 실패는 화면의 listener 준비 전에 이벤트를 보낸 것이었고, 준비를 기다린 후 통과했습니다.
- 한국어 모델 누락을 재현해 초기화가 무한 대기하지 않고 원본을 보존한 오류와 재시도를 제공함을 확인했습니다.
  OCR에는 2분 제한을 두고 화면 종료·시간 초과 시 종료와 안전한 실패 처리를 적용했습니다.
  자동화 설정 탭으로 전환해 판독 중단 후 실패 상태와 원본·재시도 버튼이 남는 것도 확인했습니다.
- Next.js 중계의 이미지 MIME·5 MiB 제한, 결과 JSON 200 KiB 및 일반 JSON 64 KiB 제한을 확인했습니다.
- 실제 Supabase에서 제한 DB 역할로 이미지 원본 응답과 private/no-store·nosniff,
  중복 업로드, 동시에 두 claim 거부, 오래된 claim 재발급 및 늦은 결과 거부를 확인했습니다.
- 자동 실행 수준과 자동 저장 기준 0에서도 스크린샷은 `ocr` 확인 필드 때문에 pending으로 남았습니다.
  직접 추가 후 재승인해도 같은 Item을 사용했습니다.
- 임의의 다른 UUID 컨텍스트에서 이미지 조회·판독·재시도·텍스트 수정·삭제는 404이고
  목록과 직접 RLS 조회는 비어 있었습니다. 두 실제 Auth 계정 로그인 테스트는 아닙니다.
- 파서 제한을 넘는 OCR 텍스트를 보존하고 필요한 텍스트만 선택해 분석을 복구했습니다.
  원본 수집 기록의 재시도도 이미지 경로를 사용하여 빈 원문을 분석하지 않습니다.
- 원본 삭제 후 이미지가 404이며 텍스트와 이미 추가한 Item은 유지되었습니다.
  같은 이미지 재업로드는 같은 기록을 복원하며 중복 후보를 만들지 않았습니다.

브라우저의 API 데이터는 fixture이며 OCR 자체는 실제 엔진입니다. 실제 DB API 검증은 별도로
`scripts/verify_live_ocr.py`에서 각 요청에 SAVEPOINT를 사용하고 최상위 트랜잭션을 롤백했습니다.
`scripts/verify_live_automation.py`도 새 스키마에서 통과하여 기존 공간·자동화 흐름을 확인했습니다.
0006 전후 및 최종 검사에서 Item은 1개, MD5 `14a0e6b32ba91aceae4f39cb59d84c72`,
Space 전체 MD5 `117985f375cdef7c72c0e09ca3b9dda1`로 동일하고 테스트 이미지 기록은 0개입니다.
이전 Phase 1 당시 Item 해시와 현재 해시는 서로 다른 시점의 값입니다.

0006의 Supabase 보안 점검에서 새 RLS·정책 누락은 없었습니다. 앞서 기록한 기존 Auth WARN과
비공개 마이그레이션 버전 테이블 INFO만 유지되었습니다.
최종 TypeScript·ESLint·Ruff와 프로덕션 빌드는 통과했습니다.

샘플 판독을 재현한 뒤 실제 DB 검사할 때는 다음 명령을 사용합니다. 사용자 ID는 앱의 본인 ID로 지정합니다.

```powershell
pnpm --filter @lifeinbox/web prepare:ocr
node scripts/recognize-ocr-sample.mjs
cd apps/api
uv run --frozen python ../../scripts/verify_live_ocr.py --user-id <본인-사용자-UUID>
```

## Windows 더블클릭 실행 파일 검증

`start-lifeinbox.cmd`를 실제 cmd.exe로 실행하여 명령어가 잘려 해석되는 오류를 재현했습니다.
UTF-8 한글·LF 줄바꿈을 사용하던 배치 파일을 ASCII·CRLF로 바꾸고 코드 페이지 변경을 제거했습니다.
PowerShell은 Windows 표준 실행 파일 경로로 호출하며 스크립트는 UTF-8 BOM·CRLF로 저장했습니다.
`.gitattributes`에 배치·PowerShell 파일의 CRLF 규칙을 추가했습니다.

Windows 사용자·시스템 PATH만 사용하는 환경에서 `cmd.exe /d /c start-lifeinbox.cmd`로 실제 실행했습니다.
Codex 내장 Node/pnpm 탐색, Python 잠금 의존성 확인, OCR 파일 준비와 Next.js Ready를 확인했습니다.
웹 응답 200, API health `ok`, 알림 Worker 실행을 확인했습니다.
기존 서버 실행 중에는 정상적인 포트 사용 안내가 나오며 명령어 잘림 오류가 발생하지 않았습니다.

## GitHub Actions 일일 DB 헬스체크 (2026-10-08)

GitHub 기본 브랜치에서 매일 UTC 00:17(한국 시간 09:17)에 실행하는 워크플로와
표준 라이브러리만 사용하는 HTTP 검사 스크립트를 추가했습니다. 수동 실행도 제공합니다.
공식 actionlint 1.7.12를 GitHub 릴리스 SHA-256으로 검증한 뒤 실행하여 워크플로 오류가 없음을 확인했습니다.
Ruff 검사와 전체 백엔드 테스트 82개(기존 60개 + HTTP 검사 22개)가 통과했습니다.
기존 Starlette/httpx 사용에 대한 의존성 폐기 예정 경고 1건이 있으며 이번 변경의 실패는 아닙니다.

PGlite에서 0001–0007의 순차 이관과 Alembic의 전체 SQL을 빈 DB에 적용했습니다.
이관 전후 Item·Space 값이 같고, 기존 Shared 권한·회원가입·RLS 흐름이 통과했습니다.
`anon`·`authenticated`는 헬스체크 함수를 실행할 수 있지만 앱 테이블은 읽을 수 없습니다.
별도 권한 없는 역할의 함수 실행은 거절됩니다. 함수의 SECURITY INVOKER·STABLE·빈 search_path도 확인했습니다.

전용 Supabase 프로젝트에 0007을 적용하고 Alembic 기록을 0007로 맞췄습니다.
2026-10-08 08:49:22 UTC에 현재 공개용 키로 실제 GET 요청을 보냈고
HTTP 200·JSON 문자열 `"ok"`를 받아 한 번의 시도로 성공했습니다.
이관 전후 Item 1개, MD5 `14a0e6b32ba91aceae4f39cb59d84c72`,
Space 1개, MD5 `117985f375cdef7c72c0e09ca3b9dda1`로 동일합니다.
`anon`·`authenticated`의 `app` 스키마 사용 권한은 모두 없습니다.

Supabase 보안 Advisor에서 이번 변경으로 추가된 경고는 없습니다. 기존
[Auth 유출 비밀번호 보호 WARN](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)과
[비공개 Alembic 버전 테이블의 RLS 정책 없음 INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)가 유지됩니다.

GitHub 원격 저장소 연결·업로드·변수/Secret 설정·GitHub 실행 결과는 아직 검증하지 않았습니다.
저장소 생성·커밋·푸시는 별도 승인 후 진행하며, 로컬 HTTP 성공을 예약 실행 활성화로 표현하지 않습니다.

## 3D 소개 페이지와 공개 준비 (2026-10-09)

소개 페이지 구조와 장면 설계를 먼저 `docs/landing-design.md`에 작성하고,
기존 앱과 별도로 `apps/landing`을 추가했습니다. DB 스키마와 앱 비즈니스 로직은 변경하지 않았습니다.
Three.js의 카드·수납 트레이·조명과 Anime.js v4 타임라인이 8개 구간을 연결합니다.
화면 예시는 합성 데이터이며 페이지에서 Supabase에 연결하지 않습니다.

최종 로컬 검증 결과:

- 소개 페이지 TypeScript·ESLint·Vite 프로덕션 빌드 통과
- 소개 페이지 Edge 브라우저 검사 21개 통과, 모바일의 데스크톱 포인터 검사 1개는 의도적으로 제외
- 정·역방향 스크롤의 실제 모델 위치, 빠른 이동·앵커 재로딩·창 크기 변경,
  포인터 반응, 320–1440px 수평 넘침, DPR 제한을 확인
- 모션 감소의 초기·실시간 변경, WebGL 초기화 실패·컨텍스트 손실·청크 로딩 오류,
  JavaScript 비활성화, 키보드 바로가기와 `/LifeInbox/` 이미지·링크 경로 확인
- 기존 FastAPI Ruff 및 백엔드 테스트 82개, 웹 타입·린트·프로덕션 빌드 통과
- 기존 앱의 데스크톱·모바일 브라우저 검사 36개 통과 (실제 OCR 엔진, API fixture)
- PGlite의 순차 마이그레이션·가입·제약·RLS·컨텍스트 격리와
  기존 데이터 이관·Shared 권한·헬스체크 RPC 검사 통과
- pnpm 11.19.0의 `--frozen-lockfile` 설치 재현 확인
- actionlint 1.7.12에서 Pages·일일 헬스체크 워크플로 통과

기존 Next.js 개발 캐시의 `routes.d.ts`에 중복 문법이 남아 첫 타입 검사가 실패했습니다.
해당 생성 캐시를 `.local`에 보존한 뒤 공식 `next typegen`으로 다시 준비하여 통과했습니다.
새 환경의 검사를 위해 웹 `typecheck` 명령은 타입 생성 후 `tsc`를 실행합니다.
자동 생성되는 `next-env.d.ts`는 공개 파일에서 제외합니다.

실제 Supabase 검증은 기존 제한 실행 역할과 SAVEPOINT·최상위 rollback으로 수행했습니다.
기존 자동화 Phase 1과 OCR API 검사가 통과했고, 검증 전후 Item 1개와 Space 1개의
MD5는 각각 `14a0e6b32ba91aceae4f39cb59d84c72`,
`117985f375cdef7c72c0e09ca3b9dda1`로 같았습니다. 임시 데이터와 설정 변경은 남기지 않았습니다.
이 결과는 두 실제 Auth 계정 로그인 검증을 대신하지 않습니다.
2026-10-09 14:41:31 UTC의 HTTP 헬스체크는 한 번의 요청으로 성공했습니다.

Vite는 지연 로딩하는 3D 청크가 500 kB를 넘는다고 경고합니다. 해당 청크는
약 538 kB, gzip 약 135 kB이고 본문·Anime.js 청크는 gzip 약 20 kB입니다.
3D 파일은 본문과 분리해서 로딩합니다. 기존 Starlette/httpx 폐기 예정 경고도 유지됩니다.
이 경고들은 검사·빌드 실패가 아닙니다.

공개 준비 시 실제 로컬 환경값 5개와 Supabase/GitHub 토큰·JWT·개인키 패턴을 검사했습니다.
환경 파일·비밀값·캐시·로컬 데이터·OCR 모델·빌드 산출물은 공개 대상에 없었습니다.
공개 예정 경로·해시는 `.local/public-source-audit.json`에 기록합니다.
GitHub 저장소 생성·커밋·푸시, Pages 실제 배포와 GitHub에서의 헬스체크 실행은
게시 승인 후 별도로 검증합니다. 이 문단의 결과는 로컬 공개 준비 완료를 의미합니다.
