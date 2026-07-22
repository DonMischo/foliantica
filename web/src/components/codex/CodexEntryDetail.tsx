"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { User, MapPin, Package, Scroll, Tag, Coins, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CodexEntry, EntryType } from "@/types";
import { useEntryRelations, useInventorySummary } from "@/store/queries";
import { EntryMentionsDialog } from "./EntryMentionsDialog";

const TYPE_ICONS: Record<string, React.ElementType> = {
  character: User,
  location: MapPin,
  item: Package,
  lore: Scroll,
  relic: Coins,
};

const TYPE_LABELS: Record<string, string> = {
  character: "Character",
  location: "Location",
  item: "Item",
  lore: "Lore",
  custom: "Custom",
  relic: "Relic",
};

interface Props {
  entry: CodexEntry;
  allEntries: CodexEntry[];
}

export function CodexEntryDetail({ entry, allEntries }: Props) {
  const router = useRouter();
  const [mentionsOpen, setMentionsOpen] = useState(false);
  const { data: relations = [] } = useEntryRelations(entry.id);
  const isCharacter = entry.entry_type === "character";
  const { data: inventory } = useInventorySummary(isCharacter ? entry.id : 0);

  const Icon = TYPE_ICONS[entry.entry_type] ?? Tag;
  const manualRelations = relations.filter((r) => !r.relation_type?.startsWith("auto:"));

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <button
          onClick={() => router.push(`/projects/${entry.project_id}/codex?entry=${entry.id}`)}
          className="font-semibold flex-1 text-sm text-left truncate hover:underline hover:text-primary"
          title="Open in Codex"
        >
          {entry.name}
        </button>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          title="Mentions across scenes"
          onClick={() => setMentionsOpen(true)}
        >
          <BarChart2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">
        {TYPE_LABELS[entry.entry_type as EntryType] ?? entry.entry_type}
      </p>

      {/* Aliases */}
      {entry.aliases.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1">Also known as</p>
          <div className="flex flex-wrap gap-1">
            {entry.aliases.map((a) => (
              <span key={a} className="text-xs bg-secondary px-2 py-0.5 rounded">{a}</span>
            ))}
          </div>
        </div>
      )}

      {/* Groups / Species / Subtype */}
      {(entry.groups?.length > 0 || entry.species || entry.subtype) && (
        <div className="flex gap-3 mb-3 flex-wrap">
          {entry.groups?.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Groups</p>
              <div className="flex flex-wrap gap-0.5">
                {entry.groups.map((g) => (
                  <span key={g} className="text-xs bg-secondary px-1.5 py-0.5 rounded">{g}</span>
                ))}
              </div>
            </div>
          )}
          {entry.species && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Species</p>
              <p className="text-xs">{entry.species}</p>
            </div>
          )}
          {entry.subtype && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Subtype</p>
              <p className="text-xs">{entry.subtype}</p>
            </div>
          )}
        </div>
      )}

      {/* Tags */}
      {entry.tags.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1">Tags</p>
          <div className="flex flex-wrap gap-1">
            {entry.tags.map((t) => (
              <span key={t} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">#{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      {entry.description ? (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1">Description</p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{entry.description}</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/40 italic mb-3">No description yet.</p>
      )}

      {/* Notes */}
      {entry.notes && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1">Notes</p>
          <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{entry.notes}</p>
        </div>
      )}

      {/* Relations */}
      {manualRelations.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1">Relations</p>
          <div className="space-y-1">
            {manualRelations.map((r) => (
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
      {isCharacter && inventory && (inventory.items.length > 0 || inventory.currencies.length > 0) && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1">Inventory</p>
          {inventory.items.length > 0 && (
            <div className="mb-2 space-y-0.5">
              {inventory.items.map(({ item_id, qty }) => {
                const item = allEntries.find((e) => e.id === item_id);
                return (
                  <div key={item_id} className="flex items-center gap-2 text-xs">
                    <Package className="h-3 w-3 shrink-0 text-blue-400" />
                    <span className="flex-1 truncate">{item?.name ?? `Item #${item_id}`}</span>
                    <span className={cn("font-mono shrink-0", qty > 0 ? "text-green-400" : "text-red-400")}>×{qty}</span>
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
                  <span className={cn("font-mono shrink-0", balance >= 0 ? "text-green-400" : "text-red-400")}>{balance}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mentionsOpen && (
        <EntryMentionsDialog
          entry={entry}
          open={mentionsOpen}
          onClose={() => setMentionsOpen(false)}
        />
      )}
    </>
  );
}
