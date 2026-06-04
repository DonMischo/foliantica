"use client";

import { useState, useMemo } from "react";
import { X, Search, Plus, User, MapPin, Package, Scroll, Tag, Coins, BarChart2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CodexEntry, EntryType } from "@/types";
import { useEntryRelations, useInventorySummary } from "@/store/queries";
import { EntryMentionsDialog } from "./EntryMentionsDialog";

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
  const { data: relations = [] } = useEntryRelations(selected?.id ?? 0);
  const isCharacter = selected?.entry_type === "character";
  const { data: inventory } = useInventorySummary(isCharacter ? (selected?.id ?? 0) : 0);

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
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: selected.color }} />
            <h3 className="font-semibold flex-1">{selected.name}</h3>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title="Mentions across scenes"
              onClick={() => setMentionsEntry(selected)}
            >
              <BarChart2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">{TYPE_LABELS[selected.entry_type as EntryType]}</p>

          {/* Groups / Species / Subtype */}
          {((selected.groups?.length) || selected.species || selected.subtype) && (
            <div className="flex gap-3 mb-3 flex-wrap">
              {(selected.groups?.length > 0) && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Groups</p>
                  <div className="flex flex-wrap gap-0.5">
                    {selected.groups.map(g => (
                      <span key={g} className="text-xs bg-secondary px-1.5 py-0.5 rounded">{g}</span>
                    ))}
                  </div>
                </div>
              )}
              {selected.species && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Species</p>
                  <p className="text-xs">{selected.species}</p>
                </div>
              )}
              {selected.subtype && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Subtype</p>
                  <p className="text-xs">{selected.subtype}</p>
                </div>
              )}
            </div>
          )}

          {/* Tags */}
          {selected.tags.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-1">Tags</p>
              <div className="flex flex-wrap gap-1">
                {selected.tags.map((t) => (
                  <span key={t} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">#{t}</span>
                ))}
              </div>
            </div>
          )}

          {/* Aliases */}
          {selected.aliases.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-1">Also known as</p>
              <div className="flex flex-wrap gap-1">
                {selected.aliases.map((a) => (
                  <span key={a} className="text-xs bg-secondary px-2 py-0.5 rounded">{a}</span>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {selected.description && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-1">Description</p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{selected.description}</p>
            </div>
          )}

          {/* Notes */}
          {selected.notes && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{selected.notes}</p>
            </div>
          )}

          {/* Relations — manual only, auto: entries live in Inventory */}
          {relations.filter(r => !r.relation_type?.startsWith("auto:")).length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-1">Relations</p>
              <div className="space-y-1">
                {relations.filter(r => !r.relation_type?.startsWith("auto:")).map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.other_color }} />
                    <span className="font-medium">{r.other_name}</span>
                    {r.relation_type && (
                      <span className="text-muted-foreground">— {r.relation_type}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inventory — characters only */}
          {isCharacter && inventory && (
            (inventory.items.length > 0 || inventory.currencies.length > 0) && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Inventory</p>
                {inventory.items.length > 0 && (
                  <div className="mb-2 space-y-0.5">
                    {inventory.items.map(({ item_id, qty }) => {
                      const entry = entries.find((e) => e.id === item_id);
                      return (
                        <div key={item_id} className="flex items-center gap-2 text-xs">
                          <Package className="h-3 w-3 shrink-0 text-blue-400" />
                          <span className="flex-1 truncate">{entry?.name ?? `Item #${item_id}`}</span>
                          <span className={cn(
                            "font-mono shrink-0",
                            qty > 0 ? "text-green-400" : "text-red-400"
                          )}>×{qty}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {inventory.currencies.length > 0 && (
                  <div className="space-y-0.5">
                    {inventory.currencies.map(({ name, balance }) => (
                      <div key={name} className="flex items-center gap-2 text-xs">
                        <Coins className="h-3 w-3 shrink-0 text-green-400" />
                        <span className="flex-1 truncate">{name}</span>
                        <span className={cn(
                          "font-mono shrink-0",
                          balance >= 0 ? "text-green-400" : "text-red-400"
                        )}>{balance}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          )}
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
