# 자동화 계층 설계

현재 구현에는 [고도화 Phase 1](automation-phase-one.md)이 적용되어 있습니다. 아래 기본 구조에 필드별 신뢰도·다중 후보·규칙 범위·분석 전 무시를 추가했습니다.

기존 인증·Item 모델·수동 CRUD에 Automation MVP 1을 추가합니다. 후보 확인 화면, 수동 공유 Integration, 앱 내 알림 전달 Worker까지 제공합니다. Email/Calendar OAuth·백그라운드 동기화, AI 분석, 자연어 규칙, 추천 학습은 후속 단계입니다. 다중 Inbox의 모델·권한·마이그레이션 점검은 [Space 점검 문서](spaces-audit.md)를 참고해주세요.

## 구조

`apps/api/app/automation/` 안의 integrations, parsing, rules, scheduler를 분리합니다. 수집·정규화·후보 처리는 AutomationService가 조정합니다. Integration은 공통 NormalizedContent를 반환하고, 파서는 Item을 저장하지 않고 ParsedCandidate만 반환합니다. RuleEngine은 검증된 Action을 적용합니다. API는 기존 JWT·트랜잭션 의존성과 RLS를 사용합니다.

```text
원본 수집 → InboundEvent 저장 → 정규화 → 분석 전 무시 → Parser → ItemCandidates
  → AND 조건과 우선순위 규칙 → 후보 확인 또는 자동 저장
  → Item 생성·수정 규칙 → 예약 알림
각 단계의 원본·결정 근거·실패는 DB에 보존
```

## DB와 권한

기존 6개 테이블을 보존하고 Alembic 0003에 다음 7개 테이블을 추가합니다. 0002는 다중 Space 전환, 0004는 공유 멤버 제거와 실행 기록 권한 보완입니다.

| 테이블 | 역할·중복 방지 |
| --- | --- |
| automation_settings | 사용자별 수준·임계값. 기본 suggest / 자동 저장 0.95 / 확인 권장 0.70 |
| integrations | 사용자·provider 고유, 목적지 설정·credentials_reference. 실제 비밀 값은 저장하지 않음 |
| inbound_events | 원문·정규화 JSON·실패·시도 횟수. 사용자·Integration·external_id 고유 |
| item_candidates | Item 필드, 원래 분석 값, 신뢰도·근거·수정 전후·연결 Item. 이벤트·candidate_index 고유, 이벤트당 여러 후보 |
| automation_rules | 버전 1, AND 조건·Action·우선순위·활성 여부·global/space/integration 범위 |
| automation_runs | 조건 결과·입출력·오류·실행 시각. 사용자·실행 키 고유 |
| notifications | 앱 내 알림·예약 시각·읽음·취소. 사용자·중복 방지 키 고유 |

RLS는 수집·후보·설정·알림을 사용자별로 격리합니다. 이벤트·규칙 참조에는 같은 사용자 복합 FK를 적용합니다. Item 대상은 접근 가능한 Personal/Shared 공통 Space이며 생성·이동 시 작성 권한을 검사합니다. 담당자는 해당 Space의 Owner/Member여야 합니다.

개인 후보는 Shared에 저장할 예정이어도 다른 멤버에게 노출하지 않습니다. Shared에 범위를 지정하는 규칙은 Owner만 관리합니다. Member가 Shared 항목을 작성·수정하면 해당 Space Owner의 명시적 범위 규칙만 실행하며 Owner의 전체 개인 규칙은 적용하지 않습니다. 이 실행 기록은 Owner와 해당 작업자에게만 보입니다. 작업자가 Space 권한을 잃으면 기록도 숨깁니다. Owner 규칙으로 Member의 항목을 옮길 때에는 작업자도 목적지에 쓸 수 있어야 합니다.

## 동작 정책

- 입력은 본문 붙여넣기와 선택적 구조화 필드입니다. source_type의 email/calendar/webhook은 원문 출처 표시이며 외부 계정과 연결하지 않습니다. 한국어 날짜·금액·종류를 결정론적으로 추출하고 모호한 값은 비워둡니다. AI 분석이나 학습된 확률로 표현하지 않습니다.
- suggest는 후보를 유지하고 분류를 제안합니다. auto_capture는 전체 및 값이 있거나 모호한 필드의 신뢰도가 모두 임계값을 충족하는 후보를 자동 저장합니다. auto_action은 저장과 활성 규칙에 따른 Item 변경·알림·무시까지 적용합니다. 자동 저장 기준에 미달하는 후보와 원문도 보존합니다. 자동 저장 기준보다 낮거나 모호한 필드를 검토 화면에 표시하고 저신뢰 후보를 삭제하지 않습니다. review_threshold보다 낮은 전체 신뢰도에는 원문 확인 사유를 표시합니다.
- 목적지는 명시적 Rule → Integration 기본 공간 → 분석 공간 제안 → 사용자 Default Personal 순서입니다. 낮은 공간 신뢰도는 검토를 요구합니다. 후보의 자동 저장 결정도 수준·임계값·이유를 실행 기록에 남깁니다.
- Rule은 높은 priority, 같은 priority는 space > integration > global 구체성, 생성 시각·ID 순입니다. 후보 수집 단계의 세 Trigger를 함께 평가하며 각 필드의 첫 Action이 우선하고 이후 충돌은 건너뜁니다. 조건은 Trigger 시작의 스냅샷으로 비교합니다. 분석 없이 판단 가능한 순수 ignore는 후보 생성 전에 원본을 ignored로 기록합니다. 분석 필드나 혼합 Action이 필요한 ignore는 후보 처리를 종료합니다.
- 지원 Trigger: inbound_received, candidate_created, item_created, item_updated, deadline_approaching, integration_sync. integration_sync는 현재 수동 Integration 수집 시 발생합니다. deadline_approaching은 서울 기준 오늘부터 7일 이내의 활성 항목을 하루 단위로 평가합니다.
- 지원 Action: create_item, move_to_space, assign_user, set_type, set_deadline, create_notification, archive, ignore, complete_item. 외부 전송·결제·영구 삭제는 요청 스키마에서 거부합니다.
- 후보 수락은 행 잠금으로 직렬화하고 연결 Item을 재사용합니다. 같은 external_id의 재수집은 원문을 덮어쓰지 않습니다. external_id가 없으면 입력 JSON의 해시를 사용합니다. Rule 실행·알림도 고유 키로 중복을 막습니다.
- Rule별 savepoint로 실패한 규칙의 변경을 되돌리고 실패 기록을 남깁니다. 수집 처리 실패는 원본·시도 횟수를 남기며 재시도할 수 있습니다. 후보 수정은 원래 분석 값과 before/after를 보존합니다.
- 수동 CRUD의 Hook은 자동화 설정이 있는 사용자만 평가하고 Action은 Hook을 재귀 호출하지 않습니다. 자동화 설정·규칙 없이 기존 수동 기능을 사용할 수 있습니다.
- 날짜 기반 알림은 Asia/Seoul, 마감일 오전 9시 또는 일정 시작이 기준입니다. 날짜가 없는 0일 알림은 즉시 전달합니다. 날짜·상태·공간 변경 시 이전 예약을 취소·재평가하며 완료·보관·삭제 항목의 예약은 취소합니다.
- Worker는 15초마다 DB 예약을 처리합니다. 사용자별 advisory lock과 FOR UPDATE SKIP LOCKED로 중복 처리를 막습니다. 앱 내 알림만 전달하며 서버 중단 중에는 전송하지 않고 재시작 후 저장된 예약을 재개합니다.
- 공유 권한을 잃어도 개인 후보의 무시·오래된 알림 취소는 허용합니다. 멤버 제거 시 Item·후보는 유지하고 담당자 참조만 해제합니다.
- Worker의 비공개 SECURITY DEFINER 함수는 사용자 ID 목록만 반환합니다. PUBLIC 실행 권한을 취소하고 runtime 역할만 호출합니다. 데이터 처리는 사용자 트랜잭션과 일반 RLS를 사용합니다.

## API와 화면

`/api/v1/automation/`에 settings, integrations/destination, events/retry, candidates/edit/accept/reject, rules, runs, summary, tick를 제공합니다. `/api/v1/notifications`는 목록·읽음 처리입니다. Space 관리는 `/api/v1/spaces`이며 기존 `/me/space`는 Default Personal을 반환합니다.

`/automation`의 수집·확인, 규칙, 실행 기록, 알림, 설정 탭에서 사용할 수 있습니다. Item 화면의 기존 동작을 유지하며 공간 선택·이동·복사를 추가했습니다. Space 필터가 없는 Inbox·Home·Calendar·Search는 모든 접근 가능한 공간을 통합합니다.

검증 범위와 실제 DB 보존 결과는 [검증 기록](verification.md)에 있습니다.
