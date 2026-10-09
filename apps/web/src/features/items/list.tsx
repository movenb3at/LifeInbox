"use client";
import { useState } from "react";
import { Archive, ArchiveRestore, Check, Circle, Inbox, MoreHorizontal, Trash2 } from "lucide-react";
import { api, type Item } from "@/lib/api/client";
import { dueLabel, money, statuses, timeLabel, types, seoulDate } from "@/lib/format";
import { useItemEditor } from "./provider";
import { Button } from "@/components/ui/button";
import { SpaceName, useSpaces } from "@/features/spaces/shared";
import { Dialog } from "@/components/ui/dialog";

export function Loading() { return <div className="loading" role="status" aria-label="불러오는 중">{[1, 2, 3].map(i => <div className="skeleton-row" key={i} />)}<span className="sr-only">항목을 불러오고 있습니다.</span></div>; }
export function FetchError({ message, retry }: { message: string; retry: () => void }) { return <div className="fetch-error" role="alert"><p>{message}</p><Button variant="outline" size="sm" onClick={retry}>다시 시도</Button></div>; }
export function Empty({ search = false, message }: { search?: boolean; message?: string }) {
  const { open } = useItemEditor();
  return <div className="empty-state"><div className="empty-icon"><Inbox size={27} strokeWidth={1.5} /></div><h2>{message || (search ? "검색 결과가 없습니다." : "아직 아무것도 없습니다.")}</h2><p className="muted">{search ? "다른 검색어나 필터로 찾아보세요." : "나중에 기억해야 하는 것을 여기에 저장해보세요."}</p>{!search && <Button variant="outline" onClick={() => open()}>첫 항목 만들기</Button>}</div>;
}
export function ItemList({ items, compact = false }: { items: Item[]; compact?: boolean }) {
  const { data: spaces } = useSpaces(); const isViewer = (item: Item) => spaces?.find(s => s.id === item.space_id)?.role === "viewer";
  const { open, refresh, notify } = useItemEditor(); const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState(""); const [deleting, setDeleting] = useState<Item | null>(null);
  async function change(item: Item, status: Item["status"]) {
    if (pending) return; setPending(item.id); setError("");
    try { await api(`items/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); await refresh(); notify(status === "completed" ? "항목을 완료했습니다." : "상태를 변경했습니다."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "상태를 변경하지 못했습니다."); }
    finally { setPending(null); }
  }
  async function remove() {
    if (!deleting || pending) return; setPending(deleting.id); setError("");
    try { await api(`items/${deleting.id}`, { method: "DELETE" }); setDeleting(null); await refresh(); notify("항목을 삭제했습니다."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "삭제하지 못했습니다."); }
    finally { setPending(null); }
  }
  return <>{error && <p role="alert" className="error-banner">{error}</p>}<ul className={`item-list ${compact ? "compact" : ""}`}>
    {items.map(item => <li key={item.id} className={`item-row ${item.status === "completed" ? "is-completed" : ""}`}>
      <button className="complete-button" disabled={pending !== null || item.status === "archived" || isViewer(item)} onClick={() => change(item, item.status === "completed" ? "todo" : "completed")} aria-label={`${item.title} ${item.status === "completed" ? "완료 취소" : "완료"}`}>{item.status === "completed" ? <Check size={17} /> : <Circle size={19} strokeWidth={1.4} />}</button>
      <button className="item-main" onClick={() => open(item)}><span className="item-title">{item.title}</span><span className="item-meta"><SpaceName id={item.space_id} /><span className="type-label">{types[item.type]}</span>
        {item.deadline && <span className={item.deadline < seoulDate() && item.status !== "completed" ? "overdue" : ""}>{dueLabel(item.deadline)}</span>}
        {item.start_datetime && <span>{timeLabel(item.start_datetime)}</span>}
        {item.amount != null && <span>{money(item.amount, item.currency)}</span>}
        {!compact && <span className="status-label">{statuses[item.status]}</span>}
      </span></button>
      <div className="row-actions">{item.status === "archived" ? <button className="icon-button" disabled={pending !== null || isViewer(item)} onClick={() => change(item, "todo")} aria-label={`${item.title} 복원`}><ArchiveRestore size={16} /></button> : <button className="icon-button" disabled={pending !== null || isViewer(item)} onClick={() => change(item, "archived")} aria-label={`${item.title} 보관`}><Archive size={16} /></button>}
        <button className="icon-button" onClick={() => open(item)} aria-label={`${item.title} 상세 보기`}><MoreHorizontal size={18} /></button>
        {!compact && <button className="icon-button danger-action" disabled={isViewer(item)} onClick={() => setDeleting(item)} aria-label={`${item.title} 삭제`}><Trash2 size={16} /></button>}
      </div>
      {!compact && item.status !== "completed" && item.status !== "archived" && <select className="inline-status" aria-label={`${item.title} 상태`} value={item.status} disabled={pending !== null || isViewer(item)} onChange={e => change(item, e.target.value as Item["status"])}>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}
    </li>)}
  </ul>{deleting && <Dialog open onOpenChange={value => { if (!value && !pending) setDeleting(null); }} title="항목을 삭제할까요?" description={`“${deleting.title}” 항목이 영구 삭제됩니다. 기록을 남기려면 보관해주세요.`}><div className="dialog-footer"><Button variant="outline" disabled={pending !== null} onClick={() => setDeleting(null)}>취소</Button><Button variant="destructive" disabled={pending !== null} onClick={remove}>{pending ? "삭제 중…" : "영구 삭제"}</Button></div>{error && <p role="alert" className="error-banner">{error}</p>}</Dialog>}</>;
}
