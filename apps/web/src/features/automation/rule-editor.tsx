"use client";
import useSWR from "swr";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, type Rule, type RuleInput, type Integration } from "@/lib/api/client";
import { types } from "@/lib/format";
import { useSpaces } from "@/features/spaces/shared";
import { actionTypes, conditionFields, operators, triggers } from "./labels";

export function RuleEditor({ rule, onClose, onSaved }: { rule?: Rule; onClose: () => void; onSaved: () => Promise<void> }) {
  const { data: spaces } = useSpaces();
  const { data: integrations } = useSWR<Integration[]>("automation/integrations", api);
  const [form, setForm] = useState<RuleInput>(rule || { name: "", description: "", trigger_type: "candidate_created", conditions: [{ field: "type", operator: "equals", value: "payment" }], actions: [{ type: "move_to_space", value: "", days_before: 0 }], priority: 0, is_enabled: true, version: 1, space_id: null, scope_type: "global", scope_id: null });
  const [pending, setPending] = useState(false); const [error, setError] = useState("");
  function condition(index: number, patch: Partial<NonNullable<RuleInput["conditions"]>[number]>) { setForm({ ...form, conditions: (form.conditions || []).map((entry, i) => i === index ? { ...entry, ...patch } : entry) }); }
  function action(index: number, patch: Partial<RuleInput["actions"][number]>) { setForm({ ...form, actions: form.actions.map((entry, i) => i === index ? { ...entry, ...patch } : entry) }); }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setPending(true); setError("");
    const body = { name: form.name, description: form.description, trigger_type: form.trigger_type, conditions: form.conditions, actions: form.actions, priority: form.priority, is_enabled: form.is_enabled, version: 1, scope_type: form.scope_type || "global", scope_id: form.scope_id || null, space_id: form.scope_type === "space" ? form.scope_id : null };
    try { await api(rule ? `automation/rules/${rule.id}` : "automation/rules", { method: rule ? "PATCH" : "POST", body: JSON.stringify(body) }); await onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "규칙을 저장하지 못했습니다."); }
    finally { setPending(false); }
  }
  return <Dialog open onOpenChange={value => { if (!value && !pending) onClose(); }} title={rule ? "자동화 규칙 수정" : "새 자동화 규칙"} description="조건과 처리 방법을 지정합니다. 발신자·본문에 대한 무시 규칙은 분석 전에 적용합니다."><form className="compact-form rule-form" onSubmit={save}>
    <label>규칙 이름<input required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
    <label>설명<textarea maxLength={2000} rows={2} value={form.description || ""} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
    <label>언제<select value={form.trigger_type} onChange={e => setForm({ ...form, trigger_type: e.target.value as RuleInput["trigger_type"] })}>{Object.entries(triggers).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <div className="form-grid"><label>규칙 범위<select aria-label="규칙 범위" value={form.scope_type || "global"} onChange={e => setForm({ ...form, scope_type: e.target.value as RuleInput["scope_type"], scope_id: null, space_id: null })}><option value="global">전체 입력</option><option value="space">저장 공간</option><option value="integration">수집 경로</option></select></label>
      {form.scope_type === "space" && <label>적용 공간<select aria-label="적용 공간" required value={form.scope_id || ""} onChange={e => setForm({ ...form, scope_id: e.target.value, space_id: e.target.value })}><option value="">선택해주세요</option>{spaces?.filter(s => s.role === "owner").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      {form.scope_type === "integration" && <label>적용 수집 경로<select required value={form.scope_id || ""} onChange={e => setForm({ ...form, scope_id: e.target.value })}><option value="">선택해주세요</option>{integrations?.map(integration => <option key={integration.id} value={integration.id}>{integration.provider === "manual_share" ? "수동 공유" : integration.provider === "screenshot" ? "스크린샷" : integration.provider}</option>)}</select></label>}
    </div>
    <h3>모든 조건이 일치하면</h3>
    {!form.conditions?.length && <p className="caption">조건이 없으면 이 시점의 모든 입력에 적용됩니다.</p>}
    {form.conditions?.map((entry, index) => <div className="rule-entry" key={index}><label>조건 {index + 1}<select aria-label={`조건 ${index + 1} 필드`} value={entry.field} onChange={e => condition(index, { field: e.target.value as typeof entry.field, operator: "equals" })}>{Object.entries(conditionFields).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>비교<select aria-label={`조건 ${index + 1} 비교`} value={entry.operator} onChange={e => condition(index, { operator: e.target.value as typeof entry.operator })}>{Object.entries(operators).filter(([key]) => ["amount", "confidence"].includes(entry.field) || ["equals", "contains"].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>값{entry.field === "type" ? <select value={entry.value} onChange={e => condition(index, { value: e.target.value })}>{Object.entries(types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : <input aria-label={`조건 ${index + 1} 값`} maxLength={300} value={entry.value} onChange={e => condition(index, { value: e.target.value })} />}</label><Button type="button" variant="ghost" size="sm" aria-label={`조건 ${index + 1} 제거`} onClick={() => setForm({ ...form, conditions: form.conditions?.filter((_, i) => i !== index) })}>제거</Button></div>)}
    <Button type="button" size="sm" variant="outline" disabled={(form.conditions?.length || 0) >= 16} onClick={() => setForm({ ...form, conditions: [...form.conditions || [], { field: "title", operator: "contains", value: "" }] })}>조건 추가</Button>
    <h3>처리 방법</h3>
    {form.actions.map((entry, index) => <div className="rule-entry action-entry" key={index}><label>처리 {index + 1}<select value={entry.type} onChange={e => action(index, { type: e.target.value as typeof entry.type, value: null, days_before: 0 })}>{Object.entries(actionTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {entry.type === "move_to_space" && <label>대상 공간<select required value={entry.value || ""} onChange={e => action(index, { value: e.target.value })}><option value="">선택해주세요</option>{spaces?.filter(s => s.role !== "viewer").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      {entry.type === "set_type" && <label>종류<select required value={entry.value || ""} onChange={e => action(index, { value: e.target.value })}><option value="">선택해주세요</option>{Object.entries(types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
      {entry.type === "set_deadline" && <label>마감일<input required type="date" value={entry.value || ""} onChange={e => action(index, { value: e.target.value })} /></label>}
      {entry.type === "assign_user" && <label>담당자 ID<input required value={entry.value || ""} onChange={e => action(index, { value: e.target.value })} /></label>}
      {entry.type === "create_notification" && <label>며칠 전<input type="number" min={0} max={365} value={entry.days_before || 0} onChange={e => action(index, { days_before: Number(e.target.value) })} /></label>}
      <Button type="button" size="sm" variant="ghost" disabled={form.actions.length <= 1} aria-label={`처리 ${index + 1} 제거`} onClick={() => setForm({ ...form, actions: form.actions.filter((_, i) => i !== index) })}>제거</Button></div>)}
    <Button type="button" size="sm" variant="outline" disabled={form.actions.length >= 12} onClick={() => setForm({ ...form, actions: [...form.actions, { type: "create_notification", days_before: 2 }] })}>처리 추가</Button>
    <div className="form-grid"><label>규칙 우선순위<input type="number" min={-10000} max={10000} value={form.priority || 0} onChange={e => setForm({ ...form, priority: Number(e.target.value) })} /></label><label>사용 여부<select value={form.is_enabled ? "yes" : "no"} onChange={e => setForm({ ...form, is_enabled: e.target.value === "yes" })}><option value="yes">사용</option><option value="no">중지</option></select></label></div>
    <p className="caption">우선순위가 높을수록 먼저 적용합니다. 동률이면 공간·수집 경로·전체 입력 순으로, 같은 범위에서는 먼저 만든 규칙을 적용합니다. 기존 항목의 자동 변경·알림은 자동 실행 수준에서 적용됩니다.</p>
    {error && <p className="error-banner" role="alert">{error}</p>}<Button type="submit" disabled={pending}>{pending ? "저장 중…" : "규칙 저장"}</Button>
  </form></Dialog>;
}
