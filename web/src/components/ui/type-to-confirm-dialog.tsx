"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmWord?: string;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export function TypeToConfirmDialog({
  open, title, description, confirmWord = "DELETE", confirmLabel, cancelLabel = "Cancel",
  pending = false, onConfirm, onClose,
}: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setValue(""); setError(null); };
  const close = () => { reset(); onClose(); };

  const handleConfirm = async () => {
    if (value !== confirmWord) return;
    try {
      await onConfirm();
      reset();
    } catch (err) {
      let message = "Action failed.";
      if (err instanceof Error) {
        const raw = err.message.replace(/^\d+: /, "");
        try { message = JSON.parse(raw).detail ?? raw; } catch { message = raw; }
      }
      setError(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="h-5 w-5 shrink-0" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Type {confirmWord} to confirm
            </Label>
            <Input
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && value === confirmWord) handleConfirm(); }}
              placeholder={confirmWord}
              autoFocus
              className="font-mono"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>{cancelLabel}</Button>
            <Button
              variant="destructive"
              disabled={value !== confirmWord || pending}
              onClick={handleConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
