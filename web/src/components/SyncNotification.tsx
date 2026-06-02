"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, X, WifiOff } from "lucide-react";
import { syncApi } from "@/lib/api";
import { useSyncStatus } from "@/store/queries";
import { cn } from "@/lib/utils";

const IN_MS  = 320;
const OUT_MS = 220;
const HOLD_MS = 5000;

interface Toast {
  id: number;
  type: "restored" | "offline";
  message: string;
}

function SyncToast({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), IN_MS + HOLD_MS);
    const t2 = setTimeout(() => onDoneRef.current(), IN_MS + HOLD_MS + OUT_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const dismiss = () => {
    setLeaving(true);
    setTimeout(() => onDoneRef.current(), OUT_MS);
  };

  const isRestored = toast.type === "restored";

  return (
    <div
      style={{
        animation: leaving
          ? `sync-out ${OUT_MS}ms ease-in forwards`
          : `sync-in ${IN_MS}ms cubic-bezier(0.34,1.56,0.64,1) forwards`,
      }}
      className={cn(
        "w-72 rounded-xl border bg-card/95 backdrop-blur-sm shadow-2xl overflow-hidden",
        isRestored ? "border-emerald-500/30" : "border-amber-500/30",
      )}
    >
      <div className="flex items-center gap-3 px-3 py-3">
        <div className={cn(
          "shrink-0 w-8 h-8 rounded-md flex items-center justify-center",
          isRestored ? "bg-emerald-500/10" : "bg-amber-500/10",
        )}>
          {isRestored
            ? <RefreshCw className="h-4 w-4 text-emerald-400" />
            : <WifiOff    className="h-4 w-4 text-amber-400" />}
        </div>
        <p className="flex-1 text-xs leading-snug text-foreground/80">{toast.message}</p>
        <button
          onClick={dismiss}
          className="shrink-0 text-muted-foreground/40 hover:text-foreground transition-colors p-0.5"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className={cn("h-0.5", isRestored ? "bg-emerald-500/20" : "bg-amber-500/20")}>
        <div
          className={cn("h-full", isRestored ? "bg-emerald-400" : "bg-amber-400")}
          style={leaving ? { width: "0%" } : {
            width: "100%",
            animation: `sync-timer ${HOLD_MS}ms linear forwards`,
            animationDelay: `${IN_MS}ms`,
          }}
        />
      </div>
      <style>{`
        @keyframes sync-in  { 0%{opacity:0;transform:translateY(20px) scale(0.9)} 60%{opacity:1;transform:translateY(-4px) scale(1.03)} 100%{opacity:1;transform:none} }
        @keyframes sync-out { 0%{opacity:1;transform:none} 100%{opacity:0;transform:translateY(10px) scale(0.92)} }
        @keyframes sync-timer { from{width:100%} to{width:0%} }
      `}</style>
    </div>
  );
}

let _nextId = 1;

export function SyncNotification() {
  const { data: status } = useSyncStatus();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const prevRestoredAt  = useRef<string | null | undefined>(undefined);
  const prevAvailable   = useRef<boolean | null | undefined>(undefined);

  useEffect(() => {
    if (!status?.enabled) return;

    const restoredAt  = status.drive_restored_at;
    const available   = status.datadir_available;

    // Drive came back online — new drive_restored_at timestamp
    if (
      prevRestoredAt.current !== undefined &&
      restoredAt &&
      restoredAt !== prevRestoredAt.current
    ) {
      setToasts((t) => [...t, {
        id: _nextId++,
        type: "restored",
        message: "Sync drive back online — mirror updated.",
      }]);
      // Trigger an immediate sync
      syncApi.trigger().catch(() => {});
    }

    prevRestoredAt.current = restoredAt;
    prevAvailable.current  = available;
  }, [status]);

  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-auto">
      {toasts.map((toast) => (
        <SyncToast key={toast.id} toast={toast} onDone={() => dismiss(toast.id)} />
      ))}
    </div>
  );
}
