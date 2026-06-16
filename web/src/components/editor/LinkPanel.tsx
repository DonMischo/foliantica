"use client";

import { useState, useMemo } from "react";
import {
  X, Search, Link as LinkIcon, FileText, ImageIcon,
  ExternalLink, CheckCircle2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useResearch, useUpdateResearch, useFragments } from "@/store/queries";
import type { ResearchItem, Fragment } from "@/types";

interface Props {
  projectId: number;
  sceneId: number;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function researchLabel(item: ResearchItem): string {
  if (item.title) return item.title;
  if (item.url_title) return item.url_title;
  if (item.url) return item.url;
  if (item.text_content) {
    const t = item.text_content.slice(0, 72);
    return item.text_content.length > 72 ? t + "…" : t;
  }
  return "Untitled";
}

function researchIcon(item: ResearchItem): React.ElementType {
  if (item.url) return ExternalLink;
  if (item.media?.some((m) => m.kind === "image")) return ImageIcon;
  return FileText;
}

function fragmentPlain(f: Fragment): string {
  if (!f.content) return "";
  return f.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LinkPanel({ projectId, sceneId, onClose }: Props) {
  const [search, setSearch] = useState("");

  const { data: research = [] } = useResearch(projectId);
  const { data: fragments = [] } = useFragments(projectId);
  const updateResearch = useUpdateResearch(projectId);

  const q = search.toLowerCase();

  const filteredResearch = useMemo(
    () =>
      research.filter((item) => {
        if (!q) return true;
        return (
          researchLabel(item).toLowerCase().includes(q) ||
          (item.url ?? "").toLowerCase().includes(q) ||
          (item.text_content ?? "").toLowerCase().includes(q) ||
          item.tags.some((t) => t.toLowerCase().includes(q))
        );
      }),
    [research, q],
  );

  const filteredFragments = useMemo(
    () =>
      fragments.filter((f) => {
        if (!q) return true;
        return (
          (f.title ?? "").toLowerCase().includes(q) ||
          fragmentPlain(f).toLowerCase().includes(q)
        );
      }),
    [fragments, q],
  );

  const toggleLink = (item: ResearchItem) => {
    const alreadyLinked = item.linked_scene_id === sceneId;
    updateResearch.mutate({
      id: item.id,
      data: { linked_scene_id: alreadyLinked ? null : sceneId },
    });
  };

  return (
    <div className="w-72 flex-shrink-0 flex flex-col border-l border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-semibold">Scene Links</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter…"
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Research & Sources ── */}
        <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Research &amp; Sources
        </p>

        {filteredResearch.length === 0 ? (
          <p className="px-3 pb-3 text-xs text-muted-foreground italic">
            {research.length === 0 ? "No research items yet." : "No matches."}
          </p>
        ) : (
          filteredResearch.map((item) => {
            const linked = item.linked_scene_id === sceneId;
            const Icon = researchIcon(item);
            return (
              <button
                key={item.id}
                onClick={() => toggleLink(item)}
                title={linked ? "Unlink from this scene" : "Link to this scene"}
                className={cn(
                  "w-full text-left flex items-start gap-2.5 px-3 py-2 transition-colors hover:bg-secondary/50",
                  linked && "bg-primary/5",
                )}
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-xs leading-tight truncate",
                      linked ? "text-primary font-medium" : "text-foreground",
                    )}
                  >
                    {researchLabel(item)}
                  </p>
                  {item.tags.length > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {item.tags.join(", ")}
                    </p>
                  )}
                </div>
                {linked && (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
                )}
              </button>
            );
          })
        )}

        {/* ── Snippets & Ideas ── */}
        {filteredFragments.length > 0 && (
          <>
            <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t border-border mt-2">
              Snippets &amp; Ideas
            </p>
            {filteredFragments.map((f) => {
              const plain = fragmentPlain(f);
              const excerpt = plain.length > 100 ? plain.slice(0, 100) + "…" : plain;
              return (
                <div key={f.id} className="px-3 py-2">
                  <div className="flex items-start gap-2.5">
                    <FileText className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      {f.title && (
                        <p className="text-xs font-medium leading-tight truncate">
                          {f.title}
                        </p>
                      )}
                      {excerpt && (
                        <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5 line-clamp-2">
                          {excerpt}
                        </p>
                      )}
                      <span className="mt-1 inline-block text-[9px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground capitalize">
                        {f.tab}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Empty state when nothing at all */}
        {filteredResearch.length === 0 && filteredFragments.length === 0 && research.length > 0 && (
          <p className="px-3 pb-3 text-xs text-muted-foreground italic">No matches.</p>
        )}

      </div>
    </div>
  );
}
