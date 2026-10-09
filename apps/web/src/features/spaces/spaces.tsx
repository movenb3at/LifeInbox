"use client";
import Link from "next/link";
import useSWR from "swr";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, type Space } from "@/lib/api/client";
import { Loading, FetchError } from "@/features/items/list";
import { useItemEditor } from "@/features/items/provider";
import { useSpaces } from "./shared";

export function SpacesView() {
  const { data, error: loadError, isLoading, mutate } = useSpaces(); const { refresh, notify } = useItemEditor();
  const { data: me } = useSWR<{ id: string }>("me", api);
  const [name, setName] = useState(""); const [type, setType] = useState("personal");
  const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<Space | null>(null); const [editing, setEditing] = useState<Space | null>(null);
  const [renamed, setRenamed] = useState(""); const [members, setMembers] = useState<Space | null>(null);
  async function action(path: string, method: string, body?: object) {
    setPending(true); setError("");
    try { await api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }); await refresh(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "처리하지 못했습니다."); return false; }
    finally { setPending(false); }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault(); if (await action("spaces", "POST", { name, type })) { setName(""); notify("새 저장 공간을 만들었습니다."); }
  }
  return <><div className="page-heading"><div><span className="eyebrow">생활의 맥락을 나누어 담으세요</span><h1>Spaces</h1><p className="muted">개인 공간은 본인만, 공유 공간은 멤버와 함께 사용합니다.</p></div></div>
    <form className="automation-panel compact-form" onSubmit={create}><h2>새 Space</h2><div className="form-grid"><label>공간 이름<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="예: 학교, 개발, 가족" /></label><label>공간 범위<select value={type} onChange={e => setType(e.target.value)}><option value="personal">개인 Inbox · 나만 보기</option><option value="shared">공유 Inbox · 멤버와 함께</option></select></label></div><Button type="submit" disabled={pending || !name.trim()}>만들기</Button></form>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {isLoading ? <Loading /> : loadError ? <FetchError message={loadError.message} retry={() => mutate()} /> : ["personal", "shared"].map(kind => <section className="dashboard-section" key={kind}><div className="section-heading"><h2>{kind === "personal" ? "개인 공간" : "공유 공간"}</h2></div><div className="space-cards">{data?.filter(s => s.type === kind).map(space => <article className="automation-panel" key={space.id}><h3><Link href={`/inbox?space=${space.id}`}>{space.name}</Link>{space.is_default && <span className="count-badge">기본 Inbox</span>}</h3><p className="caption">{space.type === "personal" ? "나만 보기" : space.role === "owner" ? "Owner · 공간 관리" : space.role === "viewer" ? "Viewer · 읽기 전용" : "Member · 항목 작성"}</p><div className="action-row"><Button asChild size="sm" variant="outline"><Link href={`/inbox?space=${space.id}`}>열기</Link></Button>{space.role === "owner" && <><Button size="sm" variant="ghost" disabled={pending} onClick={() => { setEditing(space); setRenamed(space.name); }}>이름 변경</Button>{space.type === "personal" && !space.is_default && <Button size="sm" variant="ghost" disabled={pending} onClick={() => action(`spaces/${space.id}`, "PATCH", { is_default: true })}>기본으로 지정</Button>}{space.type === "shared" && <Button size="sm" variant="ghost" onClick={() => setMembers(space)}>멤버 관리</Button>}<Button size="sm" variant="ghost" disabled={pending || space.is_default} onClick={() => setDeleting(space)}>삭제</Button></>}</div></article>)}</div></section>)}
    <p className="caption">기본 Inbox는 삭제할 수 없습니다. 항목이 있는 공간은 먼저 항목을 이동해주세요.</p>
    {me && <p className="caption account-id">공유 공간에 참여할 때 전달할 내 사용자 ID: <code>{me.id}</code></p>}
    {editing && <Dialog open onOpenChange={value => { if (!value && !pending) setEditing(null); }} title="공간 이름 변경" description="공간의 항목과 권한은 그대로 유지됩니다."><form className="compact-form" onSubmit={async e => { e.preventDefault(); if (await action(`spaces/${editing.id}`, "PATCH", { name: renamed })) setEditing(null); }}><label>새 이름<input required maxLength={100} value={renamed} onChange={e => setRenamed(e.target.value)} /></label><Button type="submit" disabled={pending}>저장</Button>{error && <p role="alert" className="error-banner">{error}</p>}</form></Dialog>}
    {deleting && <Dialog open onOpenChange={value => { if (!value && !pending) setDeleting(null); }} title="빈 공간을 삭제할까요?" description={`“${deleting.name}” 공간이 삭제됩니다. 항목이나 자동화 참조가 남아 있으면 삭제를 차단합니다.`}><div className="action-row"><Button variant="outline" disabled={pending} onClick={() => setDeleting(null)}>취소</Button><Button variant="destructive" disabled={pending} onClick={async () => { if (await action(`spaces/${deleting.id}`, "DELETE")) setDeleting(null); }}>공간 삭제</Button></div>{error && <p role="alert" className="error-banner">{error}</p>}</Dialog>}
    {members && <MemberManager space={members} onClose={() => setMembers(null)} />}
  </>;
}

function MemberManager({ space, onClose }: { space: Space; onClose: () => void }) {
  const { data, mutate } = useSWR<{ user_id: string; role: string }[]>(`spaces/${space.id}/members`, api);
  const [userId, setUserId] = useState(""); const [role, setRole] = useState("member"); const [pending, setPending] = useState(false); const [error, setError] = useState("");
  async function change(id: string, nextRole?: string) {
    setPending(true); setError("");
    try { await api(nextRole ? `spaces/${space.id}/members` : `spaces/${space.id}/members/${id}`, { method: nextRole ? "POST" : "DELETE", ...(nextRole ? { body: JSON.stringify({ user_id: id, role: nextRole }) } : {}) }); setUserId(""); await mutate(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "멤버를 변경하지 못했습니다."); }
    finally { setPending(false); }
  }
  return <Dialog open onOpenChange={value => { if (!value && !pending) onClose(); }} title={`${space.name} 멤버`} description="이미 가입한 사용자의 ID로 멤버를 추가합니다. 별도 초대 메일을 보내지 않습니다."><form className="compact-form" onSubmit={e => { e.preventDefault(); change(userId, role); }}><label>사용자 ID<input required value={userId} onChange={e => setUserId(e.target.value)} pattern="[0-9a-fA-F-]{36}" /></label><label>역할<select value={role} onChange={e => setRole(e.target.value)}><option value="member">Member · 항목 작성</option><option value="viewer">Viewer · 읽기 전용</option></select></label><Button type="submit" disabled={pending}>멤버 추가</Button></form><ul className="member-list">{data?.map(member => <li key={member.user_id}><code>{member.user_id}</code>{member.role === "owner" ? <span>Owner</span> : <div className="action-row"><select aria-label={`${member.user_id} 역할`} disabled={pending} value={member.role} onChange={e => change(member.user_id, e.target.value)}><option value="member">Member</option><option value="viewer">Viewer</option></select><Button variant="ghost" size="sm" disabled={pending} onClick={() => change(member.user_id)}>제거</Button></div>}</li>)}</ul>{error && <p className="error-banner" role="alert">{error}</p>}</Dialog>;
}
