export const types = {
  task: "할 일", deadline: "제출·마감", event: "일정", reservation: "예약", payment: "결제",
  delivery: "배송", purchase: "구매", return: "반품", document: "문서", note: "메모", other: "기타",
} as const;
export const statuses = { inbox: "미정리", todo: "할 일", in_progress: "진행 중", completed: "완료", archived: "보관" } as const;
export const currencies = ["KRW", "USD", "JPY", "EUR", "GBP", "CNY"] as const;
export const seoulDate = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(`${value}T00:00:00+09:00`));
}
export function timeLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value));
}
export function dueLabel(value: string) {
  const days = Math.round((Date.parse(`${value}T00:00:00+09:00`) - Date.parse(`${seoulDate()}T00:00:00+09:00`)) / 86400000);
  return days === 0 ? "오늘 마감" : days === 1 ? "내일 마감" : days < 0 ? `${-days}일 지연` : `${dateLabel(value)} · D-${days}`;
}
export function money(value: string | number, currency: string) {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency, minimumFractionDigits: ["KRW", "JPY"].includes(currency) ? 0 : 2 }).format(Number(value));
}
export function localInput(value?: string | null) {
  if (!value) return "";
  const instant = new Date(Date.parse(value) + 9 * 3600000);
  return instant.toISOString().slice(0, 16);
}
