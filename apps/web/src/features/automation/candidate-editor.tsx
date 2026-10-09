"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, type Candidate } from "@/lib/api/client";
import { currencies, localInput, types } from "@/lib/format";
import { useSpaces } from "@/features/spaces/shared";

export function CandidateEditor({ candidate, onClose, onSaved }: { candidate: Candidate; onClose: () => void; onSaved: () => Promise<void> }) {
  const [fields, setFields] = useState(candidate.payload); const [spaceId, setSpaceId] = useState(candidate.suggested_space_id);
  const [start, setStart] = useState(localInput(fields.start_datetime)); const [end, setEnd] = useState(localInput(fields.end_datetime));
  const [pending, setPending] = useState(false); const [error, setError] = useState(""); const { data: spaces } = useSpaces();
  async function save(e: React.FormEvent) {
    e.preventDefault(); setPending(true); setError("");
    try { await api(`automation/candidates/${candidate.id}`, { method: "PATCH", body: JSON.stringify({ fields: { ...fields, start_datetime: start ? `${start}:00+09:00` : null, end_datetime: end ? `${end}:00+09:00` : null }, suggested_space_id: spaceId }) }); await onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "후보를 수정하지 못했습니다."); }
    finally { setPending(false); }
  }
  return <Dialog open onOpenChange={value => { if (!value && !pending) onClose(); }} title="분석 후보 수정" description="수정한 내용은 향후 분석 개선에 사용할 수 있도록 원래 제안과 함께 기록합니다."><form onSubmit={save} className="compact-form">
    <label>제목<input required maxLength={200} value={fields.title} onChange={e => setFields({ ...fields, title: e.target.value })} /></label><label>설명<textarea rows={3} maxLength={10000} value={fields.description || ""} onChange={e => setFields({ ...fields, description: e.target.value })} /></label>
    <label>저장 공간<select value={spaceId} onChange={e => setSpaceId(e.target.value)}>{spaces?.filter(s => s.role !== "viewer").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <div className="form-grid"><label>종류<select value={fields.type} onChange={e => setFields({ ...fields, type: e.target.value as Candidate["payload"]["type"] })}>{Object.entries(types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>마감일<input type="date" value={fields.deadline || ""} onChange={e => setFields({ ...fields, deadline: e.target.value || null })} /></label></div>
    <div className="form-grid"><label>일정 시작<input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label><label>일정 종료<input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></label></div>
    <div className="form-grid"><label>금액<input type="number" min="0" step={["KRW", "JPY"].includes(fields.currency || "KRW") ? "1" : "0.01"} value={fields.amount || ""} onChange={e => setFields({ ...fields, amount: e.target.value || null })} /></label><label>통화<select value={fields.currency} onChange={e => setFields({ ...fields, currency: e.target.value as Candidate["payload"]["currency"] })}>{currencies.map(currency => <option key={currency}>{currency}</option>)}</select></label></div>
    {error && <p className="error-banner" role="alert">{error}</p>}<Button type="submit" disabled={pending}>{pending ? "저장 중…" : "후보 저장"}</Button>
  </form></Dialog>;
}
