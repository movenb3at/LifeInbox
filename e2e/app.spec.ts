/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

type FixtureItem = { id: string; space_id: string; creator_id: string; title: string; description: string; type: string; status: string; deadline: string | null; start_datetime: string | null; end_datetime: string | null; amount: string | null; currency: string; source_type: string; source_text: string; created_at: string; updated_at: string; completed_at: string | null };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const month = today.slice(0, 7);

async function fixture(page: Page, initial: FixtureItem[] = [], extraSpaces: { id: string; name: string; type: string; is_default: boolean; role: string }[] = []) {
  const session = await (await page.request.get("http://127.0.0.1:54329/test/session")).json();
  await page.context().addCookies([{ name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, domain: "localhost", path: "/", sameSite: "Lax" }]);
  let items = initial;
  let spaces = [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "개인 Inbox", type: "personal", is_default: true, role: "owner" }, ...extraSpaces];
  let settings = { level: "suggest", capture_threshold: 0.95, review_threshold: 0.70 };
  let rules: any[] = [], candidates: any[] = [], events: any[] = [], notifications: any[] = [];
  const runs: any[] = [];
  const integrations = [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", provider: "manual_share", status: "active", last_synced_at: null, default_space_id: null as string | null }];
  let failNext = false;
  let failOcrResult = false;
  const screenshots: any[] = [];
  const screenshotBytes = new Map<string, Buffer>();
  await page.route("http://localhost:3001/api/**", async route => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname.replace("/api/", "");
    if (path === "me") return route.fulfill({ json: { id: "11111111-1111-4111-8111-111111111111", display_name: "테스트", timezone: "Asia/Seoul" } });
    if (path === "automation/screenshots") {
      if (req.method() === "GET") return route.fulfill({ json: { provider: "tesseract", inputs: screenshots.filter(row => row.ocr_status !== "deleted") } });
      const bytes = req.postDataBuffer()!;
      const existing = screenshots.find(row => screenshotBytes.get(row.id)?.equals(bytes));
      if (existing) return route.fulfill({ status: 202, json: existing });
      const row = { id: crypto.randomUUID(), inbound_event_id: crypto.randomUUID(), file_name: decodeURIComponent(req.headers()["x-file-name"] || "screenshot.png"), mime_type: req.headers()["content-type"], width: 1200, height: 360, ocr_status: "pending", ocr_text: null, ocr_confidence: null, provider: "tesseract", error_message: null, attempts: 0, created_at: new Date().toISOString(), processed_at: null };
      screenshots.push(row); screenshotBytes.set(row.id, bytes);
      return route.fulfill({ status: 202, json: row });
    }
    if (path.startsWith("automation/screenshots/")) {
      const row = screenshots.find(row => row.id === path.split("/")[2]);
      if (!row) return route.fulfill({ status: 404, json: { detail: "원본을 찾을 수 없습니다." } });
      if (path.endsWith("/image")) return route.fulfill({ body: screenshotBytes.get(row.id), contentType: row.mime_type, headers: { "Cache-Control": "private, no-store" } });
      if (path.endsWith("/claim")) { row.ocr_status = "processing"; row.attempts++; return route.fulfill({ json: { claim_token: crypto.randomUUID() } }); }
      if (path.endsWith("/failure")) { row.ocr_status = "failed"; row.error_message = "이미지 판독을 완료하지 못했습니다. 원본을 보존했습니다."; }
      if (path.endsWith("/result")) {
        if (failOcrResult) { failOcrResult = false; return route.fulfill({ status: 503, json: { detail: "연결이 끊겼습니다. 원본은 저장되어 있습니다." } }); }
        const body = req.postDataJSON(); row.ocr_text = body.text; row.ocr_confidence = body.confidence / 100; row.ocr_status = "completed"; row.error_message = null;
        const payload = { title: body.text.split("\n")[0], description: body.text, type: "payment", deadline: today, amount: "35000", currency: "KRW", start_datetime: null, end_datetime: null };
        candidates.push({ id: crypto.randomUUID(), inbound_event_id: row.inbound_event_id, source_image_id: row.id, candidate_index: 0, suggested_space_id: spaces[0].id, suggested_assignee_id: null, payload, original_payload: { ...payload }, corrections: [], confidence: .92,
          field_confidences: { ocr: { value: row.id, confidence: row.ocr_confidence, reason: "원본 이미지와 날짜·금액을 확인해주세요.", source: "ocr", needs_review: true } }, original_field_confidences: {}, review_fields: ["ocr"], routing_source: "default", routing_reason: "기본 공간을 사용했습니다.", explanations: [], status: "pending", item_id: null, created_at: new Date().toISOString() });
      }
      if (req.method() === "DELETE") { row.ocr_status = "deleted"; screenshotBytes.delete(row.id); candidates.forEach(c => { if (c.source_image_id === row.id) c.source_image_id = null; }); return route.fulfill({ status: 204 }); }
      return route.fulfill({ json: row });
    }
    if (path === "spaces") {
      if (req.method() === "POST") { const space = { ...req.postDataJSON(), id: crypto.randomUUID(), is_default: false, role: "owner" }; spaces.push(space); return route.fulfill({ status: 201, json: space }); }
      return route.fulfill({ json: spaces });
    }
    if (path.startsWith("spaces/")) {
      const space = spaces.find(s => s.id === path.split("/")[1]);
      if (!space) return route.fulfill({ status: 404, json: { detail: "저장 공간을 찾을 수 없습니다." } });
      if (path.endsWith("/members")) return route.fulfill({ json: [] });
      if (req.method() === "DELETE") {
        if (space.is_default || items.some(item => item.space_id === space.id)) return route.fulfill({ status: 409, json: { detail: "기본 공간 또는 항목이 있는 공간은 삭제할 수 없습니다." } });
        spaces = spaces.filter(s => s.id !== space.id); return route.fulfill({ status: 204 });
      }
      const body = req.postDataJSON(); if (body.is_default) spaces.forEach(s => s.is_default = false); Object.assign(space, body); return route.fulfill({ json: space });
    }
    if (path === "automation/settings") {
      if (req.method() === "PATCH") Object.assign(settings, req.postDataJSON());
      return route.fulfill({ json: settings });
    }
    if (path === "automation/summary") return route.fulfill({ json: { active_rules: rules.filter(r => r.is_enabled).length, today_processed: 0, review_count: candidates.filter(c => c.status === "pending").length, failed_count: 0, unread_notifications: notifications.filter(n => n.status === "delivered" && !n.read_at).length } });
    if (path === "automation/integrations") return route.fulfill({ json: integrations });
    if (path.endsWith("/destination")) { integrations[0].default_space_id = req.postDataJSON().space_id; return route.fulfill({ json: integrations[0] }); }
    if (path === "automation/rules") {
      if (req.method() === "POST") { const rule = { ...req.postDataJSON(), id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; rules.push(rule); return route.fulfill({ status: 201, json: rule }); }
      return route.fulfill({ json: rules });
    }
    if (path.startsWith("automation/rules/")) {
      const rule = rules.find(r => r.id === path.split("/")[2]);
      if (req.method() === "DELETE") { rules = rules.filter(r => r !== rule); return route.fulfill({ status: 204 }); }
      Object.assign(rule, req.postDataJSON()); return route.fulfill({ json: rule });
    }
    if (path === "automation/events") {
      if (req.method() === "GET") return route.fulfill({ json: events });
      const body = req.postDataJSON(), now = new Date().toISOString();
      const event = { id: crypto.randomUUID(), source_type: body.source_type, external_id: crypto.randomUUID(), raw_content: body, normalized_content: {}, status: "processed", error_message: null, attempts: 1, received_at: now, processed_at: now }; events.push(event);
      const payload = { title: body.title || body.content, description: body.content, type: "payment", deadline: today, amount: "35000", currency: "KRW", start_datetime: null, end_datetime: null };
      const target = rules.find(r => r.is_enabled && r.trigger_type === "candidate_created")?.actions.find((a: any) => a.type === "move_to_space")?.value || spaces.find(s => s.is_default)!.id;
      candidates.push({ id: crypto.randomUUID(), inbound_event_id: event.id, candidate_index: 0, suggested_space_id: target, suggested_assignee_id: null, payload, original_payload: { ...payload }, corrections: [], confidence: 0.92,
        field_confidences: { space: { value: target, confidence: .8, reason: "본문의 공간 이름을 제안했습니다.", source: "parser", needs_review: false }, type: { value: "payment", confidence: .95, reason: "결제 표현을 확인했습니다.", source: "parser", needs_review: false } },
        original_field_confidences: {}, review_fields: ["space"], routing_source: "parser", routing_reason: "본문의 저장 공간을 확인해주세요.",
        explanations: ["금액과 날짜 표현을 추출했습니다."], status: "pending", item_id: null, created_at: now });
      return route.fulfill({ status: 201, json: event });
    }
    if (path === "automation/candidates") return route.fulfill({ json: candidates.filter(c => c.status === (url.searchParams.get("status") || "pending")) });
    if (path.startsWith("automation/candidates/")) {
      const candidate = candidates.find(c => c.id === path.split("/")[2]);
      if (path.endsWith("/accept")) { if (!candidate.item_id) { const item = sample({ ...candidate.payload, space_id: candidate.suggested_space_id, source_text: candidate.payload.description }); items.push(item); candidate.item_id = item.id; candidate.status = "accepted"; } }
      else if (path.endsWith("/reject")) candidate.status = "rejected";
      else {
        const body = req.postDataJSON(); candidate.corrections.push({ before: { ...candidate.payload }, after: body.fields }); Object.assign(candidate.payload, body.fields);
        if (body.suggested_space_id) { candidate.suggested_space_id = body.suggested_space_id; candidate.review_fields = []; candidate.routing_source = "user"; candidate.routing_reason = "사용자가 저장 공간을 직접 지정했습니다."; candidate.field_confidences.space.confidence = 1; }
        if (body.fields?.type) { candidate.field_confidences.type.value = body.fields.type; candidate.field_confidences.type.confidence = 1; }
      }
      return route.fulfill({ json: candidate });
    }
    if (path === "automation/runs") return route.fulfill({ json: runs });
    if (path === "notifications") return route.fulfill({ json: notifications });
    if (path.startsWith("notifications/")) { const notification = notifications.find(n => n.id === path.split("/")[1]); notification.read_at = new Date().toISOString(); return route.fulfill({ json: notification }); }
    if (failNext && req.method() === "POST") { failNext = false; return route.fulfill({ status: 503, json: { detail: "저장 연결이 끊겼습니다." } }); }
    if (path === "items" && req.method() === "POST") {
      const body = req.postDataJSON(); const item = sample({ ...body, space_id: body.space_id || spaces.find(s => s.is_default)!.id, id: crypto.randomUUID() }); items.unshift(item); return route.fulfill({ status: 201, json: item });
    }
    if (path.startsWith("items/")) {
      const id = path.split("/")[1]; const item = items.find(i => i.id === id);
      if (!item) return route.fulfill({ status: 404, json: { detail: "항목을 찾을 수 없습니다." } });
      if (path.endsWith("/copy")) { const copied = sample({ ...item, id: crypto.randomUUID(), space_id: req.postDataJSON().space_id }); items.push(copied); return route.fulfill({ status: 201, json: copied }); }
      if (req.method() === "DELETE") { items = items.filter(i => i.id !== id); return route.fulfill({ status: 204 }); }
      if (req.method() === "PATCH") { Object.assign(item, req.postDataJSON()); item.completed_at = item.status === "completed" ? new Date().toISOString() : null; }
      return route.fulfill({ json: item });
    }
    if (path === "items") {
      const q = url.searchParams.get("q") || "", status = url.searchParams.get("status"), type = url.searchParams.get("type"), current = Number(url.searchParams.get("page") || 1);
      const rows = items.filter(i => (!status || i.status === status) && (!type || i.type === type) && (!url.searchParams.get("space_id") || i.space_id === url.searchParams.get("space_id")) && `${i.title} ${i.description} ${i.source_text}`.includes(q));
      return route.fulfill({ json: { items: rows.slice((current - 1) * 20, current * 20), total: rows.length, page: current, page_size: 20 } });
    }
    if (path === "dashboard") {
      const active = items.filter(i => !["completed", "archived"].includes(i.status)); const related = active.filter(i => i.deadline === today);
      const payments: Record<string, string> = {}; for (const item of active.filter(i => i.type === "payment" && i.amount)) payments[item.currency] = item.amount!;
      return route.fulfill({ json: { today, inbox_count: active.filter(i => i.status === "inbox").length, today_count: related.length, today_items: related, overdue_count: 0, overdue_items: [], week_deadline_count: related.length, payments, payment_missing_amount_count: 0 } });
    }
    if (path === "calendar") {
      return route.fulfill({ json: { month: url.searchParams.get("month"), entries: items.filter(i => i.status !== "archived").flatMap(i => [
        ...(i.deadline?.startsWith(url.searchParams.get("month") || "") ? [{ id: `${i.id}:deadline`, kind: "deadline", item: i }] : []),
        ...(i.start_datetime ? [{ id: `${i.id}:schedule`, kind: "schedule", item: i }] : []),
      ]) } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return { failNextSave() { failNext = true; }, failNextOcrResult() { failOcrResult = true; }, setNotifications(value: any[]) { notifications = value; }, setRuns(value: any[]) { runs.push(...value); }, screenshots };
}
function sample(overrides: Partial<FixtureItem> = {}): FixtureItem {
  return { id: crypto.randomUUID(), space_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", creator_id: "11111111-1111-4111-8111-111111111111", title: "테스트 항목", description: "", type: "other", status: "inbox", deadline: null, start_datetime: null, end_datetime: null, amount: null, currency: "KRW", source_type: "manual", source_text: "처음 저장한 내용", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null, ...overrides };
}

test("local Korean screenshot OCR, source review, dedupe and image-only deletion", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const state = await fixture(page);
  const external: string[] = [], assets: string[] = [];
  page.context().on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/ocr/")) assets.push(url.pathname);
    if (!["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol.startsWith("http")) external.push(url.href);
  });
  await page.goto("/automation");
  await page.getByLabel("스크린샷 파일", { exact: true }).setInputFiles("e2e/fixtures/ocr-korean.png");
  const candidate = page.locator(".candidate-list .automation-panel");
  await expect(candidate.getByRole("heading", { name: "학교 납부 안내" })).toBeVisible({ timeout: 60000 });
  expect(state.screenshots[0].ocr_text).toContain("10월 20일까지 35,000원 입금해주세요.");
  await expect(candidate.getByText("확인할 필드: 이미지 판독")).toBeVisible();
  expect(external).toEqual([]);
  expect(assets).toContain("/ocr/worker.min.js");
  expect(assets.some(path => path.includes("kor.traineddata"))).toBeTruthy();
  await candidate.getByRole("button", { name: "원본 이미지 보기" }).click();
  await expect(page.getByRole("dialog").getByRole("img")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "닫기" }).click();
  await page.getByLabel("스크린샷 파일", { exact: true }).setInputFiles("e2e/fixtures/ocr-korean.png");
  await expect(candidate).toHaveCount(1); expect(state.screenshots).toHaveLength(1);
  await candidate.getByRole("button", { name: "추가", exact: true }).click();
  await expect(candidate).toHaveCount(0);
  await page.getByText("보관한 스크린샷 · 1개", { exact: true }).click();
  await page.getByRole("button", { name: "원본 삭제", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "원본 이미지 삭제", exact: true }).click();
  await expect(page.getByText("보관한 스크린샷이 없습니다.")).toBeVisible();
  await page.goto("/inbox");
  await expect(page.getByText("학교 납부 안내", { exact: true })).toBeVisible();
  await noOverflow(page);
  await mkdir(".local/screenshots", { recursive: true });
  await page.screenshot({ path: `.local/screenshots/ocr-${testInfo.project.name}.png`, fullPage: true });
});

test("image paste preserves original across failed OCR result and reload retry", async ({ page }) => {
  test.setTimeout(120000);
  const state = await fixture(page); state.failNextOcrResult();
  await page.goto("/automation");
  await expect(page.locator(".metric-strip")).toBeVisible();
  const encoded = (await readFile("e2e/fixtures/ocr-korean.png")).toString("base64");
  await page.evaluate(base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], "붙여넣은 이미지.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, encoded);
  await expect(page.getByRole("alert").filter({ hasText: "원본은 저장되어 있습니다." })).toBeVisible({ timeout: 60000 });
  expect(state.screenshots).toHaveLength(1); expect(state.screenshots[0].ocr_status).toBe("failed");
  await page.reload();
  await page.getByText("보관한 스크린샷 · 1개", { exact: true }).click();
  await page.getByRole("button", { name: "판독 재시도", exact: true }).click();
  await expect(page.locator(".candidate-list").getByRole("heading", { name: "학교 납부 안내" })).toBeVisible({ timeout: 60000 });
  expect(state.screenshots).toHaveLength(1); expect(state.screenshots[0].attempts).toBe(2);
  await noOverflow(page);
});
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }

test("capture, edit, complete, archive, search, restore and delete", async ({ page }) => {
  await fixture(page); await page.goto("/inbox"); await expect(page.getByText("아직 아무것도 없습니다.")).toBeVisible();
  await page.getByRole("button", { name: "새 항목", exact: true }).click();
  await page.getByLabel("제목", { exact: true }).fill("우유 결제"); await page.getByRole("button", { name: "상세 정보" }).click();
  await page.getByLabel("종류", { exact: true }).selectOption("payment"); await page.getByLabel("마감일").fill(today);
  await page.getByLabel("통화", { exact: true }).selectOption("USD"); await page.getByLabel("금액", { exact: true }).fill("19.99");
  await page.getByRole("button", { name: "저장", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("우유 결제", { exact: true })).toBeVisible(); await page.getByText("우유 결제", { exact: true }).click();
  await page.getByLabel("제목", { exact: true }).fill("우유 정기 결제"); await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByRole("link", { name: "홈", exact: true }).click(); await expect(page.getByText("US$19.99", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Inbox", exact: true }).click(); await page.getByRole("button", { name: "우유 정기 결제 완료", exact: true }).click();
  await page.getByRole("tab", { name: "완료", exact: true }).click(); await expect(page.getByText("우유 정기 결제", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "우유 정기 결제 보관", exact: true }).click(); await page.getByRole("link", { name: "검색", exact: true }).click();
  await page.getByRole("textbox", { name: "검색어" }).fill("우유"); await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("검색 결과 1개")).toBeVisible(); await page.getByRole("button", { name: "우유 정기 결제 복원", exact: true }).click();
  await page.getByRole("button", { name: "우유 정기 결제 삭제", exact: true }).click(); await page.getByRole("button", { name: "영구 삭제" }).click();
  await expect(page.getByText("검색 결과가 없습니다.")).toBeVisible(); await noOverflow(page);
});

test("failed save keeps input and currency precision is validated", async ({ page }) => {
  const state = await fixture(page); await page.goto("/inbox"); await page.getByRole("button", { name: "새 항목", exact: true }).click();
  await page.getByLabel("제목", { exact: true }).fill("반품 마감"); state.failNextSave();
  await page.getByRole("button", { name: "저장", exact: true }).click(); await expect(page.getByRole("alert")).toHaveText("저장 연결이 끊겼습니다.");
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("반품 마감"); await page.getByRole("button", { name: "상세 정보" }).click();
  await page.getByLabel("금액", { exact: true }).fill("1.5");
  expect(await page.getByLabel("금액", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.stepMismatch)).toBe(true);
  await page.getByLabel("통화", { exact: true }).selectOption("USD"); await page.getByRole("button", { name: "저장", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("calendar preserves deadline and schedule, month navigation and responsive layout", async ({ page }, testInfo) => {
  await fixture(page, [sample({ title: "치과 예약", type: "reservation", deadline: today, start_datetime: `${today}T14:00:00+09:00`, end_datetime: `${today}T15:00:00+09:00` }), sample({ title: "수행평가 제출", type: "deadline", deadline: today }), sample({ title: "완료한 예약", status: "completed", deadline: today })]);
  await page.goto("/calendar"); await expect(page.locator(".day-agenda").getByText("치과 예약", { exact: true })).toHaveCount(2);
  await expect(page.locator(".day-agenda").getByText("완료한 예약")).toBeVisible();
  await page.getByRole("button", { name: "다음 달" }).click(); await page.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(page.locator(".calendar-toolbar h2")).toContainText(`${Number(month.slice(5))}월`); await noOverflow(page);
  await mkdir(".local/screenshots", { recursive: true }); await page.screenshot({ path: `.local/screenshots/calendar-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("link", { name: "홈", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("기억은 여기에,");
  await expect(page.getByText("정리할 항목", { exact: true })).toBeVisible();
  await noOverflow(page); await page.screenshot({ path: `.local/screenshots/home-${testInfo.project.name}.png`, fullPage: true });
});

test("item status can be organized through the editor on every screen size", async ({ page }) => {
  await fixture(page, [sample({ title: "준비할 서류" })]); await page.goto("/inbox");
  await page.getByText("준비할 서류", { exact: true }).click();
  await page.getByLabel("상태", { exact: true }).selectOption("in_progress");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("준비할 서류", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "진행 중", exact: true }).click();
  await expect(page.getByText("준비할 서류", { exact: true })).toBeVisible();
});

test("signup waits for email confirmation", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("이메일", { exact: true }).fill("test@example.com");
  await page.getByLabel("비밀번호", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "개인 Inbox 시작하기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "메일함을 확인해주세요." })).toBeVisible();
  await expect(page.getByText(/test@example.com로 인증 링크/)).toBeVisible();
});

test("unauthenticated pages redirect, login and logout work", async ({ page }) => {
  await page.goto("/inbox"); await expect(page).toHaveURL(/\/login$/);
  await fixture(page); await page.context().clearCookies(); await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill("test@example.com"); await page.getByLabel("비밀번호", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click(); await expect(page).toHaveURL("http://localhost:3001/");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click(); await expect(page).toHaveURL(/\/login$/);
});

test("BFF rejects cross-origin writes", async ({ request }) => {
  const response = await request.post("/api/items", { data: { title: "forged" }, headers: { Origin: "https://other.example" } });
  expect(response.status()).toBe(403);
});

test("BFF limits image formats and upload size separately from JSON", async ({ request }) => {
  const origin = { Origin: "http://localhost:3001" };
  const svg = await request.post("/api/automation/screenshots", { headers: { ...origin, "Content-Type": "image/svg+xml" }, data: "<svg/>" });
  expect(svg.status()).toBe(415);
  const largeImage = await request.post("/api/automation/screenshots", { headers: { ...origin, "Content-Type": "image/png" }, data: Buffer.alloc(5 * 1024 * 1024 + 1) });
  expect(largeImage.status()).toBe(413);
  const largeResult = await request.post("/api/automation/screenshots/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/result", { headers: origin, data: { text: "x".repeat(200 * 1024) } });
  expect(largeResult.status()).toBe(413);
  const ordinary = await request.post("/api/automation/events", { headers: origin, data: { content: "x".repeat(65536) } });
  expect(ordinary.status()).toBe(413);
});

test("missing OCR model preserves original and permits recovery", async ({ page }) => {
  test.setTimeout(120000);
  const state = await fixture(page);
  await page.route("**/ocr/lang/kor.traineddata", route => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/automation");
  await page.getByLabel("스크린샷 파일", { exact: true }).setInputFiles("e2e/fixtures/ocr-korean.png");
  await expect(page.getByRole("alert").filter({ hasText: "OCR 파일을 불러오지 못했습니다." })).toBeVisible();
  expect(state.screenshots).toHaveLength(1); expect(state.screenshots[0].ocr_status).toBe("failed");
  await page.unroute("**/ocr/lang/kor.traineddata");
  await page.getByRole("button", { name: "선택한 이미지 재시도", exact: true }).click();
  await expect(page.locator(".candidate-list").getByRole("heading", { name: "학교 납부 안내" })).toBeVisible({ timeout: 60000 });
  expect(state.screenshots).toHaveLength(1);
});

test("switching tabs stops OCR and leaves original for retry", async ({ page }) => {
  const state = await fixture(page);
  let release: (() => void) | undefined;
  await page.route("**/ocr/lang/kor.traineddata", async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: 503, body: "cancelled" }).catch(() => {});
  });
  await page.goto("/automation");
  await page.getByLabel("스크린샷 파일", { exact: true }).setInputFiles("e2e/fixtures/ocr-korean.png");
  await expect.poll(() => state.screenshots[0]?.ocr_status).toBe("processing");
  await page.getByRole("tab", { name: "설정", exact: true }).click();
  await expect.poll(() => state.screenshots[0]?.ocr_status).toBe("failed");
  release?.();
  await page.getByRole("tab", { name: "수집·확인", exact: true }).click();
  await page.getByText("보관한 스크린샷 · 1개", { exact: true }).click();
  await expect(page.getByRole("button", { name: "원본 이미지 보기", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "판독 재시도", exact: true })).toBeEnabled();
});

test("confirmation session failure offers login without claiming email is expired", async ({ page }) => {
  await page.goto("/auth/confirm?code=invalid-test-code");
  await expect(page).toHaveURL(/\/login\?error=confirmation_session$/);
  const confirmationNotice = page.locator(".auth-form").getByRole("alert");
  await expect(confirmationNotice).toContainText("가입하신 이메일과 비밀번호로 로그인해주세요.");
  await expect(confirmationNotice).not.toContainText("만료");
});

test("multiple Personal Spaces, default capture, move and copy preserve items", async ({ page }) => {
  await fixture(page); await page.goto("/spaces");
  await page.getByLabel("공간 이름").fill("학교"); await page.getByRole("button", { name: "만들기", exact: true }).click();
  const school = page.locator("article").filter({ has: page.getByRole("link", { name: "학교", exact: true }) });
  await expect(school).toBeVisible(); await school.getByRole("button", { name: "기본으로 지정" }).click(); await expect(school.getByText("기본 Inbox")).toBeVisible();
  await page.getByRole("button", { name: "새 항목", exact: true }).click(); await page.getByLabel("제목", { exact: true }).fill("학교 새 기록"); await page.getByRole("button", { name: "저장", exact: true }).click();
  await school.getByRole("link", { name: "열기", exact: true }).click(); await expect(page.getByRole("heading", { name: "학교", exact: true })).toBeVisible(); await expect(page.getByText("학교 새 기록", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "학교 새 기록 상세 보기" }).click(); await page.getByLabel("저장 공간", { exact: true }).selectOption({ label: "개인 Inbox" }); await page.getByRole("button", { name: "선택 공간에 복사" }).click();
  await page.getByLabel("저장 공간 필터").selectOption(""); await expect(page.getByText("학교 새 기록", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "학교 새 기록 상세 보기" }).first().click(); await page.getByLabel("저장 공간", { exact: true }).selectOption({ label: "개인 Inbox" }); await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByLabel("저장 공간 필터").selectOption({ label: "학교" }); await expect(page.getByText("아직 아무것도 없습니다.")).toBeVisible(); await noOverflow(page);
  await page.getByLabel("저장 공간 필터").selectOption({ label: "개인 Inbox" });
  await page.getByRole("button", { name: "학교 새 기록 상세 보기" }).first().click();
  await page.getByLabel("저장 공간", { exact: true }).selectOption(""); await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByLabel("저장 공간 필터").selectOption({ label: "학교" }); await expect(page.getByText("학교 새 기록", { exact: true })).toHaveCount(1);
});

test("manual sharing, review correction, rules and source history work", async ({ page }, testInfo) => {
  await fixture(page, [], [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "학교", type: "personal", is_default: false, role: "owner" }]);
  await page.goto("/automation"); await page.getByRole("tab", { name: "규칙", exact: true }).click(); await page.getByRole("button", { name: "새 규칙", exact: true }).click();
  await page.getByLabel("규칙 이름").fill("학교 결제 분류"); await page.getByLabel("대상 공간").selectOption({ label: "학교" }); await page.getByRole("button", { name: "규칙 저장" }).click(); await expect(page.getByRole("heading", { name: /학교 결제 분류/ })).toBeVisible();
  await page.getByRole("tab", { name: "수집·확인", exact: true }).click(); await page.getByLabel("제목", { exact: true }).fill("수련회비 납부"); await page.getByLabel("원본 내용").fill("10월 20일까지 35,000원 입금해주세요."); await page.getByRole("button", { name: "분석하기" }).click();
  const candidate = page.locator("article").filter({ has: page.getByRole("heading", { name: "수련회비 납부", exact: true }) }); await expect(candidate.locator(".space-label")).toHaveText("학교"); await expect(candidate.getByText("전체 신뢰도 92%")).toBeVisible();
  await candidate.getByRole("button", { name: "수정", exact: true }).click(); await page.getByRole("dialog").getByLabel("제목", { exact: true }).fill("수련회비 확인"); await page.getByRole("button", { name: "후보 저장" }).click();
  await page.getByRole("button", { name: "현재 목록 모두 추가" }).click(); await expect(page.getByText("이 상태의 후보가 없습니다.")).toBeVisible();
  await page.getByRole("tab", { name: "수집·확인", exact: true }).click(); await page.getByText("원본 수집 기록", { exact: true }).click(); await page.getByText("원본 보기", { exact: true }).click(); await expect(page.getByText("10월 20일까지 35,000원 입금해주세요.", { exact: true })).toBeVisible();
  await noOverflow(page); await mkdir(".local/screenshots", { recursive: true }); await page.screenshot({ path: `.local/screenshots/automation-${testInfo.project.name}.png`, fullPage: true });
  await page.goto("/inbox"); await expect(page.getByText("수련회비 확인", { exact: true })).toBeVisible();
});

test("field review, quick corrections and integration rule scopes persist", async ({ page }, testInfo) => {
  await fixture(page, [], [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "학교", type: "personal", is_default: false, role: "owner" }]);
  await page.goto("/automation"); await page.getByLabel("제목", { exact: true }).fill("학교 후보"); await page.getByLabel("원본 내용").fill("학교 결제 안내"); await page.getByRole("button", { name: "분석하기" }).click();
  const candidate = page.locator("article").filter({ has: page.getByRole("heading", { name: "학교 후보", exact: true }) });
  await expect(candidate.getByText("확인할 필드: 저장 공간")).toBeVisible();
  await candidate.getByText("필드별 신뢰도·분석 근거", { exact: true }).click(); await expect(candidate.getByText("저장 공간 · 80% · 확인 필요")).toBeVisible();
  await noOverflow(page); await page.evaluate(() => window.scrollTo(0, 0)); await mkdir(".local/screenshots", { recursive: true }); await page.screenshot({ path: `.local/screenshots/phase-one-review-${testInfo.project.name}.png`, fullPage: true });
  await candidate.getByLabel("학교 후보 저장 공간 변경").selectOption({ label: "학교" }); await expect(candidate.getByText("확인할 필드: 저장 공간")).toHaveCount(0);
  await candidate.getByLabel("학교 후보 종류 변경").selectOption("task"); await expect(candidate.getByLabel("학교 후보 종류 변경")).toHaveValue("task");
  await page.getByRole("tab", { name: "규칙", exact: true }).click(); await page.getByRole("button", { name: "새 규칙", exact: true }).click();
  await page.getByLabel("규칙 이름").fill("경로별 분류"); await page.getByLabel("규칙 범위", { exact: true }).selectOption("integration"); await page.getByLabel("적용 수집 경로").selectOption({ label: "수동 공유" }); await page.getByLabel("대상 공간").selectOption({ label: "학교" });
  await page.getByRole("button", { name: "규칙 저장" }).click();
  const rule = page.locator("article").filter({ has: page.getByRole("heading", { name: /경로별 분류/ }) }); await expect(rule.getByText(/수집 경로 규칙/)).toBeVisible();
  await rule.getByRole("button", { name: "중지", exact: true }).click(); await rule.getByRole("button", { name: "수정", exact: true }).click();
  await expect(page.getByLabel("규칙 범위", { exact: true })).toHaveValue("integration"); await expect(page.getByLabel("적용 수집 경로")).toHaveValue("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  await page.getByLabel("규칙 범위", { exact: true }).selectOption("space"); await page.getByLabel("적용 공간", { exact: true }).selectOption({ label: "학교" }); await page.getByRole("button", { name: "규칙 저장" }).click();
  await expect(rule.getByText(/공간 규칙/)).toBeVisible(); await noOverflow(page);
});

test("automation settings, explanation and notification read state are visible", async ({ page }) => {
  const f = await fixture(page, [], [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "학교", type: "personal", is_default: false, role: "owner" }]); const now = new Date().toISOString();
  f.setNotifications([{ id: crypto.randomUUID(), item_id: null, rule_id: null, title: "결제 확인", message: "마감 2일 전 알림", status: "delivered", read_at: null, scheduled_for: now, created_at: now }]);
  f.setRuns([{ id: crypto.randomUUID(), rule_name: "학교 이메일", status: "success", executed_at: now, input_snapshot: { entity: { title: "안내" }, conditions: [{ field: "sender_domain", operator: "equals", value: "school.kr", matched: true }] }, output_snapshot: { actions: ["학교 공간으로 분류했습니다."] }, error_message: null }]);
  await page.goto("/automation"); await page.getByRole("tab", { name: "설정", exact: true }).click(); await page.getByLabel("자동화 수준").selectOption("auto_action"); await page.getByLabel("자동 저장 신뢰도").fill("0.9"); await page.getByRole("button", { name: "설정 저장" }).click(); await expect(page.getByRole("status").filter({ hasText: "자동화 설정을 저장했습니다." })).toBeVisible();
  await page.getByLabel("수동 공유의 기본 저장 공간").selectOption({ label: "학교" }); await page.getByRole("button", { name: "설정 저장" }).click();
  await page.getByRole("tab", { name: "규칙", exact: true }).click(); await page.getByRole("tab", { name: "설정", exact: true }).click();
  await expect(page.getByLabel("수동 공유의 기본 저장 공간")).toHaveValue("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  await page.getByLabel("수동 공유의 기본 저장 공간").selectOption(""); await page.getByRole("button", { name: "설정 저장" }).click();
  await page.getByRole("tab", { name: "규칙", exact: true }).click(); await page.getByRole("tab", { name: "설정", exact: true }).click();
  await expect(page.getByLabel("수동 공유의 기본 저장 공간")).toHaveValue("");
  await page.getByRole("tab", { name: "실행 기록", exact: true }).click(); await page.getByText("왜 이렇게 처리됐나요?", { exact: true }).click(); await expect(page.getByText(/school.kr/)).toBeVisible(); await expect(page.getByText("학교 공간으로 분류했습니다.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^알림/ }).click(); await page.getByRole("button", { name: "읽음 처리" }).click(); await expect(page.getByText(/읽음$/)).toBeVisible(); await noOverflow(page);
});

test("Shared Viewer sees content and cannot change it in the UI", async ({ page }) => {
  const sharedId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await fixture(page, [sample({ title: "공유 읽기", space_id: sharedId })], [{ id: sharedId, name: "공유 공간", type: "shared", is_default: false, role: "viewer" }]);
  await page.goto("/inbox"); await expect(page.getByText("공유 읽기", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "공유 읽기 완료", exact: true })).toBeDisabled(); await expect(page.getByRole("button", { name: "공유 읽기 삭제", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "공유 읽기 상세 보기", exact: true }).click(); await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled(); await expect(page.getByText("이 공간은 읽기 전용입니다. 다른 공간에 복사할 수 있습니다.")).toBeVisible(); await noOverflow(page);
});
