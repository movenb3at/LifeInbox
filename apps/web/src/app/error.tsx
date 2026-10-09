"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) { return <div className="standalone-setup"><h1>화면을 불러오지 못했습니다.</h1><p className="muted">연결 상태를 확인하고 다시 시도해주세요.</p><Button onClick={reset}>다시 시도</Button></div>; }
