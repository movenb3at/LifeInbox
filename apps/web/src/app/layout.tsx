import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "LifeInbox — 생활을 위한 Inbox", description: "들어온 정보를 한곳에 모으고, 잊지 않고 처리하세요." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
