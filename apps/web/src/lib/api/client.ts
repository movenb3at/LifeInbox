import type { components } from "./schema";
export type Item = components["schemas"]["ItemOut"];
export type ItemCreate = components["schemas"]["ItemCreate"];
export type ItemPatch = components["schemas"]["ItemPatch"];
export type ItemPage = components["schemas"]["ItemPage"];
export type Dashboard = components["schemas"]["DashboardOut"];
export type Calendar = components["schemas"]["CalendarOut"];
export type Entry = components["schemas"]["CalendarEntry"];
export type Space = components["schemas"]["SpaceOut"];
export type Candidate = components["schemas"]["CandidateOut"];
export type Rule = components["schemas"]["RuleOut"];
export type RuleInput = components["schemas"]["RuleInput"];
export type Run = components["schemas"]["RunOut"];
export type AutomationSettings = components["schemas"]["SettingsInput"];
export type AutomationSummary = components["schemas"]["SummaryOut"];
export type InboundEvent = components["schemas"]["EventOut"];
export type Integration = components["schemas"]["IntegrationOut"];
export type Notification = components["schemas"]["NotificationOut"];
export type Screenshot = components["schemas"]["ScreenshotOut"];
export type ScreenshotPage = components["schemas"]["ScreenshotPage"];
export type ScreenshotClaim = components["schemas"]["ScreenshotClaim"];

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = data.detail;
    const message = Array.isArray(detail) ? detail.map((entry: { msg: string }) => entry.msg.replace("Value error, ", "")).join(" · ") : detail;
    throw new Error(message || "요청을 처리하지 못했습니다. 다시 시도해주세요.");
  }
  return response.status === 204 ? undefined as T : response.json();
}
