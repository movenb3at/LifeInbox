import { Settings2 } from "lucide-react";
export function Setup() {
  return <section className="setup-panel">
    <div className="empty-icon"><Settings2 size={24} /></div>
    <span className="eyebrow">시작하기 전에</span><h1>개인 Inbox를 연결해주세요.</h1>
    <p className="muted">Supabase 프로젝트를 연결하면 회원가입과 데이터 저장을 시작하실 수 있습니다.</p>
    <ol className="setup-steps">
      <li>새 Supabase 프로젝트를 만들고 이메일 인증을 켜주세요.</li>
      <li><code>apps/web/.env.example</code>을 <code>.env.local</code>로 복사하고 URL과 publishable key를 설정해주세요.</li>
      <li><code>apps/api/.env.example</code>을 <code>.env</code>로 복사하고 DB 연결값을 설정해주세요.</li>
      <li><code>scripts/setup-db.ps1</code>을 실행하고 두 서버를 다시 시작해주세요.</li>
    </ol><p className="caption">자세한 설정은 프로젝트의 README와 docs/setup.md에서 확인하실 수 있습니다.</p>
  </section>;
}
