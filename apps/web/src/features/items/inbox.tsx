"use client";
import useSWR from "swr";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SpaceFilter, useSpaces } from "@/features/spaces/shared";
import { Plus } from "lucide-react";
import { api, type ItemPage } from "@/lib/api/client";
import { statuses, types } from "@/lib/format";
import { ItemList, Loading, FetchError, Empty } from "./list";
import { useItemEditor } from "./provider";
import { Button } from "@/components/ui/button";
export function InboxView() {
  const search = useSearchParams(); const router = useRouter(); const spaceId = search.get("space") || ""; const { data: spaces } = useSpaces();
  function setSpaceId(value: string) { router.replace(value ? `/inbox?space=${value}` : "/inbox"); }
  const [status, setStatus] = useState("inbox"); const [type, setType] = useState(""); const [page, setPage] = useState(1); const { open } = useItemEditor();
  const params = new URLSearchParams({ page: String(page), page_size: "20" }); if (status) params.set("status", status); if (type) params.set("type", type); if (spaceId) params.set("space_id", spaceId);
  const { data, error, isLoading, mutate } = useSWR<ItemPage>(`items?${params}`, api);
  return <><div className="page-heading"><div><span className="eyebrow">한곳에 모아두고, 하나씩</span><h1>{spaces?.find(s => s.id === spaceId)?.name || "전체 Inbox"}</h1><p className="muted">들어온 정보를 정리하고 다음 행동을 결정하세요.</p></div><Button variant="outline" onClick={() => open(undefined, spaceId || undefined)}><Plus size={17} />항목 추가</Button></div>
    <SpaceFilter value={spaceId} onChange={value => { setSpaceId(value); setPage(1); }} />
    <div className="list-toolbar"><div className="tabs" role="tablist" aria-label="항목 상태">{Object.entries({ ...statuses, "": "전체" }).map(([key, label]) => <button role="tab" aria-selected={status === key} key={key} className={status === key ? "active" : ""} onClick={() => { setStatus(key); setPage(1); }}>{label}</button>)}</div><select className="filter-select" aria-label="종류 필터" value={type} onChange={e => { setType(e.target.value); setPage(1); }}><option value="">모든 종류</option>{Object.entries(types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
    {isLoading ? <Loading /> : error ? <FetchError message={error.message} retry={() => mutate()} /> : data && <><div className="list-count">{data.total}개의 항목</div>{data.items.length ? <ItemList items={data.items} /> : <Empty message={status === "completed" ? "완료한 항목이 없습니다." : status === "archived" ? "보관한 항목이 없습니다." : undefined} />}<Pagination total={data.total} page={page} onChange={setPage} /></>}
  </>;
}
export function Pagination({ total, page, onChange }: { total: number; page: number; onChange: (page: number) => void }) {
  if (total <= 20) return null; const last = Math.ceil(total / 20);
  return <div className="pagination"><Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>이전</Button><span className="caption">{page} / {last}</span><Button variant="ghost" size="sm" disabled={page >= last} onClick={() => onChange(page + 1)}>다음</Button></div>;
}
