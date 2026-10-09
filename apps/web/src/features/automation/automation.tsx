"use client";
import useSWR from "swr";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, type AutomationSettings, type AutomationSummary, type Candidate, type InboundEvent, type Notification, type Rule, type Run } from "@/lib/api/client";
import { Loading, FetchError } from "@/features/items/list";
import { useItemEditor } from "@/features/items/provider";
import { useSpaces } from "@/features/spaces/shared";
import { CandidateCard } from "./candidate-card";
import { CandidateEditor } from "./candidate-editor";
import { RuleEditor } from "./rule-editor";
import { conditionFields, levels, operators, triggers } from "./labels";
import { ScreenshotCapture } from "./screenshots";

function timeLabel(value: string) { return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
export function AutomationView() {
  const { data: summary, error, isLoading, mutate } = useSWR<AutomationSummary>("automation/summary", api);
  const { data: settings } = useSWR<AutomationSettings>("automation/settings", api);
  const [tab, setTab] = useState("review");
  return <><div className="page-heading"><div><span className="eyebrow">정보에서 다음 행동으로</span><h1>자동화</h1><p className="muted">먼저 제안을 확인하고, 익숙해지면 자동 저장과 규칙을 사용하세요.</p></div></div>
    {isLoading ? <Loading /> : error ? <FetchError message={error.message} retry={() => mutate()} /> : summary && <div className="metric-strip"><div><span>사용 중 규칙</span><strong>{summary.active_rules}<small>개</small></strong></div><div><span>오늘 자동 저장</span><strong>{summary.today_processed}<small>개</small></strong></div><div><span>확인 필요</span><strong>{summary.review_count}<small>개</small></strong></div><div><span>실패 기록</span><strong>{summary.failed_count}<small>개</small></strong></div></div>}
    <div className="tabs automation-tabs" role="tablist" aria-label="자동화 메뉴">{Object.entries({ review: "수집·확인", rules: "규칙", history: "실행 기록", notifications: "알림", settings: "설정" }).map(([key, title]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{title}{key === "notifications" && summary?.unread_notifications ? ` ${summary.unread_notifications}` : ""}</button>)}</div>
    {tab === "review" && <><ScreenshotCapture /><ShareForm /><CandidateQueue /><EventHistory /></>}
    {tab === "rules" && <RuleList />}{tab === "history" && <RunHistory />}{tab === "notifications" && <NotificationList />}
    {tab === "settings" && settings && <SettingsForm key={JSON.stringify(settings)} initial={settings} />}
  </>;
}

function ShareForm() {
  const [content, setContent] = useState(""); const [title, setTitle] = useState(""); const [sender, setSender] = useState(""); const [source, setSource] = useState("manual_share");
  const [pending, setPending] = useState(false); const [error, setError] = useState(""); const { refresh, notify } = useItemEditor();
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setPending(true); setError("");
    try { const event = await api<InboundEvent>("automation/events", { method: "POST", body: JSON.stringify({ title, content, sender, source_type: source }) }); await refresh(); if (event.status === "failed") setError(event.error_message || "원본을 보존했습니다. 수집 기록에서 재시도해주세요."); else { setTitle(""); setContent(""); notify("원본 수집을 처리했습니다."); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : "수집하지 못했습니다."); }
    finally { setPending(false); }
  }
  return <form className="automation-panel compact-form" onSubmit={submit}><h2>정보 가져오기</h2><p className="caption">메일·공유 내용을 붙여넣으면 규칙 기반으로 분석합니다. 외부 계정과 자동 동기화하지 않습니다.</p><label>제목<input maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="비워두면 본문 첫 줄을 사용합니다." /></label><label>원본 내용<textarea required rows={4} maxLength={10000} value={content} onChange={e => setContent(e.target.value)} placeholder="예: 10월 20일까지 35,000원 입금해주세요." /></label><div className="form-grid"><label>정보 출처<select value={source} onChange={e => setSource(e.target.value)}><option value="manual_share">수동 공유</option><option value="email">이메일 내용</option><option value="calendar">일정 내용</option><option value="webhook">Webhook 내용</option></select></label><label>발신자<input maxLength={200} value={sender} onChange={e => setSender(e.target.value)} placeholder="선택 사항" /></label></div>{error && <p role="alert" className="error-banner">{error}</p>}<Button type="submit" disabled={pending || !content.trim()}>{pending ? "분석 중…" : "분석하기"}</Button></form>;
}

function CandidateQueue() {
  const [page, setPage] = useState(1); const [status, setStatus] = useState("pending");
  const { data, error, isLoading, mutate } = useSWR<Candidate[]>(`automation/candidates?page=${page}&status=${status}`, api);
  const [editing, setEditing] = useState<Candidate | null>(null); const [pending, setPending] = useState(false); const [actionError, setActionError] = useState(""); const { refresh, notify } = useItemEditor();
  async function process(candidates: Candidate[], operation: "accept" | "reject") {
    setPending(true); setActionError(""); let count = 0;
    try { for (const candidate of candidates) { await api(`automation/candidates/${candidate.id}/${operation}`, { method: "POST", body: "{}" }); count++; } notify(`${count}개 후보를 ${operation === "accept" ? "추가" : "무시"}했습니다.`); }
    catch (cause) { setActionError(`${count}개 처리 후 중단되었습니다. ${cause instanceof Error ? cause.message : "다시 시도해주세요."}`); }
    finally { await refresh(); setPending(false); }
  }
  async function quickChange(save: () => Promise<unknown>) {
    setPending(true); setActionError("");
    try { await save(); await refresh(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "후보를 수정하지 못했습니다."); }
    finally { setPending(false); }
  }
  return <section className="dashboard-section"><div className="section-heading"><h2>분석 후보</h2><select aria-label="후보 상태" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="pending">확인 필요</option><option value="auto_accepted">자동 추가</option><option value="accepted">직접 추가</option><option value="rejected">무시한 후보</option></select></div>
    {actionError && <p className="error-banner" role="alert">{actionError}</p>}{isLoading ? <Loading /> : error ? <FetchError message={error.message} retry={() => mutate()} /> : !data?.length ? <p className="quiet-state">이 상태의 후보가 없습니다.</p> : <><div className="candidate-list">{data.map(candidate => <CandidateCard key={candidate.id} candidate={candidate} pending={pending} onAction={operation => process([candidate], operation)} onEdit={() => setEditing(candidate)} onChange={quickChange} />)}</div>{status === "pending" && <Button variant="outline" disabled={pending} onClick={() => process(data, "accept")}>현재 목록 모두 추가</Button>}</>}
    <PageButtons page={page} count={data?.length || 0} onChange={setPage} />{editing && <CandidateEditor candidate={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh(); }} />}
  </section>;
}

function RuleList() {
  const { data, error, isLoading, mutate } = useSWR<Rule[]>("automation/rules", api);
  const [editor, setEditor] = useState<{ rule?: Rule } | null>(null); const [deleting, setDeleting] = useState<Rule | null>(null); const [pending, setPending] = useState(false); const [actionError, setActionError] = useState(""); const { refresh } = useItemEditor();
  async function change(rule: Rule, remove = false) {
    setPending(true); setActionError("");
    const { name, description, space_id, scope_type, scope_id, version, trigger_type, conditions, actions, priority, is_enabled } = rule;
    try { await api(`automation/rules/${rule.id}`, { method: remove ? "DELETE" : "PATCH", ...(remove ? {} : { body: JSON.stringify({ name, description, space_id, scope_type, scope_id, version, trigger_type, conditions, actions, priority, is_enabled: !is_enabled }) }) }); setDeleting(null); await refresh(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "규칙을 변경하지 못했습니다."); }
    finally { setPending(false); }
  }
  return <section><div className="section-heading"><h2>자동화 규칙</h2><Button onClick={() => setEditor({})}>새 규칙</Button></div><p className="caption">모든 조건이 일치할 때 실행합니다. 자동 삭제·외부 결제·메시지 전송은 제공하지 않습니다.</p>{actionError && <p role="alert" className="error-banner">{actionError}</p>}{isLoading ? <Loading /> : error ? <FetchError message={error.message} retry={() => mutate()} /> : data?.map(rule => <article className="automation-panel" key={rule.id}><h3>{rule.name}<span className="caption"> {rule.is_enabled ? "사용 중" : "중지"} · 우선순위 {rule.priority}</span></h3><p>{triggers[rule.trigger_type]} · {rule.scope_type === "space" ? "공간 규칙" : rule.scope_type === "integration" ? "수집 경로 규칙" : "전역 규칙"}</p><p className="caption">{rule.description}</p><div className="action-row"><Button size="sm" variant="outline" onClick={() => setEditor({ rule })}>수정</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => change(rule)}>{rule.is_enabled ? "중지" : "사용"}</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => setDeleting(rule)}>삭제</Button></div></article>)}{!isLoading && !data?.length && <p className="quiet-state">등록한 규칙이 없습니다.</p>}
    {editor && <RuleEditor rule={editor.rule} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await refresh(); }} />}
    {deleting && <Dialog open onOpenChange={value => { if (!value && !pending) setDeleting(null); }} title="규칙을 삭제할까요?" description="예약된 알림은 취소하고 기존 실행 기록은 보존합니다."><Button variant="destructive" disabled={pending} onClick={() => change(deleting, true)}>규칙 삭제</Button>{actionError && <p role="alert" className="error-banner">{actionError}</p>}</Dialog>}
  </section>;
}

function RunHistory() {
  const [page, setPage] = useState(1); const { data, error, isLoading, mutate } = useSWR<Run[]>(`automation/runs?page=${page}`, api);
  return <section><h2>실행 기록</h2>{isLoading ? <Loading /> : error ? <FetchError message={error.message} retry={() => mutate()} /> : data?.map(run => <article key={run.id} className="automation-panel"><div className="section-heading"><h3>{run.rule_name}</h3><span className="caption">{timeLabel(run.executed_at)} · {run.status === "success" ? "성공" : run.status === "failed" ? "실패" : "건너뜀"}</span></div><p>{String((run.input_snapshot.entity as Record<string, unknown>)?.title || "입력 정보")}</p><details><summary>왜 이렇게 처리됐나요?</summary><ul>{(run.input_snapshot.conditions as { field: keyof typeof conditionFields; operator: keyof typeof operators; value: string; matched: boolean }[] || []).map((condition, index) => <li key={index}>{conditionFields[condition.field]} {operators[condition.operator]} “{condition.value}” · {condition.matched ? "일치" : "불일치"}</li>)}{(run.output_snapshot.actions as string[] || []).map((message, index) => <li key={`action-${index}`}>{message}</li>)}</ul>{run.error_message && <p className="error-banner">{run.error_message}</p>}</details></article>)}{!isLoading && !data?.length && <p className="quiet-state">실행 기록이 없습니다.</p>}<PageButtons page={page} count={data?.length || 0} onChange={setPage} /></section>;
}

function EventHistory() {
  const [page, setPage] = useState(1); const { data, mutate } = useSWR<InboundEvent[]>(`automation/events?page=${page}`, api); const { refresh } = useItemEditor(); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  async function retry(event: InboundEvent) { setPending(true); setError(""); try { await api(`automation/events/${event.id}/retry`, { method: "POST", body: "{}" }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "재시도하지 못했습니다."); } finally { setPending(false); } }
  return <details className="event-history"><summary>원본 수집 기록</summary>{error && <p className="error-banner" role="alert">{error}</p>}{data?.map(event => <article className="automation-panel" key={event.id}><p>{String(event.raw_content.title || "수집된 내용")} <span className="caption">{timeLabel(event.received_at)} · {event.status === "processed" ? "분석됨" : event.status === "failed" ? "실패" : event.status === "ignored" ? "무시됨" : "대기"}</span></p><details><summary>원본 보기</summary><p className="source-text">{String(event.raw_content.content || "")}</p></details>{event.error_message && <p className="error-banner">{event.error_message}</p>}{event.status === "failed" && <Button size="sm" variant="outline" disabled={pending} onClick={() => retry(event)}>재시도</Button>}</article>)}{!data && <Button variant="ghost" onClick={() => mutate()}>다시 불러오기</Button>}<PageButtons page={page} count={data?.length || 0} onChange={setPage} /></details>;
}

function NotificationList() {
  const [page, setPage] = useState(1); const { data, error, isLoading, mutate } = useSWR<Notification[]>(`notifications?page=${page}`, api, { refreshInterval: 15000 }); const { refresh } = useItemEditor();
  const [pending, setPending] = useState(false); const [actionError, setActionError] = useState("");
  async function read(notification: Notification) { setPending(true); setActionError(""); try { await api(`notifications/${notification.id}/read`, { method: "PATCH", body: "{}" }); await refresh(); } catch (cause) { setActionError(cause instanceof Error ? cause.message : "알림을 읽지 못했습니다."); } finally { setPending(false); } }
  return <section><h2>앱 내 알림</h2><p className="caption">예약된 알림은 서버 실행 중 전달됩니다. 이메일·기기 푸시는 보내지 않습니다.</p>{actionError && <p className="error-banner" role="alert">{actionError}</p>}{isLoading ? <Loading /> : error ? <FetchError message={error.message} retry={() => mutate()} /> : data?.map(notification => <article className="automation-panel" key={notification.id}><h3>{notification.title}</h3><p>{notification.message}</p><p className="caption">{timeLabel(notification.scheduled_for)} · {notification.status === "scheduled" ? "예약됨" : notification.status === "cancelled" ? "취소됨" : notification.read_at ? "읽음" : "새 알림"}</p>{notification.status === "delivered" && !notification.read_at && <Button size="sm" variant="outline" disabled={pending} onClick={() => read(notification)}>읽음 처리</Button>}</article>)}{!isLoading && !data?.length && <p className="quiet-state">알림이 없습니다.</p>}<PageButtons page={page} count={data?.length || 0} onChange={setPage} /></section>;
}

function SettingsForm({ initial }: { initial: AutomationSettings }) {
  const [form, setForm] = useState(initial); const [pending, setPending] = useState(false); const [error, setError] = useState(""); const { refresh, notify } = useItemEditor();
  const { data: spaces } = useSpaces(); const { data: integrations } = useSWR<{ id: string; provider: string; default_space_id: string | null }[]>("automation/integrations", api);
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  async function save(e: React.FormEvent) { e.preventDefault(); setPending(true); setError(""); try { await api("automation/settings", { method: "PATCH", body: JSON.stringify(form) }); for (const [id, destination] of Object.entries(destinations)) await api(`automation/integrations/${id}/destination`, { method: "PATCH", body: JSON.stringify({ space_id: destination || null }) }); await refresh(); notify("자동화 설정을 저장했습니다."); } catch (cause) { setError(cause instanceof Error ? cause.message : "설정을 저장하지 못했습니다."); } finally { setPending(false); } }
  return <form className="automation-panel compact-form" onSubmit={save}><h2>자동화 설정</h2><label>자동화 수준<select value={form.level} onChange={e => setForm({ ...form, level: e.target.value as AutomationSettings["level"] })}>{Object.entries(levels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><div className="form-grid"><label>자동 저장 신뢰도<input required type="number" min={0} max={1} step="0.0001" value={form.capture_threshold} onChange={e => setForm({ ...form, capture_threshold: Number(e.target.value) })} /></label><label>확인 권장 신뢰도<input required type="number" min={0} max={1} step="0.0001" value={form.review_threshold} onChange={e => setForm({ ...form, review_threshold: Number(e.target.value) })} /></label></div>{integrations?.filter(row => ["manual_share", "screenshot"].includes(row.provider)).map(integration => <label key={integration.id}>{integration.provider === "screenshot" ? "스크린샷" : "수동 공유"}의 기본 저장 공간<select value={destinations[integration.id] ?? integration.default_space_id ?? ""} onChange={e => setDestinations({ ...destinations, [integration.id]: e.target.value })}><option value="">사용자 기본 Inbox</option>{spaces?.filter(s => s.role !== "viewer").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>)}<p className="caption">규칙의 분류 → 연결의 기본 공간 → 사용자 기본 Inbox 순으로 적용합니다.</p><p className="caption">자동 실행은 활성 규칙에 따라 기존 항목의 종류·상태·저장 공간을 변경하고 앱 내 알림을 만들 수 있습니다. 자동화하지 않아도 기존 수동 입력을 사용할 수 있습니다.</p>{error && <p className="error-banner" role="alert">{error}</p>}<Button type="submit" disabled={pending}>{pending ? "저장 중…" : "설정 저장"}</Button></form>;
}
function PageButtons({ page, count, onChange }: { page: number; count: number; onChange: (page: number) => void }) { return page > 1 || count === 20 ? <div className="pagination"><Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>이전</Button><span>{page} 페이지</span><Button variant="ghost" size="sm" disabled={count < 20} onClick={() => onChange(page + 1)}>다음</Button></div> : null; }
