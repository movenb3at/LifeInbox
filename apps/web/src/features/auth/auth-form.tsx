"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Inbox, ArrowRight, MailCheck } from "lucide-react";
import { supabaseBrowser } from "@/lib/auth/browser";
import { Button } from "@/components/ui/button";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const signup = mode === "signup"; const router = useRouter(); const params = useSearchParams();
  const confirmationError = params.get("error") === "confirmation_session"
    ? "이메일 인증 후 자동 로그인을 연결하지 못했습니다. 가입하신 이메일과 비밀번호로 로그인해주세요."
    : params.get("error") === "confirmation"
      ? "인증 링크를 처리하지 못했습니다. 이미 이메일 인증을 마치셨다면 로그인해주세요."
      : "";
  const [pending, setPending] = useState(false); const [error, setError] = useState(""); const [sent, setSent] = useState(false);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setPending(true);
    try {
      const supabase = supabaseBrowser();
      if (signup) {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: {
          data: { display_name: name.trim() }, emailRedirectTo: `${window.location.origin}/auth/confirm`,
        } });
        if (error) throw error;
        if (data.session) { router.replace("/"); router.refresh(); } else setSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        router.replace("/"); router.refresh();
      }
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "";
      setError(text.includes("Invalid login") ? "이메일과 비밀번호를 확인해주세요." : text.includes("Email not confirmed") ? "메일함에서 인증을 완료해주세요." : text.includes("rate limit") ? "요청이 많습니다. 잠시 후 다시 시도해주세요." : text.includes("authorized") ? "개발 프로젝트 팀원 이메일을 사용하거나 SMTP 설정을 확인해주세요." : "인증 요청을 처리하지 못했습니다. 입력값과 Supabase 설정을 확인해주세요.");
    } finally { setPending(false); }
  }
  return <div className="auth-page"><Link href="/" className="brand"><span className="brand-mark"><Inbox size={21} /></span>LifeInbox</Link>
    <main className="auth-form-wrap">{sent ? <div className="auth-confirm"><MailCheck size={34} /><h1>메일함을 확인해주세요.</h1><p className="muted">{email}로 인증 링크를 보내드렸습니다.<br />링크를 누르시면 개인 Inbox가 준비됩니다.</p><Button asChild variant="outline"><Link href="/login">로그인으로 돌아가기</Link></Button></div> : <>
      <span className="eyebrow">생활을 위한 작은 여유</span><h1>{signup ? "기억할 일을 모아두세요." : "다시 만나 반갑습니다."}</h1><p className="muted">{signup ? "혼자서 시작하실 수 있는 개인 Inbox입니다." : "들어온 정보를 정리하고, 오늘 할 일을 확인하세요."}</p>
      <form onSubmit={submit} className="auth-form">{signup && <label>이름 <span className="caption">선택</span><input autoComplete="name" value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="어떻게 불러드릴까요?" /></label>}
        <label>이메일<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></label>
        <label>비밀번호<input type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 8 : 1} required value={password} onChange={e => setPassword(e.target.value)} placeholder={signup ? "8자 이상 입력해주세요." : "비밀번호를 입력해주세요."} /></label>
        {(error || confirmationError) && <p className="error-banner" role="alert">{error || confirmationError}</p>}
        <Button type="submit" disabled={pending}>{pending ? "처리 중…" : signup ? "개인 Inbox 시작하기" : "로그인"}<ArrowRight size={16} /></Button>
      </form><p className="auth-switch">{signup ? "이미 계정이 있으신가요?" : "처음 방문하셨나요?"} <Link href={signup ? "/login" : "/signup"}>{signup ? "로그인" : "회원가입"}</Link></p>
    </>}</main><footer className="auth-footer">나에게 들어온 것을 한곳에서, LifeInbox.</footer></div>;
}
