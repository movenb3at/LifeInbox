export const triggers = { inbound_received: "정보가 수집되면", candidate_created: "분석 후보가 만들어지면", item_created: "항목이 만들어지면", item_updated: "항목이 수정되면", deadline_approaching: "마감이 다가오면", integration_sync: "연결 정보가 수집되면" };
export const conditionFields = { source_type: "정보 출처", sender: "발신자", sender_domain: "발신자 도메인", title: "제목", text: "본문", type: "종류", status: "상태", confidence: "신뢰도", amount: "금액", space_id: "저장 공간 ID", delivery_status: "배송 상태" };
export const operators = { equals: "같음", contains: "포함", greater_than: "초과", greater_or_equal: "이상", less_than: "미만" };
export const actionTypes = { create_item: "기준을 충족하면 항목 추가", move_to_space: "저장 공간으로 분류", assign_user: "담당자 지정", set_type: "종류 변경", set_deadline: "마감일 지정", create_notification: "앱 내 알림 생성", archive: "보관", ignore: "후보 무시", complete_item: "완료 처리" };
export const levels = { suggest: "확인 후 추가", auto_capture: "기준을 충족하면 자동 저장", auto_action: "자동 저장 및 규칙 실행" };
