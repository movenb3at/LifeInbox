import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/auth/server";
import { authConfigured } from "@/lib/auth/config";
import { Shell } from "@/components/shell";
import { Setup } from "@/components/setup";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const configured = authConfigured();
  let userId = "setup";
  if (configured) {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) redirect("/login");
    userId = data.claims.sub;
  }
  return <Shell key={userId} configured={configured}>{configured ? children : <Setup />}</Shell>;
}
