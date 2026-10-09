"use client";
import { useState } from "react";
import { SpaceFilter, useSpaces } from "@/features/spaces/shared";
import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, CircleCheck, Plus } from "lucide-react";
import { api, type Dashboard } from "@/lib/api/client";
import { dateLabel, money } from "@/lib/format";
import { ItemList, Loading, FetchError } from "@/features/items/list";
import { useItemEditor } from "@/features/items/provider";
import { Button } from "@/components/ui/button";
export function DashboardView() {
  const [spaceId, setSpaceId] = useState(""); const { data: spaces } = useSpaces();
  const { data, error, isLoading, mutate } = useSWR<Dashboard>(`dashboard${spaceId ? `?space_id=${spaceId}` : ""}`, api); const { open } = useItemEditor();
  return <><div className="page-heading"><div><span className="eyebrow">오늘의 생활을 가볍게</span><h1>기억은 여기에,<br className="mobile-only" /> 집중은 오늘에.</h1><p className="muted">잊지 않고 처리할 수 있도록, 들어온 정보를 모아드립니다.</p></div></div>
    <SpaceFilter value={spaceId} onChange={setSpaceId} />
    {isLoading ? <Loading /> : error ? <FetchError message={error.message} retry={() => mutate()} /> : data && <>
      <div className="dashboard-date">{dateLabel(data.today)}<span>{spaces?.find(s => s.id === spaceId)?.name || "모든 공간"}</span></div>
      <div className="metric-strip"><Link href="/inbox"><span>정리할 항목</span><strong>{data.inbox_count}<small>개</small></strong><p>Inbox에 모아둔 정보</p></Link><Link href="/calendar"><span>오늘 관련 항목</span><strong>{data.today_count}<small>개</small></strong><p>오늘의 마감과 일정</p></Link><Link href="/calendar"><span>이번 주 마감</span><strong>{data.week_deadline_count}<small>개</small></strong><p>월요일부터 일요일까지</p></Link><div className={data.overdue_count ? "metric-warning" : ""}><span>지난 마감</span><strong>{data.overdue_count}<small>개</small></strong><p>다시 확인할 항목</p></div></div>
      <section className="dashboard-section"><div className="section-heading"><h2>오늘 확인해주세요.<span className="count-badge">{data.today_count}</span></h2><Link href="/calendar">Calendar <ArrowRight size={14} /></Link></div>{data.today_items.length ? <ItemList items={data.today_items} compact /> : <div className="quiet-state"><CircleCheck size={22} /><div><strong>오늘 예정된 항목이 없습니다.</strong><p>필요한 정보는 언제든 Inbox에 모아두세요.</p></div><Button variant="ghost" size="sm" onClick={() => open()}><Plus size={16} />추가</Button></div>}</section>
      {data.overdue_items.length > 0 && <section className="dashboard-section"><div className="section-heading"><h2>마감을 다시 확인해주세요.<span className="count-badge warning">{data.overdue_count}</span></h2></div><ItemList items={data.overdue_items} compact /></section>}
      <section className="dashboard-section"><div className="section-heading"><h2>이번 주 예정 결제</h2><span className="caption">오늘부터 일요일까지</span></div><div className="payment-summary">{Object.entries(data.payments).length ? Object.entries(data.payments).map(([currency, amount]) => <div key={currency}><span>{currency}</span><strong>{money(amount, currency)}</strong></div>) : <p className="muted">금액이 입력된 예정 결제가 없습니다.</p>}</div>{data.payment_missing_amount_count > 0 && <p className="caption payment-note">금액을 입력하지 않은 결제가 {data.payment_missing_amount_count}개 있습니다.</p>}<p className="caption payment-note">통화별 합계이며 환율 환산은 하지 않습니다.</p></section>
      {data.inbox_count === 0 && data.today_count === 0 && data.overdue_count === 0 && <div className="capture-callout"><div><h2>나중에 기억해야 하는 것이 있으신가요?</h2><p className="muted">공지, 예약, 결제, 할 일까지. 짧게 적고 시작하세요.</p></div><Button onClick={() => open()}><Plus size={17} />첫 항목 만들기</Button></div>}
    </>}
  </>;
}
