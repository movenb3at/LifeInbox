# 다중 Space 점검 및 변경 설계

2026-10-05에 변경 전 코드와 실제 Supabase를 점검했습니다. 변경 전 DB는 사용자 1명, Personal Space 1개, Item 1개, Alembic 0001이었습니다. 다중 Space는 0002, 자동화는 0003, 공유 멤버 참조·권한 보완은 0004로 나누어 적용했습니다.

## 발견한 단일 Personal Space 가정

| 위치 | 현재 가정 | 변경 |
| --- | --- | --- |
| 0001 SQL·Space 모델 | `uq_personal_owner`: owner_id가 personal일 때 고유 | 기존 migration은 보존, 0002에서 제거. `is_default`에만 사용자별 부분 고유 인덱스 |
| User 모델 | personal_space_id 같은 단일 참조 없음 | User 컬럼은 유지, Space.is_default 사용 |
| 가입 트리거 | 개인 Inbox 1개 생성 | 생성 동작 유지, is_default=true 지정 |
| ItemRepository.personal_space | personal 첫 행 scalar 조회 | 명시적 default_space 조회 + 접근 가능한 Spaces 목록 |
| ItemService.get/create/update/delete | 기본 Space 안의 Item만 접근 | 대상 Space의 서버 권한 검사. 미지정 생성만 기본 Personal 사용 |
| Item 조회·ViewService | 기본 Space 하나에서 목록·Home·Calendar 조회 | 전체 접근 가능 Space 통합, 선택적 space_id 필터 |
| RLS spaces_personal·items_personal | 본인 personal만 노출, Shared 멤버 무시 | Personal owner 한정, Shared 멤버의 역할별 읽기·쓰기 |
| Shell·Inbox·Editor·Dashboard | 고정 개인 공간 명칭과 저장 위치 | Spaces 메뉴·공간 필터·항목의 Space 표시·저장/이동 선택 |
| 테스트·test-db.mjs | 두 번째 personal 생성 실패를 기대 | 여러 개인 공간·하나의 default·이관 전후 보존·역할별 접근 테스트 |
| 자동화 초안 | 대상 Space가 본인 소유만 가능, 분류 공간은 group | Personal/Shared 공통 대상, 쓰기 권한 검사, Rule→Integration→Default 순 |

Group 별도 Entity는 없으며 Space.type='group'만 있습니다. 기존 group 행은 같은 ID로 shared로 바꾸고 SpaceMember·Item 참조는 그대로 유지합니다.

## 마이그레이션 정책

- 기존 Personal Space의 ID·이름·멤버십·Item·기록을 보존하고 Default로 표시합니다. 생성·수정 시각도 backfill 중 보존합니다.
- 사용자당 Personal Space 수는 제한하지 않습니다. Default는 본인 Personal 하나만 허용하며 deferred 검사로 트랜잭션 종료 시 하나를 보장합니다.
- 기본 공간 변경은 본인의 Personal Space 행들을 ID 순으로 잠그고 기존 default 해제와 새 default 지정 후 commit합니다.
- Owner를 SpaceMember로 유지합니다. Personal에는 Owner 외 멤버를 DB trigger와 RLS로 금지합니다.
- Shared는 owner/member가 Item을 작성·수정·이동할 수 있고 viewer는 읽기만 가능합니다. Rule 생성·수정은 해당 Shared Owner만 허용합니다.
- 기본 Space는 삭제하지 못합니다. 초기 삭제 API는 비어 있는 Space만 허용합니다. 비어 있지 않으면 항목을 이동한 후 삭제하도록 안내합니다.
- Item 이동은 출발 공간의 쓰기·목적지의 쓰기를 모두 검사합니다. 담당자가 목적지 멤버가 아니면 해제합니다. 복사는 원본 읽기·대상 쓰기 권한을 확인하고 독립된 새 Item으로 만듭니다.
- 등록된 사용자 ID를 통한 Shared 멤버 추가·역할 변경을 제공하며 외부 초대 메일을 전송하지 않습니다.
- `/me/space`는 호환성을 위해 Default Personal을 반환합니다. 기존 저장 요청도 공간 미지정이면 Default로 저장됩니다.
- 0004는 공유 멤버 제거 시 Item·개인 후보를 삭제하지 않고 담당자 필드만 NULL로 바꿉니다. Viewer로 변경할 때도 Item 담당자를 해제하며, 후보 수락 시 담당자 권한을 다시 확인합니다.
- Shared Owner 규칙을 Member의 항목 작성으로 실행했다면 Owner와 해당 작성자가 기록을 볼 수 있습니다. 작성자가 Space 접근 권한을 잃으면 공유 실행 기록도 읽을 수 없습니다. 다른 멤버의 개인 수집·후보 기록은 공유하지 않습니다.

## 전후 검증

변경 전 Item 수·전체 행 digest, Space 수·기존 행 digest를 기록했습니다. migration 후 기존 Item digest와 기존 Space 필드·시각을 비교합니다. 새 가입의 Default 생성, 여러 Personal 생성, Default 변경·보호, 개인 격리, Shared owner/member/viewer 권한, 공간별·통합 조회, 이동·복사와 자동화 routing을 PostgreSQL 엔진·API·브라우저에서 검증합니다.

실제 DB의 기존 Item 1개와 Space 1개는 0004 및 API 검증 후에도 ID·내용·기존 시각을 포함한 digest가 변경 전과 일치했습니다. 기존 Space의 `is_default`만 true입니다. 실제 API 검증용 Space·Item·자동화 설정은 최상위 트랜잭션을 rollback하여 남기지 않았습니다. 자세한 결과는 [검증 기록](verification.md)에 있습니다.
