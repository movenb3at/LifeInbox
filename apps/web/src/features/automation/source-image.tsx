"use client";
import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export function SourceImage({ id, name = "원본 스크린샷" }: { id: string; name?: string }) {
  const [open, setOpen] = useState(false); const [failed, setFailed] = useState(false);
  return <><Button size="sm" variant="outline" onClick={() => { setFailed(false); setOpen(true); }}>원본 이미지 보기</Button>
    <Dialog open={open} onOpenChange={setOpen} title={name} description="판독한 날짜와 금액을 원본과 비교해주세요.">
      {open && (failed ? <p className="error-banner" role="alert">원본을 불러오지 못했습니다. 삭제 여부와 연결을 확인해주세요.</p> : <div className="source-image"><Image src={`/api/automation/screenshots/${id}/image`} alt={name} fill unoptimized sizes="(max-width: 767px) 90vw, 600px" onError={() => setFailed(true)} /></div>)}
    </Dialog></>;
}
