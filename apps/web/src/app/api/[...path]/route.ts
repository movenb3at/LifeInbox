import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/auth/server";
import { authConfigured } from "@/lib/auth/config";

export const dynamic = "force-dynamic";
const validPath = /^(?:me(?:\/space)?|dashboard|calendar|items(?:\/[0-9a-f-]{36}(?:\/copy)?)?|spaces(?:\/[0-9a-f-]{36}(?:\/members(?:\/[0-9a-f-]{36})?)?)?|notifications(?:\/[0-9a-f-]{36}\/read)?|automation\/(?:settings|summary|tick|integrations(?:\/[0-9a-f-]{36}\/destination)?|events(?:\/[0-9a-f-]{36}\/retry)?|candidates(?:\/[0-9a-f-]{36}(?:\/(?:accept|reject))?)?|rules(?:\/[0-9a-f-]{36})?|screenshots(?:\/[0-9a-f-]{36}(?:\/(?:image|claim|result|failure|retry|text))?)?|runs))$/;

async function readBody(request: NextRequest, limit: number) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); throw new RangeError("body too large"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (!authConfigured()) return NextResponse.json({ detail: "Supabase 설정이 필요합니다." }, { status: 503 });
  const path = (await context.params).path.join("/");
  if (!validPath.test(path)) return NextResponse.json({ detail: "경로를 찾을 수 없습니다." }, { status: 404 });
  const imageUpload = path === "automation/screenshots" && request.method === "POST";
  const mime = request.headers.get("content-type") || "";
  const limit = imageUpload ? 5 * 1024 * 1024 : /^automation\/screenshots\/[0-9a-f-]{36}\/result$/.test(path) ? 200 * 1024 : 65536;
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const expected = new URL(process.env.APP_URL || request.url).origin;
    if (!origin || origin !== expected) return NextResponse.json({ detail: "요청 출처를 확인해주세요." }, { status: 403 });
    if (imageUpload ? !["image/png", "image/jpeg", "image/webp"].includes(mime) : !mime.startsWith("application/json") && request.method !== "DELETE") {
      return NextResponse.json({ detail: imageUpload ? "PNG·JPEG·WebP 이미지만 지원합니다." : "JSON 요청이 필요합니다." }, { status: 415 });
    }
    if (Number(request.headers.get("content-length") || 0) > limit) {
      return NextResponse.json({ detail: imageUpload ? "이미지는 5 MiB 이하로 선택해주세요." : "입력 내용이 너무 깁니다." }, { status: 413 });
    }
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return NextResponse.json({ detail: "로그인이 필요합니다." }, { status: 401 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ detail: "로그인이 필요합니다." }, { status: 401 });
  try {
    const body = ["GET", "HEAD"].includes(request.method) ? undefined : await readBody(request, limit);
    const headers: Record<string, string> = { "Authorization": `Bearer ${session.access_token}`, "Content-Type": imageUpload ? mime : "application/json" };
    if (imageUpload) headers["X-File-Name"] = (request.headers.get("x-file-name") || "").slice(0, 2400);
    const upstream = await fetch(`${process.env.API_BASE_URL || "http://127.0.0.1:8000"}/api/v1/${path}${request.nextUrl.search}`, {
      method: request.method, headers,
      body, cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    const imageResponse = path.endsWith("/image") && upstream.ok;
    return new NextResponse(upstream.status === 204 ? null : await upstream.arrayBuffer(), {
      status: upstream.status, headers: { "Content-Type": imageResponse ? upstream.headers.get("content-type") || "application/octet-stream" : "application/json", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...(imageResponse ? { "Content-Disposition": "inline" } : {}) },
    });
  } catch (cause) {
    if (cause instanceof RangeError) return NextResponse.json({ detail: imageUpload ? "이미지는 5 MiB 이하로 선택해주세요." : "입력 내용이 너무 깁니다." }, { status: 413 });
    return NextResponse.json({ detail: "API에 연결할 수 없습니다. 서버 실행 상태를 확인해주세요." }, { status: 503 });
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
