"use client";
import useSWR from "swr";
import { useState } from "react";
import { Search } from "lucide-react";
import { api, type ItemPage } from "@/lib/api/client";
import { statuses, types } from "@/lib/format";
import { ItemList, Loading, FetchError, Empty } from "@/features/items/list";
import { Pagination } from "@/features/items/inbox";
import { SpaceFilter } from "@/features/spaces/shared";
import { Button } from "@/components/ui/button";
export function SearchView() {
  const [spaceId, setSpaceId] = useState("");
  const [input, setInput] = useState(""); const [q, setQ] = useState<string | null>(null); const [status, setStatus] = useState(""); const [type, setType] = useState(""); const [page, setPage] = useState(1);
  const params = new URLSearchParams({ q: q || "", page: String(page), page_size: "20" }); if (status) params.set("status", status); if (type) params.set("type", type); if (spaceId) params.set("space_id", spaceId);
  const { data, error, isLoading, mutate } = useSWR<ItemPage>(q !== null ? `items?${params}` : null, api);
  return <><div className="page-heading"><div><span className="eyebrow">지난 기록도, 앞으로의 일도</span><h1>필요한 정보를 찾아보세요.</h1><p className="muted">제목, 설명, 처음 저장한 내용에서 검색합니다. 완료·보관한 항목도 포함됩니다.</p></div></div>
    <SpaceFilter value={spaceId} onChange={value => { setSpaceId(value); setPage(1); }} />
    <form className="search-form" onSubmit={e => { e.preventDefault(); setQ(input.trim()); setPage(1); }}><Search size={21} /><input aria-label="검색어" autoFocus placeholder="예: 이어폰, 치과, 수행평가" value={input} onChange={e => setInput(e.target.value)} maxLength={200} /><Button type="submit" size="sm">검색</Button></form>
    <div className="search-filters"><label className="sr-only" htmlFor="search-status">상태 필터</label><select id="search-status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">모든 상태</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><label className="sr-only" htmlFor="search-type">종류 필터</label><select id="search-type" value={type} onChange={e => { setType(e.target.value); setPage(1); }}><option value="">모든 종류</option>{Object.entries(types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
    {q === null ? <div className="search-prompt"><Search size={28} strokeWidth={1.5} /><p>찾고 싶은 정보를 입력해주세요.</p><span className="caption">기억의 조각을 하나씩 찾아보세요.</span></div> : isLoading ? <Loading /> : error ? <FetchError message={error.message} retry={() => mutate()} /> : data && <><div className="list-count">검색 결과 {data.total}개</div>{data.items.length ? <ItemList items={data.items} /> : <Empty search />}<Pagination total={data.total} page={page} onChange={setPage} /></>}
  </>;
}
