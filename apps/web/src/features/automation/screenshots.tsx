"use client";
import useSWR from "swr";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, type Screenshot, type ScreenshotPage, type ScreenshotClaim } from "@/lib/api/client";
import { useItemEditor } from "@/features/items/provider";
import { readScreenshot } from "./ocr-client";
import { SourceImage } from "./source-image";

const statusLabels: Record<string, string> = { pending: "판독 대기", processing: "판독 중", completed: "분석 완료", failed: "다시 확인 필요" };
export function ScreenshotCapture() {
  const [page, setPage] = useState(1);
  const { data, error: loadError, mutate } = useSWR<ScreenshotPage>(`automation/screenshots?page=${page}`, api);
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(""); const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<Screenshot | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const { refresh, notify } = useItemEditor();
  const input = useRef<HTMLInputElement>(null); const running = useRef(false); const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const uploadRef = useRef<(file: File) => Promise<void>>(async () => {});
  useEffect(() => {
    mounted.current = true;
    function paste(event: ClipboardEvent) {
      const images = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith("image/"));
      if (images.length) { event.preventDefault(); void uploadRef.current(images[0]); }
    }
    document.addEventListener("paste", paste);
    return () => { mounted.current = false; document.removeEventListener("paste", paste); controller.current?.abort(); };
  }, []);

  async function recognize(row: Screenshot, original?: Blob) {
    if (!mounted.current) throw new Error("판독 화면이 닫혔습니다. 보관한 스크린샷에서 다시 시도해주세요.");
    const abort = new AbortController(); controller.current = abort;
    const { claim_token } = await api<ScreenshotClaim>(`automation/screenshots/${row.id}/claim`, { method: "POST", body: "{}" });
    try {
      if (abort.signal.aborted) throw new Error("판독이 중단되었습니다. 원본은 보관한 스크린샷에서 다시 시도할 수 있습니다.");
      let image = original;
      if (!image) {
        const response = await fetch(`/api/automation/screenshots/${row.id}/image`, { cache: "no-store", signal: abort.signal });
        if (!response.ok) throw new Error("원본 이미지를 불러오지 못했습니다.");
        image = await response.blob();
      }
      const result = await readScreenshot(image, setProgress, abort.signal);
      setProgress("읽은 내용을 분석하고 있습니다…");
      return await api<Screenshot>(`automation/screenshots/${row.id}/result`, { method: "POST", body: JSON.stringify({ claim_token, ...result }) });
    } catch (cause) {
      await api(`automation/screenshots/${row.id}/failure`, { method: "POST", body: JSON.stringify({ claim_token }) }).catch(() => {});
      throw cause;
    } finally { controller.current = null; }
  }
  async function run(action: () => Promise<Screenshot>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    try {
      const row = await action();
      if (row.ocr_status === "failed") setError(row.error_message || "원본을 보존했습니다. 다시 시도해주세요.");
      else { setFile(null); notify("스크린샷 분석을 완료했습니다. 후보와 원본을 확인해주세요."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "이미지를 처리하지 못했습니다. 원본을 확인해주세요."); }
    finally { running.current = false; setBusy(false); setProgress(""); await refresh(); }
  }
  async function upload(selected: File) {
    if (running.current) return;
    setFile(selected); setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(selected.type)) { setError("PNG·JPEG·WebP 이미지만 지원합니다."); return; }
    if (!selected.size || selected.size > 5 * 1024 * 1024) { setError("이미지는 5 MiB 이하로 선택해주세요."); return; }
    await run(async () => {
      setProgress("원본 이미지를 저장하고 있습니다…");
      const row = await api<Screenshot>("automation/screenshots", { method: "POST", headers: { "Content-Type": selected.type, "X-File-Name": encodeURIComponent(selected.name) }, body: selected });
      if (row.ocr_status === "completed") return row;
      if (row.ocr_status === "failed" && row.ocr_text) return api<Screenshot>(`automation/screenshots/${row.id}/retry`, { method: "POST", body: "{}" });
      return recognize(row, selected);
    });
  }
  useEffect(() => { uploadRef.current = upload; });
  async function retry(row: Screenshot) {
    await run(async () => {
      setProgress("원본을 확인하고 있습니다…");
      const current = await api<Screenshot>(`automation/screenshots/${row.id}/retry`, { method: "POST", body: "{}" });
      return current.ocr_status === "completed" || current.ocr_text ? current : recognize(current);
    });
  }
  async function remove() {
    if (!deleting || running.current) return;
    running.current = true; setBusy(true); setError("");
    try { await api(`automation/screenshots/${deleting.id}`, { method: "DELETE" }); setDeleting(null); await refresh(); notify("원본 이미지를 삭제했습니다."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "원본을 삭제하지 못했습니다."); }
    finally { running.current = false; setBusy(false); }
  }
  return <section className="automation-panel screenshot-capture"><h2>스크린샷 가져오기</h2>
    <p className="caption">이미지를 붙여넣거나 선택하세요. 한국어·영어를 이 브라우저에서 읽고, 날짜·금액·저장 공간을 제안합니다.</p>
    <div className="image-drop" tabIndex={0} role="button" aria-label="스크린샷 선택 또는 붙여넣기" aria-disabled={busy}
      onClick={() => { if (!busy) input.current?.click(); }} onKeyDown={e => { if (!busy && ["Enter", " "].includes(e.key)) { e.preventDefault(); input.current?.click(); } }}
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) void upload(e.dataTransfer.files[0]); }}>
      <strong>{busy ? "스크린샷 처리 중" : "이미지 선택 · Ctrl+V · 끌어놓기"}</strong><span>PNG, JPEG, WebP · 최대 5 MiB · 한 번에 1장</span>
    </div>
    <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="스크린샷 파일" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => { const selected = e.target.files?.[0]; e.target.value = ""; if (selected) void upload(selected); }} />
    {busy && <p role="status" aria-live="polite">{progress}</p>}{error && <p role="alert" className="error-banner">{error}</p>}
    {file && !busy && <div className="action-row"><span className="caption">{file.name}</span><Button variant="outline" size="sm" onClick={() => upload(file)}>선택한 이미지 재시도</Button></div>}
    <p className="caption">원본은 본인 계정에 보관합니다. 스크린샷 후보는 원본을 확인한 뒤 직접 추가해주세요.</p>
    <details className="screenshot-history"><summary>보관한 스크린샷{data?.inputs.length ? ` · ${data.inputs.length}개` : ""}</summary>
      {loadError && <Button variant="outline" onClick={() => mutate()}>목록 다시 불러오기</Button>}
      {data?.inputs.map(row => <article key={row.id} className="screenshot-row"><div className="section-heading"><h3>{row.file_name}</h3><span className="caption">{statusLabels[row.ocr_status] || row.ocr_status}</span></div>
        <div className="action-row"><SourceImage id={row.id} name={row.file_name} />{row.ocr_status !== "completed" && <Button variant="outline" size="sm" disabled={busy} onClick={() => retry(row)}>판독 재시도</Button>}<Button variant="ghost" size="sm" disabled={busy} onClick={() => setDeleting(row)}>원본 삭제</Button></div>
        {row.error_message && <p className="error-banner">{row.error_message}</p>}
        {row.ocr_text && <details><summary>읽은 텍스트 · 판독 신뢰도 {Math.round((row.ocr_confidence || 0) * 100)}%</summary><p className="source-text">{row.ocr_text}</p></details>}
        {row.ocr_status === "failed" && row.ocr_text && <TextCorrection row={row} busy={busy} onSave={text => run(() => api<Screenshot>(`automation/screenshots/${row.id}/text`, { method: "PATCH", body: JSON.stringify({ text }) }))} />}
      </article>)}
      {!loadError && !data?.inputs.length && <p className="quiet-state">보관한 스크린샷이 없습니다.</p>}
      <div className="pagination"><Button variant="ghost" disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>이전</Button><span>{page} 페이지</span><Button variant="ghost" disabled={(data?.inputs.length || 0) < 20 || busy} onClick={() => setPage(page + 1)}>다음</Button></div>
    </details>
    <Dialog open={!!deleting} onOpenChange={value => { if (!value && !busy) setDeleting(null); }} title="원본 이미지를 삭제할까요?" description="판독한 텍스트와 이미 추가한 항목은 유지됩니다."><Button variant="destructive" disabled={busy} onClick={remove}>원본 이미지 삭제</Button></Dialog>
  </section>;
}

function TextCorrection({ row, busy, onSave }: { row: Screenshot; busy: boolean; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState((row.ocr_text || "").slice(0, 10000));
  return <details><summary>필요한 텍스트만 다시 분석</summary><form className="compact-form" onSubmit={e => { e.preventDefault(); void onSave(text); }}><label>분석할 텍스트<textarea value={text} required maxLength={10000} rows={5} onChange={e => setText(e.target.value)} /></label><p className="caption">필요한 문장만 남기거나 오인식한 글자를 수정하세요. 원본 판독 텍스트는 보존합니다.</p><Button disabled={busy || !text.trim()} type="submit">텍스트 다시 분석</Button></form></details>;
}
