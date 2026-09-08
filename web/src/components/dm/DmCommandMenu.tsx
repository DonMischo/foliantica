"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shuffle, Dices, BookMarked } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { dmApi } from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";

/** Commands offered by the "/" menu in the DM input. */
export const DM_COMMANDS = [
  { key: "wildcard", icon: Shuffle },
  { key: "roll20", icon: Dices },
  { key: "codex", icon: BookMarked },
] as const;
export type DmCommandKey = (typeof DM_COMMANDS)[number]["key"];

/** The trailing "/query" the caret sits in, or null when the menu should close. */
export function commandQuery(text: string, caret: number): string | null {
  const match = /(?:^|\s)\/(\S*)$/.exec(text.slice(0, caret));
  return match ? match[1] : null;
}

export function matchingCommands(query: string) {
  const q = query.toLowerCase();
  return DM_COMMANDS.filter((c) => c.key.startsWith(q));
}

/** Command list shown above the input while the caret is in a "/…" token. */
export function CommandList({
  query, active, onPick,
}: { query: string; active: number; onPick: (key: DmCommandKey) => void }) {
  const { t } = useLanguage();
  const commands = matchingCommands(query);
  if (commands.length === 0) return null;

  return (
    <div className="mx-3 mb-1 rounded-md border border-border bg-popover p-1 shadow-md">
      {commands.map((command, i) => {
        const Icon = command.icon;
        return (
          <button
            key={command.key}
            onMouseDown={(e) => {
              e.preventDefault(); // keep focus in the textarea
              onPick(command.key);
            }}
            className={cn(
              "w-full flex items-center gap-2 rounded px-2 py-1 text-left text-xs",
              i === active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-secondary/50"
            )}
          >
            <Icon className="h-3 w-3 shrink-0" />
            <span className="font-medium">/{command.key}</span>
            <span className="truncate text-[11px] text-muted-foreground">
              {t(`dm_cmd_${command.key}_hint`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Category picker for /wildcard: pick a category, get one random draw back. */
export function WildcardDrawPicker({
  open, onClose, onDraw,
}: { open: boolean; onClose: () => void; onDraw: (value: string) => void }) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const { data: tree } = useQuery({
    queryKey: ["dm-wildcards-tree"],
    queryFn: dmApi.wildcardsTree,
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (open) {
      setFilter("");
      setError(null);
    }
  }, [open]);

  const visible = useMemo(() => {
    const categories = tree?.categories ?? [];
    const q = filter.trim().toLowerCase();
    return q ? categories.filter((c) => c.path.toLowerCase().includes(q)) : categories;
  }, [tree, filter]);

  if (!open) return null;

  const draw = async (path: string) => {
    setPending(path);
    setError(null);
    try {
      const { value } = await dmApi.drawWildcard(path);
      onDraw(value);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\d+: /, "") : String(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="mx-3 mb-1 rounded-md border border-border bg-popover p-2 shadow-md space-y-1.5">
      <div className="flex items-center gap-2">
        <Shuffle className="h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && visible.length > 0) draw(visible[0].path);
          }}
          placeholder={t("dm_wildcards_filter")}
          className="h-7 text-xs"
          autoFocus
        />
      </div>

      {!tree || !tree.available ? (
        <p className="px-1 py-3 text-center text-xs text-muted-foreground">
          {tree?.error ? `${t("dm_wildcards_none")} (${tree.error})` : t("dm_wildcards_none")}
        </p>
      ) : (
        <div className="max-h-52 overflow-y-auto space-y-0.5">
          {visible.map((c) => (
            <button
              key={c.path}
              onClick={() => draw(c.path)}
              disabled={pending !== null}
              className="w-full flex items-center gap-2 rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-secondary/50 hover:text-foreground disabled:opacity-50"
              style={{ paddingLeft: `${8 + c.depth * 16}px` }}
            >
              <span className="flex-1 truncate">{c.path.split("/").pop()}</span>
              <span className="text-[10px] text-muted-foreground/70 tabular-nums">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="px-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
