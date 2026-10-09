"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
export function Dialog({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (value: boolean) => void; title: string; description?: string; children: ReactNode }) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}><DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="dialog-overlay" />
    <DialogPrimitive.Content className="dialog-content">
      <div className="dialog-header"><DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Close className="icon-button" aria-label="닫기"><X size={20} /></DialogPrimitive.Close></div>
      <DialogPrimitive.Description className={description ? "muted dialog-description" : "sr-only"}>{description || "항목 정보를 확인해주세요."}</DialogPrimitive.Description>
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal></DialogPrimitive.Root>;
}
