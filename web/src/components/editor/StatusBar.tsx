"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Loader2, Circle, PenLine } from "lucide-react";
import { useUIStore } from "@/store/ui";
import { formatWordCount } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Props {
  sceneWordCount: number;
}

const STATUS_CONFIG = {
  saved:    { icon: CheckCircle2, label: "Saved",           className: "text-green-500" },
  saving:   { icon: Loader2,      label: "Saving…",         className: "text-yellow-500 animate-spin" },
  error:    { icon: AlertCircle,  label: "Unsaved changes", className: "text-red-500" },
  idle:     { icon: Circle,       label: "",                className: "text-muted-foreground" },
  unsaved:  { icon: PenLine,      label: "Unsaved",         className: "text-muted-foreground" },
};

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function SaveIndicator() {
  const saveStatus = useUIStore((s) => s.saveStatus);
  const { icon: Icon, label, className } = STATUS_CONFIG[saveStatus];
  if (!label) return null;
  return (
    <div className={`absolute top-2 left-3 z-10 flex items-center gap-1.5 text-xs pointer-events-none ${className}`}>
      <Icon className={`h-3 w-3 ${saveStatus === "saving" ? "animate-spin" : ""}`} />
      <span>{label}</span>
    </div>
  );
}

export function StatusBar({ sceneWordCount }: Props) {
  const saveStatus        = useUIStore((s) => s.saveStatus);
  const sessionTimerEnabled = useUIStore((s) => s.sessionTimerEnabled);
  const sessionGoal       = useUIStore((s) => s.sessionGoal);
  const sessionStartTime  = useUIStore((s) => s.sessionStartTime);
  const sessionBaseWords  = useUIStore((s) => s.sessionBaseWords);

  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!sessionStartTime) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - sessionStartTime) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sessionStartTime]);

  const { icon: Icon, label, className } = STATUS_CONFIG[saveStatus];

  const sessionWords = sessionBaseWords != null ? Math.max(0, sceneWordCount - sessionBaseWords) : 0;
  const progress     = sessionGoal ? Math.min(100, Math.round((sessionWords / sessionGoal) * 100)) : 0;
  const showSession  = sessionTimerEnabled && sessionGoal != null;

  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-t border-border bg-card text-xs text-muted-foreground gap-4">
      <span>{formatWordCount(sceneWordCount)}</span>

      {showSession && (
        <div className="flex items-center gap-2 flex-1 max-w-xs">
          <span className="tabular-nums shrink-0">{formatElapsed(elapsed)}</span>
          <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                progress >= 100 ? "bg-green-500" : "bg-primary"
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="tabular-nums shrink-0">
            <span className={progress >= 100 ? "text-green-500 font-medium" : ""}>{sessionWords}</span>
            <span className="text-muted-foreground/50">/{sessionGoal}</span>
          </span>
        </div>
      )}

    </div>
  );
}
