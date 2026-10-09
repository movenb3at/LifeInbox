"use client";
import { createContext, useContext, useState, useEffect } from "react";
import { useSWRConfig } from "swr";
import type { Item } from "@/lib/api/client";
import { ItemEditor } from "./editor";
const Context = createContext<{ open: (item?: Item, spaceId?: string) => void; refresh: () => Promise<unknown>; notify: (message: string) => void } | null>(null);
export function ItemProvider({ children }: { children: React.ReactNode }) {
  const [editor, setEditor] = useState<{ item?: Item; spaceId?: string } | null>(null); const [toast, setToast] = useState(""); const { mutate } = useSWRConfig();
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(""), 4000); return () => clearTimeout(timer); } }, [toast]);
  async function refresh() { await mutate(key => typeof key === "string" && /^(items|dashboard|calendar|spaces|automation|notifications)/.test(key)); }
  return <Context.Provider value={{ open: (item, spaceId) => setEditor({ item, spaceId }), refresh, notify: setToast }}>{children}
    {editor && <ItemEditor item={editor.item} initialSpaceId={editor.spaceId} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); setToast("항목을 저장했습니다."); await refresh(); }} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </Context.Provider>;
}
export function useItemEditor() { const context = useContext(Context); if (!context) throw new Error("ItemProvider is required"); return context; }
