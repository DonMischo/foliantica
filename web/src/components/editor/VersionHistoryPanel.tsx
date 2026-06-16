"use client";

import { useState } from "react";
import { X, RotateCcw, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSceneVersions, useRestoreSceneVersion } from "@/store/queries";
import { versionsApi } from "@/lib/api";
import { sanitizeHtml } from "@/lib/sanitize";
import type { SceneVersion, SceneVersionDetail } from "@/types";

interface Props {
  sceneId: number;
  onClose: () => void;
  onRestored: (content: string) => void;
}

function toUtcDate(iso: string): Date {
  // SQLite datetime('now') returns naive UTC strings without a Z suffix.
  // Appending Z makes JS parse them as UTC instead of local time.
  return new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
}

function formatRelativeTime(iso: string): string {
  const date = toUtcDate(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatAbsoluteTime(iso: string): string {
  const date = toUtcDate(iso);
  return date.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function VersionHistoryPanel({ sceneId, onClose, onRestored }: Props) {
  const { data: versions = [], isLoading } = useSceneVersions(sceneId);
  const restore = useRestoreSceneVersion(sceneId);

  const [preview, setPreview] = useState<SceneVersionDetail | null>(null);
  const [loadingPreviewId, setLoadingPreviewId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const handlePreview = async (v: SceneVersion) => {
    if (preview?.id === v.id) { setPreview(null); return; }
    setLoadingPreviewId(v.id);
    try {
      const detail = await versionsApi.get(sceneId, v.id);
      setPreview(detail);
    } finally {
      setLoadingPreviewId(null);
    }
  };

  const handleRestore = async (versionId: number) => {
    const result = await restore.mutateAsync(versionId);
    onRestored(result.content);
    setConfirmId(null);
    setPreview(null);
  };

  return (
    <div className="w-72 border-l border-border bg-card flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">Version History</h3>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Version list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="text-xs text-muted-foreground px-4 py-3">Loading…</p>
        )}
        {!isLoading && versions.length === 0 && (
          <p className="text-xs text-muted-foreground px-4 py-6 text-center">
            No snapshots yet.<br />One will be saved automatically.
          </p>
        )}
        {versions.map(v => (
          <div
            key={v.id}
            className="border-b border-border/50 last:border-0"
          >
            <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-secondary/40 group">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">{formatRelativeTime(v.created_at)}</p>
                <p className="text-[10px] text-muted-foreground">{formatAbsoluteTime(v.created_at)}</p>
              </div>
              <button
                type="button"
                onClick={() => handlePreview(v)}
                className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                title="Preview"
              >
                {loadingPreviewId === v.id
                  ? <span className="text-[10px]">…</span>
                  : <Eye className="h-3.5 w-3.5" />
                }
              </button>
              <button
                type="button"
                onClick={() => setConfirmId(v.id)}
                className="text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                title="Restore"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Confirm restore */}
            {confirmId === v.id && (
              <div className="px-4 pb-3 space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  Restore this version? Current content will be saved as a new snapshot first.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleRestore(v.id)}
                    disabled={restore.isPending}
                  >
                    {restore.isPending ? "Restoring…" : "Restore"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setConfirmId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Preview */}
            {preview?.id === v.id && (
              <div
                className="mx-4 mb-3 rounded border border-border/60 bg-background/60 p-3 text-[11px] leading-relaxed text-foreground/80 max-h-48 overflow-y-auto prose prose-invert prose-xs max-w-none"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.content) }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
