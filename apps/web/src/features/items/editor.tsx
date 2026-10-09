"use client";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api, type Item, type ItemCreate } from "@/lib/api/client";
import { currencies, localInput, statuses, types } from "@/lib/format";
import { useSpaces } from "@/features/spaces/shared";

export function ItemEditor({ item, initialSpaceId, onClose, onSaved }: { item?: Item; initialSpaceId?: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { data: spaces } = useSpaces(); const [spaceId, setSpaceId] = useState(item?.space_id || initialSpaceId || "");
  const targetSpaceId = spaceId || spaces?.find(s => s.is_default)?.id;
  const selectedSpace = spaces?.find(s => s.id === targetSpaceId);
  const readOnly = Boolean(item && spaces?.find(s => s.id === item.space_id)?.role === "viewer");
  const [title, setTitle] = useState(item?.title || ""); const [description, setDescription] = useState(item?.description || "");
  const [type, setType] = useState<ItemCreate["type"]>(item?.type || "other"); const [deadline, setDeadline] = useState(item?.deadline || "");
  const [start, setStart] = useState(localInput(item?.start_datetime)); const [end, setEnd] = useState(localInput(item?.end_datetime));
  const [amount, setAmount] = useState(item?.amount || ""); const [currency, setCurrency] = useState<ItemCreate["currency"]>(item?.currency || "KRW");
  const [expanded, setExpanded] = useState(Boolean(item)); const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const [status, setStatus] = useState<Item["status"]>(item?.status || "inbox");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (end && (!start || end <= start)) { setError("종료 시각은 시작 시각 이후여야 합니다."); return; }
    if (amount !== "" && ["KRW", "JPY"].includes(currency || "KRW") && !/^\d+$/.test(String(amount))) { setError("원화와 엔화는 정수로 입력해주세요."); return; }
    setPending(true);
    const body = { title: title.trim(), description, type, deadline: deadline || null,
      start_datetime: start ? `${start}:00+09:00` : null, end_datetime: end ? `${end}:00+09:00` : null,
      amount: amount === "" ? null : String(amount), currency, ...(targetSpaceId ? { space_id: targetSpaceId } : {}) };
    try { await api(item ? `items/${item.id}` : "items", { method: item ? "PATCH" : "POST", body: JSON.stringify(item ? { ...body, status } : { ...body, source_text: title }) }); await onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했습니다."); }
    finally { setPending(false); }
  }
  async function copy() {
    if (!item || !targetSpaceId) return; setPending(true); setError("");
    try { await api(`items/${item.id}/copy`, { method: "POST", body: JSON.stringify({ space_id: targetSpaceId }) }); await onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "복사하지 못했습니다."); }
    finally { setPending(false); }
  }
  return <Dialog open onOpenChange={value => { if (!value && !pending) onClose(); }} title={item ? "항목 수정" : "무엇을 기억할까요?"} description={item ? "필요한 정보를 수정해주세요." : "지금은 제목만 적으셔도 됩니다. 자세한 내용은 나중에 정리하세요."}>
    <form onSubmit={submit} className="item-form"><label>저장 공간<select aria-label="저장 공간" value={spaceId} onChange={e => setSpaceId(e.target.value)}><option value="">기본 Inbox</option>{spaces?.filter(s => s.role !== "viewer" || s.id === item?.space_id).map(s => <option key={s.id} value={s.id}>{s.name}{s.type === "shared" ? " · 공유" : ""}</option>)}</select></label>
      {readOnly && <p className="caption">이 공간은 읽기 전용입니다. 다른 공간에 복사할 수 있습니다.</p>}
      <label>제목<input autoFocus required readOnly={readOnly} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="예: 10월 17일까지 수행평가 제출" /></label>
      <button type="button" className="expand-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>상세 정보 {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
      {expanded && <div className="detail-fields"><label>설명<textarea rows={3} maxLength={10000} value={description} onChange={e => setDescription(e.target.value)} placeholder="알아두면 좋은 내용을 적어주세요." /></label>
        <div className="form-grid"><label>종류<select aria-label="종류" value={type} onChange={e => setType(e.target.value as ItemCreate["type"])}>{Object.entries(types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>마감일<input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} /></label></div>
        {item && <label>상태<select aria-label="상태" value={status} onChange={e => setStatus(e.target.value as Item["status"])}>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
        <div className="form-grid"><label>일정 시작 <span className="caption">서울 시간</span><input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label><label>일정 종료<input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></label></div>
        <div className="form-grid amount-grid"><label>금액<input type="number" min="0" max="999999999999.99" step={["KRW", "JPY"].includes(currency || "KRW") ? "1" : "0.01"} value={amount} onChange={e => setAmount(e.target.value)} placeholder="선택 사항" /></label><label>통화<select aria-label="통화" value={currency} onChange={e => setCurrency(e.target.value as ItemCreate["currency"])}>{currencies.map(value => <option key={value}>{value}</option>)}</select></label></div>
        {item?.source_text && <div className="source-preview"><span className="caption">처음 저장한 내용</span><p>{item.source_text}</p></div>}
      </div>}
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="dialog-footer"><span className="caption">{selectedSpace?.name || "기본 Inbox"} · {selectedSpace?.type === "shared" ? "공유 공간" : "나만 보기"}</span><Button type="submit" disabled={pending || !title.trim() || readOnly}>{pending ? "저장 중…" : "저장"}</Button></div>
      {item && targetSpaceId && targetSpaceId !== item.space_id && selectedSpace?.role !== "viewer" && <Button type="button" variant="outline" disabled={pending} onClick={copy}>선택 공간에 복사</Button>}
    </form>
  </Dialog>;
}
