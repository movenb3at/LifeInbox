"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, ChevronRight, Folder, Settings2, House, Inbox, LogOut, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ItemProvider } from "@/features/items/provider";
import { useItemEditor } from "@/features/items/provider";
import { supabaseBrowser } from "@/lib/auth/browser";
import { useState } from "react";
import { useSpaces } from "@/features/spaces/shared";
import { SWRConfig } from "swr";

const navigation = [
  { href: "/", label: "홈", icon: House }, { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/calendar", label: "Calendar", icon: CalendarDays }, { href: "/search", label: "검색", icon: Search },
  { href: "/spaces", label: "Spaces", icon: Folder }, { href: "/automation", label: "자동화", icon: Settings2 },
];
export function Shell({ configured, children }: { configured: boolean; children: React.ReactNode }) {
  const [cacheProvider] = useState(() => () => new Map());
  return <SWRConfig value={{ provider: cacheProvider }}><ItemProvider><ShellInner configured={configured}>{children}</ShellInner></ItemProvider></SWRConfig>;
}
function ShellInner({ configured, children }: { configured: boolean; children: React.ReactNode }) {
  const { data: spaces } = useSpaces();
  const path = usePathname(); const router = useRouter(); const { open } = useItemEditor();
  const [logoutError, setLogoutError] = useState(""); const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    setLoggingOut(true); setLogoutError("");
    const { error } = await supabaseBrowser().auth.signOut();
    if (error) { setLogoutError("로그아웃하지 못했습니다. 다시 시도해주세요."); setLoggingOut(false); return; }
    router.replace("/login"); router.refresh();
  }
  return <div className="app-shell">
    <a className="skip-link" href="#main">본문으로 이동</a>
    <aside className="sidebar">
      <Link href="/" className="brand"><span className="brand-mark"><Inbox size={21} strokeWidth={1.7} /></span>LifeInbox</Link>
      <div className="sidebar-navigation">
        <div className="sidebar-section-label">내 생활</div>
        <nav aria-label="주요 메뉴">{navigation.map(({ href, label, icon: Icon }) =>
          <Link key={href} href={href} aria-current={path === href ? "page" : undefined} className={`nav-link ${path === href ? "active" : ""}`}><Icon size={19} />{label}{path === href && <ChevronRight className="nav-arrow" size={14} />}</Link>)}</nav>
        <div className="sidebar-space"><span className="sidebar-section-label">저장 공간</span>{spaces?.map(s => <Link href={`/inbox?space=${s.id}`} key={s.id}><span className="space-dot" />{s.name}<span className="caption">{s.is_default ? "기본" : s.type === "shared" ? "공유" : "개인"}</span></Link>)}<Link href="/spaces">공간 관리</Link></div>
      </div>
      <div className="sidebar-bottom">
        {configured && <button className="nav-link logout" disabled={loggingOut} onClick={logout}><LogOut size={17} />{loggingOut ? "로그아웃 중…" : "로그아웃"}</button>}</div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><span className="desktop-only">생활 공간</span><ChevronRight size={14} className="desktop-only" /><span className="mobile-brand">LifeInbox</span><span className="desktop-only">{navigation.find(n => n.href === path)?.label || "개인 Inbox"}</span></div>
        <div className="topbar-actions"><Link href="/search" className="icon-button" aria-label="항목 검색"><Search size={19} /></Link>
          {configured && <button className="icon-button mobile-logout" onClick={logout} disabled={loggingOut} aria-label="로그아웃"><LogOut size={19} /></button>}
          <Button onClick={() => open()} disabled={!configured} size="sm"><Plus size={16} />새 항목</Button></div></header>
      {logoutError && <p role="alert" className="error-banner">{logoutError}</p>}
      <main id="main" className="main-content">{children}</main>
    </div>
    <nav className="mobile-nav" aria-label="모바일 주요 메뉴">{navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={path === href ? "page" : undefined} className={path === href ? "active" : ""}><Icon size={20} /><span>{label}</span></Link>)}</nav>
  </div>;
}
