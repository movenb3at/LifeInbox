"use client";
import useSWR from "swr";
import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { api, type Calendar, type Entry } from "@/lib/api/client";
import { dateLabel, seoulDate, timeLabel } from "@/lib/format";
import { useItemEditor } from "@/features/items/provider";
import { Loading, FetchError } from "@/features/items/list";
import { SpaceFilter, SpaceName } from "@/features/spaces/shared";
import { Button } from "@/components/ui/button";

export function entryOnDay(entry: Entry, day: string) {
  if (entry.kind === "deadline") return entry.item.deadline === day;
  if (!entry.item.start_datetime) return false;
  const left = Date.parse(`${day}T00:00:00+09:00`), right = left + 86400000;
  const start = Date.parse(entry.item.start_datetime), end = entry.item.end_datetime ? Date.parse(entry.item.end_datetime) : null;
  return start < right && (end !== null ? end > left : start >= left);
}
export function CalendarView() {
  const [spaceId, setSpaceId] = useState("");
  const today = seoulDate(); const [month, setMonth] = useState(today.slice(0, 7)); const [selected, setSelected] = useState(today); const { open } = useItemEditor();
  const { data, error, isLoading, mutate } = useSWR<Calendar>(`calendar?month=${month}${spaceId ? `&space_id=${spaceId}` : ""}`, api);
  const [year, monthNumber] = month.split("-").map(Number); const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(); const cells = Math.ceil((offset + days) / 7) * 7;
  const entries = data?.entries || []; const selectedEntries = entries.filter(e => entryOnDay(e, selected));
  function shift(delta: number) { const next = new Date(Date.UTC(year, monthNumber - 1 + delta, 1)); const nextMonth = next.toISOString().slice(0, 7); setMonth(nextMonth); setSelected(`${nextMonth}-01`); }
  return <><div className="page-heading"><div><span className="eyebrow">언제 해야 하는지 한눈에</span><h1>Calendar</h1><p className="muted">마감과 일정을 함께 확인하세요.</p></div></div>
    <SpaceFilter value={spaceId} onChange={setSpaceId} />
    <div className="calendar-toolbar"><h2>{year}년 {monthNumber}월</h2><div><Button variant="ghost" size="icon" aria-label="이전 달" onClick={() => shift(-1)}><ChevronLeft size={20} /></Button><Button variant="outline" size="sm" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>오늘</Button><Button variant="ghost" size="icon" aria-label="다음 달" onClick={() => shift(1)}><ChevronRight size={20} /></Button></div></div>
    {isLoading ? <Loading /> : error ? <FetchError message={error.message} retry={() => mutate()} /> : <><div className="calendar-grid" role="group" aria-label={`${year}년 ${monthNumber}월 달력`}>
      {["월", "화", "수", "목", "금", "토", "일"].map(day => <div className="weekday" key={day}>{day}</div>)}
      {Array.from({ length: cells }, (_, index) => {
        const number = index - offset + 1; if (number < 1 || number > days) return <div key={index} className="calendar-cell empty" />;
        const day = `${month}-${String(number).padStart(2, "0")}`; const dayEntries = entries.filter(entry => entryOnDay(entry, day));
        return <button key={index} className={`calendar-cell ${selected === day ? "selected" : ""} ${day === today ? "today" : ""}`} aria-label={`${dateLabel(day)}, ${dayEntries.length}개 항목`} aria-pressed={selected === day} onClick={() => setSelected(day)}><span className="day-number">{number}</span><span className="calendar-events">{dayEntries.slice(0, 3).map(entry => <span key={entry.id} className={`calendar-event ${entry.kind} ${entry.item.status === "completed" ? "done" : ""}`}>{entry.kind === "deadline" ? "마감" : "일정"} · {entry.item.title}</span>)}{dayEntries.length > 3 && <span className="calendar-more">+{dayEntries.length - 3}개</span>}</span>{dayEntries.length > 0 && <span className="mobile-event-dot" />}</button>;
      })}
    </div><div className="calendar-legend"><span><i />마감</span><span><i />일정</span><span>완료 항목은 흐리게 표시됩니다.</span></div>
    <section className="day-agenda"><div className="section-heading"><h2>{dateLabel(selected)}<span className="count-badge">{selectedEntries.length}</span></h2></div>{selectedEntries.length ? <ul>{selectedEntries.map(entry => <li key={entry.id}><span className={`agenda-kind ${entry.kind}`}>{entry.kind === "deadline" ? "마감" : "일정"}</span><button className={`agenda-title ${entry.item.status === "completed" ? "done" : ""}`} onClick={() => open(entry.item)}><strong>{entry.item.title}</strong><span className="caption"><SpaceName id={entry.item.space_id} /> · {entry.kind === "deadline" ? "종일" : timeLabel(entry.item.start_datetime!)}{entry.item.status === "completed" && " · 완료"}</span></button></li>)}</ul> : <div className="quiet-state"><CalendarDays size={22} /><p>이 날짜에 예정된 항목이 없습니다.</p></div>}</section></>}
  </>;
}
