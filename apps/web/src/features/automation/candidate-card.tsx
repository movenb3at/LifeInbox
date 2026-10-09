"use client";
import { Button } from "@/components/ui/button";
import { api, type Candidate } from "@/lib/api/client";
import { dueLabel, money, types } from "@/lib/format";
import { SpaceName, useSpaces } from "@/features/spaces/shared";
import { SourceImage } from "./source-image";

const fieldLabels: Record<string, string> = { title: "제목", type: "종류", deadline: "마감일", start_datetime: "일정 시작", end_datetime: "일정 종료", amount: "금액", currency: "통화", space: "저장 공간", assignee: "담당자", ocr: "이미지 판독" };

export function CandidateCard({ candidate, pending, onAction, onEdit, onChange }: {
  candidate: Candidate; pending: boolean;
  onAction: (operation: "accept" | "reject") => void; onEdit: () => void;
  onChange: (save: () => Promise<unknown>) => Promise<void>;
}) {
  const { data: spaces } = useSpaces();
  const editable = candidate.status === "pending";
  const fields = candidate.review_fields || [];
  return <article className="automation-panel">
    <div className="section-heading"><h3>{candidate.payload.title}</h3><span className="confidence">전체 신뢰도 {Math.round(candidate.confidence * 100)}%</span></div>
    {fields.length > 0 && <p className="review-reason">확인할 필드: {fields.map(field => fieldLabels[field] || field).join(" · ")}</p>}
    {candidate.review_reason && <p className="caption">{candidate.review_reason}</p>}
    <p className="item-meta"><SpaceName id={candidate.suggested_space_id} /><span>{types[candidate.payload.type || "other"]}</span>{candidate.payload.deadline && <span>{dueLabel(candidate.payload.deadline)}</span>}{candidate.payload.start_datetime && <span>{new Date(candidate.payload.start_datetime).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</span>}{candidate.payload.amount != null && <span>{money(candidate.payload.amount, candidate.payload.currency || "KRW")}</span>}</p>
    <p className="caption">{candidate.routing_reason}</p>
    {candidate.source_image_id && <SourceImage id={candidate.source_image_id} />}
    {editable && <div className="form-grid candidate-quick-edit">
      <label>저장 공간 변경<select aria-label={`${candidate.payload.title} 저장 공간 변경`} disabled={pending} value={candidate.suggested_space_id} onChange={e => onChange(() => api(`automation/candidates/${candidate.id}`, { method: "PATCH", body: JSON.stringify({ suggested_space_id: e.target.value }) }))}>
        {!spaces?.some(s => s.id === candidate.suggested_space_id && s.role !== "viewer") && <option value={candidate.suggested_space_id}>작성할 수 없는 공간</option>}
        {spaces?.filter(s => s.role !== "viewer").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>
      <label>종류 변경<select aria-label={`${candidate.payload.title} 종류 변경`} disabled={pending} value={candidate.payload.type || "other"} onChange={e => onChange(() => api(`automation/candidates/${candidate.id}`, { method: "PATCH", body: JSON.stringify({ fields: { type: e.target.value } }) }))}>{Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>}
    <details><summary>필드별 신뢰도·분석 근거</summary>
      <dl className="field-confidence-list">{Object.entries(candidate.field_confidences || {}).map(([field, entry]) => <div key={field}><dt>{fieldLabels[field] || field} · {Math.round(entry.confidence * 100)}%{fields.includes(field) && " · 확인 필요"}</dt><dd>{entry.reason}</dd></div>)}</dl>
      <ul>{candidate.explanations.map((reason, i) => <li key={i}>{reason}</li>)}</ul><p className="source-text">{candidate.payload.description}</p>
      {candidate.corrections.length > 0 && <p className="caption">사용자 수정 {candidate.corrections.length}회 기록</p>}
    </details>
    {editable && <div className="action-row"><Button size="sm" disabled={pending} onClick={() => onAction("accept")}>추가</Button><Button size="sm" variant="outline" disabled={pending} onClick={onEdit}>수정</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => onAction("reject")}>무시</Button></div>}
  </article>;
}
