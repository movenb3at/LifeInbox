"use client";
import useSWR from "swr";
import { api, type Space } from "@/lib/api/client";

export function useSpaces() { return useSWR<Space[]>("spaces", api); }
export function SpaceFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { data } = useSpaces();
  return <label className="space-filter">저장 공간<select aria-label="저장 공간 필터" value={value} onChange={e => onChange(e.target.value)}><option value="">모든 공간</option>{data?.map(s => <option key={s.id} value={s.id}>{s.name}{s.type === "shared" ? " · 공유" : ""}</option>)}</select></label>;
}
export function SpaceName({ id }: { id: string }) {
  const { data } = useSpaces(); const space = data?.find(s => s.id === id);
  return <span className="space-label">{space?.name || "저장 공간"}{space?.type === "shared" ? " · 공유" : ""}</span>;
}
