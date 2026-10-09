# 자동화 고도화 Phase 1 설계

사용자가 선택한 범위는 Phase 1입니다. 기존 인증, Item CRUD, 다중 Personal/Shared Space,
알림 스케줄러와 원본·실행 기록을 유지합니다. 요약 알림, 되돌리기, 학습 추천과 템플릿은 후속 범위입니다.

## 현재 구조 점검

- `item_candidates.inbound_event_id`의 UNIQUE 제약이 원본당 후보 하나를 강제합니다.
- 자동 저장은 전체 confidence만 검사하여 공간이나 날짜의 불확실성을 따로 판단하지 않습니다.
- 규칙의 nullable `space_id`만으로 전역/공간 범위를 구분합니다. Integration 범위가 없습니다.
- 우선순위가 같은 규칙은 생성 순서로 실행하며, 수집 트리거 사이에 필드 점유가 공유되지 않습니다.
- 무시 규칙은 후보 생성 뒤 실행됩니다. 검토 화면은 전체 수정 대화상자만 제공합니다.

## 추가 마이그레이션 0005

- 기존 후보의 ID, payload, original_payload, corrections, 상태, Item 참조와 시각을 보존합니다.
- 단일 UNIQUE를 `(inbound_event_id, candidate_index)` UNIQUE로 교체합니다. 기존 후보 index는 0입니다.
- `field_confidences`, `original_field_confidences`, `routing_source`, `routing_reason`을 추가합니다.
  필드별 값·신뢰도·근거·출처·모호함 여부를 저장합니다. 기존 값은 전체 신뢰도를 사용해 보수적으로 이관합니다.
- Rule에 `scope_type(global/space/integration)`과 `integration_id`를 추가합니다.
  기존 space_id는 유지하며 값이 있으면 space, 없으면 global로 이관합니다.
  Integration 참조는 `(integration_id,user_id)` FK로 다른 사용자의 경로를 차단합니다.
- 기존 RLS를 유지하고 규칙 범위 제약과 Integration 인덱스를 추가합니다.

## 처리 정책

1. 원본을 저장하고 발신자·제목·본문 등 분석 없이 판단 가능한 순수 ignore 규칙을 평가합니다.
   자동 실행 수준에서 일치하면 원본을 ignored로 남기고 후보·Item을 만들지 않습니다.
   분석 필드를 요구하거나 다른 Action과 혼합된 ignore 규칙은 기존 후보 단계에서 평가합니다.
2. 구조화 입력은 후보 하나, 명확한 줄/목록으로 구분된 입력은 최대 20개의 후보로 분석합니다.
   애매한 문장 경계는 분리하지 않으며 한 후보의 여러 날짜는 추측하지 않습니다.
3. 명시적 규칙 > Integration 기본 공간 > 분석의 공간 이름 제안 > 사용자 기본 Personal Space로 분류합니다.
   승인된 학습 패턴 계층은 향후 추가합니다. 분석 공간 제안은 보수적인 신뢰도로 검토를 요구합니다.
   접근권한을 잃은 Integration 목적지는 기본 공간으로 보존하고 공간 확인을 요구합니다.
4. 규칙은 priority 내림차순, space > integration > global 구체성, 생성 시각, ID 순입니다.
   후보 단계의 세 트리거를 한 번에 평가하고 동일 필드의 첫 변경을 유지합니다. 변경에 따른 재귀 실행은 없습니다.
5. 자동 저장에는 전체 및 값이 있거나 모호한 필드의 신뢰도가 모두 capture 기준을 충족해야 합니다.
   비어 있는 선택 필드는 차단하지 않습니다. 사용자가 직접 바꾼 필드는 신뢰도 1로 확인합니다.
   수동 추가는 확인 의사로 처리하며 최초 분석 결과와 수정 기록을 보존합니다.
6. 실패는 SAVEPOINT로 격리하고 원본을 남깁니다. 동일 external_id와 후보 index로 재시도 중복을 막습니다.
   Shared 공간의 작성 권한과 기존 Owner 규칙 위임 제한을 그대로 적용합니다.

## 화면과 검증

검토 카드에 확인할 필드와 개별 신뢰도, 공간 분류 근거를 표시하고 공간·종류를 바로 바꿀 수 있게 합니다.
규칙 편집에서 전역/공간/수집 경로 범위를 선택합니다. 원본 기록에서 분석 전 무시 여부를 확인합니다.
단위 테스트, 기존 후보·규칙 이관과 RLS 테스트, 실제 PostgreSQL API(최상위 트랜잭션 rollback),
데스크톱·모바일 브라우저, 타입·린트·빌드를 검증하고 실제 사용자 데이터의 마이그레이션 전후 해시를 비교합니다.
