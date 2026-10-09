import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/auth/server";
import { authConfigured } from "@/lib/auth/config";

export async function GET(request: NextRequest) {
  const token_hash = request.nextUrl.searchParams.get("token_hash");
  const code = request.nextUrl.searchParams.get("code");
  if (authConfigured() && (code || (token_hash && request.nextUrl.searchParams.get("type") === "email"))) {
    const supabase = await supabaseServer();
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ type: "email", token_hash: token_hash! });
    if (!error) return NextResponse.redirect(new URL("/", process.env.APP_URL || request.url));
    const reason = code ? "confirmation_session" : "confirmation";
    return NextResponse.redirect(new URL(`/login?error=${reason}`, process.env.APP_URL || request.url));
  }
  return NextResponse.redirect(new URL("/login?error=confirmation", process.env.APP_URL || request.url));
}
