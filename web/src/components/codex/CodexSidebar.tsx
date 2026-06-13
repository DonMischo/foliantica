"use client";

import { useState, useMemo } from "react";
import { X, Search, Plus, User, MapPin, Package, Scroll, Tag, Coins, BarChart2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CodexEntry, EntryType } from "@/types";
import { EntryMentionsDialog } from "./EntryMentionsDialog";
import { CodexEntryDetail } from "./CodexEntryDetail";

const TYPE_ICONS: Record<EntryType, React.ElementType> = {
  character: User,
  location: MapPin,
  item: Package,
  lore: Scroll,
  custom: Tag,
  relic: Coins,
};

const TYPE_LABELS: Record<EntryType, string> = {
  character: "Character",
  location: "Location",
  item: "Item",
  lore: "Lore",
  custom: "Custom",
  relic: "Relic",
};

interface Props {
  entries: CodexEntry[];
  selectedId?: number;
  onSelect: (id: number) => void;
  onClose: () => void;
  onAdd: () => void;
  sceneContent?: string;  // HTML of the current scene — used to filter relevant entries
}

export function CodexSidebar({ entries, selectedId, onSelect, onClose, onAdd, sceneContent }: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<EntryType | "all" | "scene">(
    sceneContent ? "scene" : "all"
  );
  const [mentionsEntry, setMentionsEntry] = useState<CodexEntry | null>(null);

  // Strip HTML and compute which entry IDs are mentioned in the current scene
  const relevantIds = useMemo(() => {
    if (!sceneContent) return null;
    const text = sceneContent.replace(/<[^>]+>/g, " ").toLowerCase();
    return new Set(
      entries
        .filter((e) =>
          text.includes(e.name.toLowerCase()) ||
          e.aliases.some((a) => text.includes(a.toLowerCase()))
        )
        .map((e) => e.id)
    );
  }, [sceneContent, entries]);

  const filtered = entries.filter((e) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || e.name.toLowerCase().includes(q) ||
      e.aliases.some((a) => a.toLowerCase().includes(q));
    if (!matchesSearch) return false;
    if (typeFilter === "scene") return relevantIds?.has(e.id) ?? false;
    return typeFilter === "all" || e.entry_type === typeFilter;
  });

  const selected = entries.find((e) => e.id === selectedId);

  return (
    <>
    <div className="flex flex-col w-72 border-l border-border bg-card h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-sm font-medium">Codex</span>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {selected ? (
        <div className="flex-1 overflow-y-auto p-3">
          <button
            className="text-xs text-muted-foreground hover:text-foreground mb-3 flex items-center gap-1"
            onClick={() => onSelect(-1)}
          >
            ← Back to list
          </button>
          <CodexEntryDetail entry={selected} allEntries={entries} />
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                className="pl-7 h-7 text-xs"
                placeholder="Search codex..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-1 px-3 py-2 border-b border-border flex-wrap">
            {sceneContent && (
              <button
                onClick={() => setTypeFilter("scene")}
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full transition-colors",
                  typeFilter === "scene"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                )}
              >
                Scene
              </button>
            )}
            {(["all", "character", "location", "item", "lore", "custom"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full transition-colors",
                  typeFilter === t
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                )}
              >
                {t === "all" ? "All" : TYPE_LABELS[t as EntryType]}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {filtered.map((entry) => {
              const Icon = TYPE_ICONS[entry.entry_type as EntryType] || Tag;
              return (
                <div key={entry.id} className="group flex items-center hover:bg-secondary/50">
                  <button
                    onClick={() => onSelect(entry.id)}
                    className="flex-1 flex items-center gap-2.5 px-3 py-2 text-left min-w-0"
                  >
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{entry.name}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setMentionsEntry(entry); }}
                    className="pr-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                    title="Mentions across scenes"
                  >
                    <BarChart2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No entries found</p>
            )}
          </div>
        </>
      )}
    </div>

    {mentionsEntry && (
      <EntryMentionsDialog
        entry={mentionsEntry}
        open={!!mentionsEntry}
        onClose={() => setMentionsEntry(null)}
      />
    )}
    </>
  );
}
