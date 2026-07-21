"use client";

import { useState, useEffect, useRef } from "react";
import { X, Plus, Trash2, Link2, ImageIcon, Package, Coins, History, ChevronUp, ChevronDown, Pencil, Globe, LayoutList, Share2, Users, Eye, EyeOff, Gem } from "lucide-react";
import { imagesApi, translateApi, structureApi, type StructureResult } from "@/lib/api";
import { useUploadCodexImage, useDeleteCodexImage, useUpdateCodexEntry, useInventorySummary, useCharacterItemLog, useCharacterCurrencyLog, useEntryRelations, useCreateRelation, useDeleteRelation, useSettings, useEntryAccess, useSetEntryAccess } from "@/store/queries";
import * as Popover from "@radix-ui/react-popover";
import { cropImageStyle, type ImageCrop } from "@/lib/imageCrop";
import { ImageCropDialog } from "./ImageCropDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CodexEntry, CodexRelationResolved } from "@/types";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { NameGeneratorWidget } from "./NameGeneratorWidget";
import type { NameType } from "@/lib/nameGenerator";

const BUILT_IN_TYPES = ["character", "location", "item", "relic", "lore"] as const;
const ENTRY_TYPES: string[] = [...BUILT_IN_TYPES, "custom"];

// Stable empty-array fallback — must live outside the component so its reference
// never changes between renders. Using [] as a default parameter creates a new
// array on every render, which makes the useEffect([…allEntries]) dependency fire
// every render and produces an infinite setState → re-render loop.
const EMPTY_ENTRIES: CodexEntry[] = [];

const TRANSLATE_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "ru", label: "Russian" },
  { code: "pl", label: "Polish" },
  { code: "sv", label: "Swedish" },
  { code: "da", label: "Danish" },
  { code: "no", label: "Norwegian" },
  { code: "fi", label: "Finnish" },
  { code: "cs", label: "Czech" },
  { code: "hu", label: "Hungarian" },
  { code: "ro", label: "Romanian" },
  { code: "tr", label: "Turkish" },
  { code: "uk", label: "Ukrainian" },
  { code: "ar", label: "Arabic" },
  { code: "ja", label: "Japanese" },
  { code: "zh", label: "Chinese" },
  { code: "ko", label: "Korean" },
];

const PRESET_COLORS = [
  "#eab308", "#ef4444", "#3b82f6", "#22c55e",
  "#a855f7", "#f97316", "#ec4899", "#14b8a6",
];

const RELATION_GROUPS: { label: string; items: string[] }[] = [
  { label: "General",      items: ["friend", "enemy", "ally", "rival"] },
  { label: "Mentorship",   items: ["mentor", "student"] },
  { label: "Place",        items: ["home", "origin"] },
  { label: "Organization", items: ["member of", "leads"] },
  { label: "Family",       items: ["parent", "child", "mother", "father", "grandmother", "grandfather", "aunt", "uncle", "sister", "brother", "cousin"] },
  { label: "Romantic",     items: ["spouse", "partner", "lover"] },
  { label: "Ownership",    items: ["owner", "owned by"] },
  { label: "Other",        items: ["custom…"] },
];
const PRESET_RELATIONS = RELATION_GROUPS.flatMap(g => g.items);

const ENTRY_TYPE_ORDER = ["character", "location", "item", "relic", "lore", "custom"] as const;
const ENTRY_TYPE_LABELS: Record<string, string> = {
  character: "Characters", location: "Locations", item: "Items", relic: "Relics", lore: "Lore", custom: "Custom",
};

// ── Inventory sub-components ──────────────────────────────────────────────────

function InventoryCurrencyRow({
  characterId, name, balance,
  nativeAmount, onNativeChange, onRemoveNative,
}: {
  characterId: number; name: string; balance: number;
  nativeAmount?: number;
  onNativeChange?: (amount: number) => void;
  onRemoveNative?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");
  const { data: log = [], isFetching } = useCharacterCurrencyLog(open ? characterId : 0, name);
  const isNative = nativeAmount !== undefined;

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs">
        <Coins className="h-3 w-3 shrink-0 text-yellow-500" />
        <span className="flex-1 truncate">{name}</span>
        {isNative && (
          <span className="text-muted-foreground/50 shrink-0 font-mono">base:{nativeAmount}</span>
        )}
        <span className={cn("font-mono shrink-0", balance >= 0 ? "text-green-500" : "text-red-500")}>
          {balance}
        </span>
        {isNative && !editing && (
          <button type="button" onClick={() => { setEditVal(String(nativeAmount)); setEditing(true); }}
            className="text-muted-foreground hover:text-foreground" title="Edit base amount">
            <Pencil className="h-3 w-3" />
          </button>
        )}
        {isNative && (
          <button type="button" onClick={onRemoveNative}
            className="text-muted-foreground hover:text-destructive" title="Remove currency">
            <Trash2 className="h-3 w-3" />
          </button>
        )}
        <button type="button" onClick={() => setOpen(o => !o)}
          className="text-muted-foreground hover:text-foreground" title="Show history">
          {open ? <ChevronUp className="h-3 w-3" /> : <History className="h-3 w-3" />}
        </button>
      </div>
      {editing && (
        <div className="flex items-center gap-1.5 ml-5 mt-1">
          <input type="number" value={editVal} onChange={e => setEditVal(e.target.value)}
            className="w-16 h-6 text-xs rounded border border-border bg-background px-1.5" />
          <button type="button" className="text-xs text-primary hover:underline"
            onClick={() => { onNativeChange?.(parseInt(editVal, 10) || 0); setEditing(false); }}>
            Save
          </button>
          <button type="button" className="text-xs text-muted-foreground hover:underline"
            onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      )}
      {open && (
        <div className="ml-5 mt-1 mb-1 border-l border-border/50 pl-2 space-y-0.5">
          {isFetching && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!isFetching && log.length === 0 && <p className="text-xs text-muted-foreground">No command history</p>}
          {log.map((entry, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex-1 truncate">{entry.scene_title}</span>
              <span className={cn("font-mono shrink-0", entry.delta >= 0 ? "text-green-500" : "text-red-400")}>
                {entry.delta >= 0 ? "+" : ""}{entry.delta}
              </span>
              <span className="font-mono shrink-0 text-foreground/60">→ {entry.balance}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InventoryItemRow({
  characterId, itemId, itemName, qty,
  nativeQty, onNativeChange, onRemoveNative, onOpenEntry,
}: {
  characterId: number; itemId: number; itemName: string; qty: number;
  nativeQty?: number;
  onNativeChange?: (qty: number) => void;
  onRemoveNative?: () => void;
  onOpenEntry?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");
  const { data: log = [], isFetching } = useCharacterItemLog(open ? characterId : 0, itemId);
  const isNative = nativeQty !== undefined;

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs">
        <Package className="h-3 w-3 shrink-0 text-blue-400" />
        {onOpenEntry ? (
          <button
            type="button"
            onClick={onOpenEntry}
            className="flex-1 truncate text-left hover:underline hover:text-foreground text-muted-foreground/90 transition-colors"
          >
            {itemName}
          </button>
        ) : (
          <span className="flex-1 truncate">{itemName}</span>
        )}
        {isNative && (
          <span className="text-muted-foreground/50 shrink-0 font-mono">base:{nativeQty}</span>
        )}
        <span className={cn("font-mono shrink-0", qty > 0 ? "text-green-500" : qty === 0 ? "text-muted-foreground" : "text-red-500")}>
          ×{qty}
        </span>
        {isNative && !editing && (
          <button type="button" onClick={() => { setEditVal(String(nativeQty)); setEditing(true); }}
            className="text-muted-foreground hover:text-foreground" title="Edit base quantity">
            <Pencil className="h-3 w-3" />
          </button>
        )}
        {isNative && (
          <button type="button" onClick={onRemoveNative}
            className="text-muted-foreground hover:text-destructive" title="Remove from inventory">
            <Trash2 className="h-3 w-3" />
          </button>
        )}
        <button type="button" onClick={() => setOpen(o => !o)}
          className="text-muted-foreground hover:text-foreground" title="Show history">
          {open ? <ChevronUp className="h-3 w-3" /> : <History className="h-3 w-3" />}
        </button>
      </div>
      {editing && (
        <div className="flex items-center gap-1.5 ml-5 mt-1">
          <input type="number" value={editVal} onChange={e => setEditVal(e.target.value)}
            className="w-16 h-6 text-xs rounded border border-border bg-background px-1.5" />
          <button type="button" className="text-xs text-primary hover:underline"
            onClick={() => { onNativeChange?.(parseInt(editVal, 10) || 0); setEditing(false); }}>
            Save
          </button>
          <button type="button" className="text-xs text-muted-foreground hover:underline"
            onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      )}
      {open && (
        <div className="ml-5 mt-1 mb-1 border-l border-border/50 pl-2 space-y-0.5">
          {isFetching && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!isFetching && log.length === 0 && <p className="text-xs text-muted-foreground">No command history</p>}
          {log.map((entry, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex-1 truncate">{entry.scene_title}</span>
              <span className={cn("font-mono shrink-0", entry.delta >= 0 ? "text-green-500" : "text-red-400")}>
                {entry.delta >= 0 ? "+" : ""}{entry.delta}
              </span>
              <span className="font-mono shrink-0 text-foreground/60">→ ×{entry.total}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

interface SharingProject { id: number; title: string }

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<CodexEntry>) => void;
  initial?: Partial<CodexEntry>;
  title: string;
  /** All codex entries for the project (for the relation target dropdown and group suggestions) */
  allEntries?: CodexEntry[];
  /** Called when the user clicks an inventory item name to jump to its entry */
  onOpenEntry?: (id: number) => void;
  /** Called when the user clicks a relation's target name to open that entry */
  onOpenRelation?: (id: number) => void;
  /** All projects that share the same codex — shown in the per-entry sharing checklist */
  sharingProjects?: SharingProject[];
}

export function CodexEntryDialog({
  open, onClose, onSave, initial, title, allEntries = EMPTY_ENTRIES, onOpenEntry, onOpenRelation,
  sharingProjects = [],
}: Props) {
  const [name, setName]               = useState(initial?.name ?? "");
  const [aliasInput, setAliasInput]   = useState("");
  const [aliases, setAliases]         = useState<string[]>(initial?.aliases ?? []);
  const [entryType, setEntryType]     = useState<string>(initial?.entry_type ?? "custom");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [notes, setNotes]             = useState(initial?.notes ?? "");
  const [color, setColor]             = useState(initial?.color ?? "#eab308");
  const [species, setSpecies]         = useState(initial?.species ?? "");
  const [gender, setGender]           = useState(initial?.gender ?? "");
  const [subtype, setSubtype]         = useState(initial?.subtype ?? "");
  const [tagInput, setTagInput]       = useState("");
  const [tags, setTags]               = useState<string[]>(initial?.tags ?? []);

  // Groups
  const [groups, setGroups]           = useState<string[]>(initial?.groups ?? []);
  const [groupInput, setGroupInput]   = useState("");
  const [groupDropOpen, setGroupDropOpen] = useState(false);
  const groupDropRef = useRef<HTMLDivElement>(null);

  // Main character
  const [isMainChar, setIsMainChar]   = useState(initial?.is_main_char ?? false);

  // Name generator
  const [nameType, setNameType]       = useState<NameType | "">((initial?.name_type ?? "") as NameType | "");

  // Native inventory (manually set base quantities)
  const [nativePossessions, setNativePossessions] = useState<{ entry_id: number; quantity: number }[]>(
    initial?.inventory?.possessions?.map(p => ({ entry_id: p.entry_id, quantity: p.quantity })) ?? []
  );
  const [nativeCurrencies, setNativeCurrencies] = useState<{ name: string; amount: number }[]>(
    initial?.inventory?.currencies?.map(c => ({ name: c.name, amount: c.amount })) ?? []
  );
  const [nativeRelics, setNativeRelics] = useState<{ entry_id: number; notes?: string }[]>(
    initial?.inventory?.relics?.map(r => ({ entry_id: r.entry_id, notes: r.notes })) ?? []
  );
  // Add-item UI state
  const [addItemId, setAddItemId]       = useState("");
  const [addItemQty, setAddItemQty]     = useState("1");
  // Add-currency UI state
  const [addCurrencyName, setAddCurrencyName]     = useState("");
  const [addCurrencyAmount, setAddCurrencyAmount] = useState("0");
  // Add-relic UI state
  const [addRelicId, setAddRelicId]     = useState("");
  const [addRelicNotes, setAddRelicNotes] = useState("");

  // Relation-add state
  const [relTarget, setRelTarget]     = useState("");
  const [relPreset, setRelPreset]     = useState(PRESET_RELATIONS[0]);
  const [relCustom, setRelCustom]     = useState("");

  // Sharing state
  type ShareMode = "all" | "specific" | "none";
  const [shareMode, setShareMode]           = useState<ShareMode>((initial?.share_mode ?? "all") as ShareMode);
  const [shareFuture, setShareFuture]       = useState<boolean>(initial?.share_future ?? true);
  const [accessProjectIds, setAccessProjectIds] = useState<number[]>([]);
  const [sharingSectionOpen, setSharingSectionOpen] = useState(false);

  // Translate state
  const [translateOpen, setTranslateOpen]   = useState(false);
  const [translateLang, setTranslateLang]   = useState("German");
  const [translating, setTranslating]       = useState(false);

  // Structure state
  const [structureOpen, setStructureOpen]   = useState(false);
  const [structureLang, setStructureLang]   = useState("German");
  const [structuring, setStructuring]       = useState(false);
  // Pending suggestions from structure response
  const [pendingSugg, setPendingSugg]       = useState<Omit<StructureResult, "text"> | null>(null);
  const [suggTags, setSuggTags]             = useState<string[]>([]);
  const [suggGroups, setSuggGroups]         = useState<string[]>([]);
  const [suggSubtype, setSuggSubtype]       = useState(false);

  const { data: appSettings } = useSettings();
  const aiDisabled = appSettings?.ai_disabled ?? false;
  const { t } = useLanguage();
  const isExisting = !!initial?.id;
  const entryId    = initial?.id ?? 0;
  const projectId  = initial?.project_id ?? 0;

  // Sharing hooks
  const { data: accessData } = useEntryAccess(isExisting ? entryId : 0);
  const setEntryAccessMutation = useSetEntryAccess(entryId, projectId);

  // Sync access list from server when dialog opens
  useEffect(() => {
    if (open && isExisting && accessData) {
      setAccessProjectIds(accessData.project_ids);
    }
  }, [open, isExisting, accessData]);

  // Live inventory from scene commands (read-only display, always fresh)
  const { data: inventorySummary } = useInventorySummary(isExisting && entryType === "character" ? entryId : 0);

  const { data: relations = [] } = useEntryRelations(isExisting ? entryId : 0);
  const createRel    = useCreateRelation(entryId);
  const deleteRel    = useDeleteRelation(entryId);
  const uploadImg    = useUploadCodexImage(entryId, projectId);
  const deleteImg    = useDeleteCodexImage(entryId, projectId);
  const updateEntryImage = useUpdateCodexEntry(projectId);

  const [imagePath, setImagePath] = useState<string | null>(initial?.image_path ?? null);
  const [imageCrop, setImageCrop] = useState<ImageCrop | null>(initial?.image_crop ?? null);
  const [imageMenuOpen, setImageMenuOpen] = useState(false);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [viewImageOpen, setViewImageOpen] = useState(false);

  // Click-outside to close group dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (groupDropRef.current && !groupDropRef.current.contains(e.target as Node)) {
        setGroupDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setAliases(initial?.aliases ?? []);
      setEntryType(initial?.entry_type ?? "custom");
      setDescription(initial?.description ?? "");
      setNotes(initial?.notes ?? "");
      setColor(initial?.color ?? "#eab308");
      setGroups(initial?.groups ?? []);
      setSpecies(initial?.species ?? "");
      setGender(initial?.gender ?? "");
      setSubtype(initial?.subtype ?? "");
      setTags(initial?.tags ?? []);
      setIsMainChar(initial?.is_main_char ?? false);
      setNameType((initial?.name_type ?? "") as NameType | "");
      setNativePossessions(
        initial?.inventory?.possessions?.map(p => ({ entry_id: p.entry_id, quantity: p.quantity })) ?? []
      );
      setNativeCurrencies(
        initial?.inventory?.currencies?.map(c => ({ name: c.name, amount: c.amount })) ?? []
      );
      setNativeRelics(
        initial?.inventory?.relics?.map(r => ({ entry_id: r.entry_id, notes: r.notes })) ?? []
      );
      setAddItemId("");
      setAddItemQty("1");
      setAddCurrencyName("");
      setAddCurrencyAmount("0");
      setAddRelicId("");
      setAddRelicNotes("");
      setAliasInput("");
      setTagInput("");
      setGroupInput("");
      setGroupDropOpen(false);
      setShareMode((initial?.share_mode ?? "all") as ShareMode);
      setShareFuture(initial?.share_future ?? true);
      setSharingSectionOpen(false);
      setTranslateOpen(false);
      setTranslating(false);
      setStructureOpen(false);
      setStructuring(false);
      setPendingSugg(null);
      setSuggTags([]);
      setSuggGroups([]);
      setSuggSubtype(false);
      // Default relation target to first main character (other than this entry)
      const thisId = initial?.id ?? 0;
      const mainChar = allEntries.find(e => e.is_main_char && e.id !== thisId);
      setRelTarget(mainChar ? String(mainChar.id) : "");
      setRelPreset(PRESET_RELATIONS[0]);
      setRelCustom("");
      setImagePath(initial?.image_path ?? null);
      setImageCrop(initial?.image_crop ?? null);
      setImageMenuOpen(false);
      setCropDialogOpen(false);
      setViewImageOpen(false);
    }
  }, [open, initial, allEntries]);

  // Alias helpers
  const addAlias = () => {
    const a = aliasInput.trim();
    if (a && !aliases.includes(a)) { setAliases([...aliases, a]); setAliasInput(""); }
  };
  const removeAlias = (a: string) => setAliases(aliases.filter((x) => x !== a));

  // Tag helpers
  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) { setTags([...tags, t]); setTagInput(""); }
  };
  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  // Group helpers
  const addGroup = () => {
    const g = groupInput.trim();
    if (g && !groups.includes(g)) { setGroups([...groups, g]); setGroupInput(""); }
  };
  const toggleGroup = (g: string) => setGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  const removeGroup = (g: string) => setGroups(groups.filter(x => x !== g));
  // Existing groups from allEntries as suggestions (not already selected)
  const groupSuggestions = [...new Set(allEntries.flatMap(e => e.groups ?? []))].filter(g => !groups.includes(g)).sort();

  // Relation helpers
  const effectiveRelType = relPreset === "custom…" ? relCustom.trim() : relPreset;
  const addRelation = () => {
    if (!relTarget || !effectiveRelType) return;
    const targetEntry = allEntries.find((e) => String(e.id) === relTarget);
    if (!targetEntry) return;
    createRel.mutate({
      source_id: entryId,
      target_id: targetEntry.id,
      relation_type: effectiveRelType,
    });
    setRelTarget("");
    setRelPreset(PRESET_RELATIONS[0]);
    setRelCustom("");
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      aliases,
      entry_type: entryType,
      description,
      notes: notes || null,
      color,
      groups,
      species: entryType === "character" ? (species.trim() || null) : null,
      gender: entryType === "character" ? ((gender || null) as "male" | "female" | "div" | null) : null,
      subtype: entryType !== "character" ? (subtype.trim() || null) : null,
      tags,
      is_main_char: isMainChar,
      // Native inventory: base quantities manually set here.
      // Command deltas are computed on-the-fly and not stored here.
      inventory: entryType === "character"
        ? { possessions: nativePossessions, currencies: nativeCurrencies, relics: nativeRelics }
        : null,
      name_type: nameType || null,
      share_mode: shareMode,
      share_future: shareFuture,
    });
    // Save access list separately (only meaningful for existing entries)
    if (isExisting) {
      setEntryAccessMutation.mutate({ project_ids: shareMode === "specific" ? accessProjectIds : [] });
    }
    onClose();
  };

  const handleTranslate = async () => {
    if (!description.trim()) return;
    setTranslating(true);
    try {
      const model = appSettings?.default_codex_model ?? appSettings?.default_model ?? undefined;
      const result = await translateApi.translate({
        text: description,
        target_language: translateLang,
        model,
      });
      setDescription(result.text);
      setTranslateOpen(false);
    } catch (e: any) {
      // Surface error as a brief alert; don't wipe description
      alert(`Translation failed: ${e.message ?? "Unknown error"}`);
    } finally {
      setTranslating(false);
    }
  };

  const handleStructure = async () => {
    if (!description.trim()) return;
    setStructureOpen(false);
    setStructuring(true);
    try {
      const model = appSettings?.default_codex_model ?? appSettings?.default_model ?? undefined;
      const result = await structureApi.structure({
        text: description,
        entry_type: entryType,
        target_language: structureLang,
        model,
      });
      setDescription(result.text);
      // Collect only suggestions that aren't already applied
      const newTags   = result.suggested_tags.filter(t => !tags.includes(t));
      const newGroups = result.suggested_groups.filter(g => !groups.includes(g));
      const newSubtype = (entryType !== "character" && result.suggested_subtype &&
                          result.suggested_subtype !== subtype)
                        ? result.suggested_subtype : null;
      if (newTags.length || newGroups.length || newSubtype) {
        setPendingSugg({ suggested_tags: newTags, suggested_groups: newGroups, suggested_subtype: newSubtype });
        setSuggTags(newTags);       // all pre-checked
        setSuggGroups(newGroups);
        setSuggSubtype(!!newSubtype);
      }
    } catch (e: any) {
      alert(`Structure failed: ${e.message ?? "Unknown error"}`);
    } finally {
      setStructuring(false);
    }
  };

  const handleApplySuggestions = () => {
    if (suggTags.length)   setTags(prev => [...prev, ...suggTags.filter(t => !prev.includes(t))]);
    if (suggGroups.length) setGroups(prev => [...prev, ...suggGroups.filter(g => !prev.includes(g))]);
    if (suggSubtype && pendingSugg?.suggested_subtype) setSubtype(pendingSugg.suggested_subtype);
    setPendingSugg(null);
  };

  // Other entries that are not this one, for relation target dropdown — grouped by type
  const otherEntries = allEntries.filter((e) => e.id !== entryId);
  const otherEntriesByType = ENTRY_TYPE_ORDER
    .map(type => ({ type, label: ENTRY_TYPE_LABELS[type], entries: otherEntries.filter(e => e.entry_type === type) }))
    .filter(g => g.entries.length > 0);

  // Name generator: fall back to species entry's name_type if user hasn't picked one
  const speciesEntry = entryType === "character" && species.trim()
    ? allEntries.find(e => e.name.toLowerCase() === species.trim().toLowerCase())
    : null;
  const effectiveNameType: NameType | "" = nameType || ((speciesEntry?.name_type ?? "") as NameType | "");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="pt-2 flex flex-col gap-4">
          {/* Two-column body: options left, description right */}
          <div className="flex gap-5 items-stretch">

            {/* ── Left column: all fields except description ── */}
            <div className="flex-1 min-w-0 space-y-4">

              {/* Name + Type */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t("entry_name")} *</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Entry name…"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("entry_type")}</Label>
                  {(() => {
                    const existingCustomTypes = [...new Set(
                      allEntries.map(e => e.entry_type).filter(t => !ENTRY_TYPES.includes(t))
                    )].sort();
                    const allTypes = [...ENTRY_TYPES, ...existingCustomTypes];
                    const selectValue = allTypes.includes(entryType) ? entryType : "__custom_new__";
                    return (
                      <>
                        <Select value={selectValue} onValueChange={(v) => {
                          if (v === "__custom_new__") setEntryType("");
                          else setEntryType(v);
                        }}>
                          <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
                          <SelectContent>
                            {ENTRY_TYPES.map((et) => (
                              <SelectItem key={et} value={et}>{t(`type_${et}`) || et}</SelectItem>
                            ))}
                            {existingCustomTypes.length > 0 && (
                              <>
                                <div className="my-1 h-px bg-border/50" />
                                {existingCustomTypes.map(ct => (
                                  <SelectItem key={ct} value={ct}>{ct}</SelectItem>
                                ))}
                              </>
                            )}
                            <div className="my-1 h-px bg-border/50" />
                            <SelectItem value="__custom_new__">New type…</SelectItem>
                          </SelectContent>
                        </Select>
                        {(!ENTRY_TYPES.includes(entryType) || entryType === "") && (
                          <Input
                            className="mt-1.5 h-8 text-sm"
                            placeholder="Type name (e.g. Faction, Creature…)"
                            value={entryType}
                            onChange={e => setEntryType(e.target.value)}
                            autoFocus={selectValue === "__custom_new__"}
                          />
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Main character checkbox (character type only) */}
              {entryType === "character" && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isMainChar}
                    onChange={e => setIsMainChar(e.target.checked)}
                    className="accent-primary w-4 h-4"
                  />
                  <span className="text-sm font-medium">{t("entry_main_char")}</span>
                  <span className="text-xs text-muted-foreground">{t("entry_main_char_desc")}</span>
                </label>
              )}

              {/* Groups */}
              <div className="space-y-1.5" ref={groupDropRef}>
                <Label>{t("entry_groups")}</Label>
                {groups.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {groups.map(g => (
                      <span key={g} className="flex items-center gap-1 text-xs bg-secondary px-2 py-0.5 rounded">
                        {g}
                        <button type="button" onClick={() => removeGroup(g)} className="hover:text-destructive">
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 relative">
                  <Input
                    value={groupInput}
                    onChange={(e) => setGroupInput(e.target.value)}
                    onFocus={() => setGroupDropOpen(true)}
                    placeholder={t("entry_add_group")}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGroup(); } }}
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addGroup}>{t("common_add")}</Button>
                  {groupDropOpen && groupSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 z-50 mt-1 min-w-48 bg-popover border border-foreground/25 rounded-lg shadow-[0_0_0_1px_hsl(var(--foreground)/0.1),0_8px_28px_hsl(var(--foreground)/0.22)] py-1 max-h-40 overflow-y-auto">
                      {groupSuggestions.map(g => (
                        <button
                          key={g}
                          type="button"
                          className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-secondary"
                          onMouseDown={(e) => { e.preventDefault(); toggleGroup(g); setGroupDropOpen(false); }}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Species (character) / Subtype (others) */}
              <div className="space-y-1.5">
                {entryType === "character" ? (
                  <>
                    <Label>{t("codex_species")}</Label>
                    <Input
                      value={species}
                      onChange={(e) => setSpecies(e.target.value)}
                      placeholder="e.g. Human, Elf…"
                    />
                    <Label className="pt-1 block">{t("dm_gender")}</Label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value as "male" | "female" | "div" | "")}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">—</option>
                      <option value="male">{t("dm_male")}</option>
                      <option value="female">{t("dm_female")}</option>
                      <option value="div">{t("dm_diverse")}</option>
                    </select>
                  </>
                ) : (
                  <>
                    <Label>{t("codex_subtype")}</Label>
                    <Input
                      value={subtype}
                      onChange={(e) => setSubtype(e.target.value)}
                      placeholder="e.g. City, Weapon, Magic…"
                    />
                  </>
                )}
              </div>

              {/* Name generator */}
              <div className="space-y-1.5">
                <Label>Name Generator</Label>
                <NameGeneratorWidget
                  nameType={effectiveNameType}
                  onNameTypeChange={(t) => setNameType(t)}
                  onApply={(n) => setName(n)}
                />
              </div>

              {/* Aliases */}
              <div className="space-y-1.5">
                <Label>{t("entry_aliases")}</Label>
                <div className="flex gap-2">
                  <Input
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value)}
                    placeholder={t("entry_add_alias")}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addAlias}>{t("common_add")}</Button>
                </div>
                {aliases.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {aliases.map((a) => (
                      <span key={a} className="flex items-center gap-1 text-xs bg-secondary px-2 py-0.5 rounded">
                        {a}
                        <button onClick={() => removeAlias(a)} className="hover:text-destructive">
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Tags */}
              <div className="space-y-1.5">
                <Label>{t("codex_tags")}</Label>
                <div className="flex gap-2">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder={t("entry_add_tag")}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addTag}>{t("common_add")}</Button>
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {tags.map((t) => (
                      <span key={t} className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        #{t}
                        <button onClick={() => removeTag(t)} className="hover:text-destructive">
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Image */}
              <div className="space-y-1.5">
                <Label>{t("img_portrait")}</Label>
                {isExisting ? (
                  <div className="flex items-start gap-3">
                    {(() => {
                      const pickAndUpload = () => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = "image/jpeg,image/png,image/webp,image/gif";
                        input.onchange = () => {
                          if (input.files?.[0]) {
                            uploadImg.mutateAsync(input.files[0]).then((data) => {
                              setImagePath(data.image_path);
                              setImageCrop(null);
                              setCropDialogOpen(true);
                            });
                          }
                        };
                        input.click();
                      };
                      return (
                        <Popover.Root open={imageMenuOpen} onOpenChange={setImageMenuOpen}>
                          <Popover.Trigger asChild>
                            <div
                              className="relative w-20 h-24 rounded border border-border bg-muted/40 flex items-center justify-center overflow-hidden cursor-pointer shrink-0"
                              onClick={() => { if (!imagePath) pickAndUpload(); }}
                              title={imagePath ? t("img_change") : t("img_upload")}
                            >
                              {imagePath ? (
                                <img
                                  src={imagesApi.url(imagePath)}
                                  alt=""
                                  className={imageCrop ? undefined : "w-full h-full object-cover"}
                                  style={imageCrop ? cropImageStyle(imageCrop, 80, 96) : undefined}
                                />
                              ) : (
                                <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                              )}
                            </div>
                          </Popover.Trigger>
                          {imagePath && (
                            <Popover.Portal>
                              <Popover.Content
                                side="right"
                                align="start"
                                sideOffset={8}
                                className="z-50 min-w-[10rem] rounded-lg border border-border bg-popover shadow-xl py-1"
                              >
                                <button
                                  type="button"
                                  className="w-full text-left text-xs px-3 py-1.5 hover:bg-secondary/60"
                                  onClick={() => { setViewImageOpen(true); setImageMenuOpen(false); }}
                                >
                                  {t("img_view")}
                                </button>
                                <button
                                  type="button"
                                  className="w-full text-left text-xs px-3 py-1.5 hover:bg-secondary/60"
                                  onClick={() => { setCropDialogOpen(true); setImageMenuOpen(false); }}
                                >
                                  {t("img_adjust_crop")}
                                </button>
                                <button
                                  type="button"
                                  className="w-full text-left text-xs px-3 py-1.5 hover:bg-secondary/60"
                                  onClick={() => { setImageMenuOpen(false); pickAndUpload(); }}
                                >
                                  {t("img_replace")}
                                </button>
                                <button
                                  type="button"
                                  className="w-full text-left text-xs px-3 py-1.5 hover:bg-destructive/10 text-destructive"
                                  onClick={() => {
                                    setImageMenuOpen(false);
                                    deleteImg.mutateAsync().then(() => { setImagePath(null); setImageCrop(null); });
                                  }}
                                >
                                  {t("img_remove")}
                                </button>
                              </Popover.Content>
                            </Popover.Portal>
                          )}
                        </Popover.Root>
                      );
                    })()}
                    <div className="flex flex-col gap-1.5 pt-1">
                      <p className="text-xs text-muted-foreground">{t("img_formats")}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("img_new_entry_hint")}</p>
                )}

                {imagePath && cropDialogOpen && (
                  <ImageCropDialog
                    open={cropDialogOpen}
                    onClose={() => setCropDialogOpen(false)}
                    imageSrc={imagesApi.url(imagePath)}
                    initialCrop={imageCrop}
                    onSave={(crop) => {
                      setImageCrop(crop);
                      setCropDialogOpen(false);
                      updateEntryImage.mutate({ id: entryId, data: { image_crop: crop } });
                    }}
                  />
                )}

                {imagePath && viewImageOpen && (
                  <Dialog open={viewImageOpen} onOpenChange={setViewImageOpen}>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>{t("img_view")}</DialogTitle>
                      </DialogHeader>
                      <img src={imagesApi.url(imagePath)} alt="" className="w-full h-auto rounded" />
                    </DialogContent>
                  </Dialog>
                )}
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label>{t("entry_notes")}</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Notes visible only to you…"
                />
              </div>

              {/* Color */}
              <div className="space-y-1.5">
                <Label>{t("entry_color")}</Label>
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        color === c ? "border-foreground scale-110" : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer bg-transparent border-0"
                  />
                </div>
              </div>

              {/* Inventory — character only */}
              {entryType === "character" && isExisting && (() => {
                // Merge inventorySummary with unsaved native entries not yet reflected in summary
                const summaryItemIds  = new Set((inventorySummary?.items     ?? []).map(i => i.item_id));
                const summaryCurrencyNames = new Set((inventorySummary?.currencies ?? []).map(c => c.name));

                const allCurrencyRows = [
                  ...(inventorySummary?.currencies ?? []),
                  ...nativeCurrencies.filter(c => !summaryCurrencyNames.has(c.name))
                    .map(c => ({ name: c.name, balance: c.amount })),
                ];
                const allItemRows = [
                  ...(inventorySummary?.items ?? []),
                  ...nativePossessions.filter(p => !summaryItemIds.has(p.entry_id))
                    .map(p => ({ item_id: p.entry_id, qty: p.quantity })),
                ];

                // Addable items: codex entries of type "item" not already natively tracked
                const nativeItemIds = new Set(nativePossessions.map(p => p.entry_id));
                const addableItems  = allEntries.filter(e => e.entry_type === "item" && !nativeItemIds.has(e.id));

                return (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <Label className="text-sm font-medium">{t("entry_inventory")}</Label>

                    {/* Currency rows */}
                    {allCurrencyRows.length > 0 && (
                      <div className="space-y-1">
                        {allCurrencyRows.map(({ name, balance }) => {
                          const nat = nativeCurrencies.find(c => c.name === name);
                          return (
                            <InventoryCurrencyRow
                              key={name}
                              characterId={entryId}
                              name={name}
                              balance={balance}
                              nativeAmount={nat?.amount}
                              onNativeChange={amount =>
                                setNativeCurrencies(prev => prev.map(c => c.name === name ? { ...c, amount } : c))
                              }
                              onRemoveNative={() =>
                                setNativeCurrencies(prev => prev.filter(c => c.name !== name))
                              }
                            />
                          );
                        })}
                      </div>
                    )}

                    {/* Item rows */}
                    {allItemRows.length > 0 && (
                      <div className="space-y-1">
                        {allItemRows.map(({ item_id, qty }) => {
                          const nat       = nativePossessions.find(p => p.entry_id === item_id);
                          const itemEntry = allEntries.find(e => e.id === item_id);
                          return (
                            <InventoryItemRow
                              key={item_id}
                              characterId={entryId}
                              itemId={item_id}
                              itemName={itemEntry?.name ?? `Item #${item_id}`}
                              qty={qty}
                              nativeQty={nat?.quantity}
                              onNativeChange={quantity =>
                                setNativePossessions(prev => prev.map(p => p.entry_id === item_id ? { ...p, quantity } : p))
                              }
                              onRemoveNative={() =>
                                setNativePossessions(prev => prev.filter(p => p.entry_id !== item_id))
                              }
                              onOpenEntry={itemEntry && onOpenEntry ? () => onOpenEntry(item_id) : undefined}
                            />
                          );
                        })}
                      </div>
                    )}

                    {/* Relic rows */}
                    {nativeRelics.length > 0 && (
                      <div className="space-y-1">
                        {nativeRelics.map((relic, i) => {
                          const relicEntry = allEntries.find(e => e.id === relic.entry_id);
                          return (
                            <div key={i} className="flex items-start gap-1.5 text-xs">
                              <Gem className="h-3 w-3 shrink-0 mt-0.5 text-violet-400" />
                              <div className="flex-1 min-w-0">
                                <span className="truncate">{relicEntry?.name ?? `Relic #${relic.entry_id}`}</span>
                                {relic.notes && (
                                  <p className="text-muted-foreground/60 italic truncate">{relic.notes}</p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => setNativeRelics(prev => prev.filter((_, j) => j !== i))}
                                className="text-muted-foreground hover:text-destructive"
                                title="Remove relic"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Add relic */}
                    {(() => {
                      const nativeRelicIds = new Set(nativeRelics.map(r => r.entry_id));
                      const addableRelics = allEntries.filter(e => e.entry_type === "relic" && !nativeRelicIds.has(e.id));
                      const none = addableRelics.length === 0;
                      return (
                        <div className="flex gap-1.5 items-center pt-1 border-t border-border/40">
                          <span title="Relics — items special, typical or bound to this character">
                            <Gem className="h-3 w-3 shrink-0 text-violet-400" />
                          </span>
                          <select
                            value={addRelicId}
                            onChange={e => setAddRelicId(e.target.value)}
                            disabled={none}
                            className="flex-1 h-6 text-xs rounded border border-border bg-background px-1 min-w-0 disabled:opacity-50"
                          >
                            <option value="">{none ? "No relics available" : "Select relic…"}</option>
                            {addableRelics.map(e => (
                              <option key={e.id} value={String(e.id)}>{e.name}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={addRelicNotes}
                            onChange={e => setAddRelicNotes(e.target.value)}
                            placeholder="Notes…"
                            disabled={none}
                            className="flex-1 h-6 text-xs rounded border border-border bg-background px-1.5 min-w-0 disabled:opacity-50"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const id = parseInt(addRelicId, 10);
                              if (!id) return;
                              setNativeRelics(prev => [...prev, { entry_id: id, notes: addRelicNotes.trim() || undefined }]);
                              setAddRelicId("");
                              setAddRelicNotes("");
                            }}
                            disabled={none}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                            title="Add relic"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })()}

                    {/* Add native currency */}
                    <div className="flex gap-1.5 items-center pt-1 border-t border-border/40">
                      <Coins className="h-3 w-3 shrink-0 text-yellow-500" />
                      <input
                        type="text"
                        value={addCurrencyName}
                        onChange={e => setAddCurrencyName(e.target.value)}
                        placeholder="Currency name…"
                        className="flex-1 h-6 text-xs rounded border border-border bg-background px-1.5 min-w-0"
                      />
                      <input
                        type="number"
                        value={addCurrencyAmount}
                        onChange={e => setAddCurrencyAmount(e.target.value)}
                        className="w-14 h-6 text-xs rounded border border-border bg-background px-1.5"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const n = addCurrencyName.trim();
                          if (!n || nativeCurrencies.find(c => c.name === n)) return;
                          setNativeCurrencies(prev => [...prev, { name: n, amount: parseInt(addCurrencyAmount, 10) || 0 }]);
                          setAddCurrencyName("");
                          setAddCurrencyAmount("0");
                        }}
                        className="text-muted-foreground hover:text-foreground"
                        title="Add currency"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Add native item */}
                    {addableItems.length > 0 && (
                      <div className="flex gap-1.5 items-center">
                        <Package className="h-3 w-3 shrink-0 text-blue-400" />
                        <select
                          value={addItemId}
                          onChange={e => setAddItemId(e.target.value)}
                          className="flex-1 h-6 text-xs rounded border border-border bg-background px-1 min-w-0"
                        >
                          <option value="">Select item…</option>
                          {addableItems.map(e => (
                            <option key={e.id} value={String(e.id)}>{e.name}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          value={addItemQty}
                          onChange={e => setAddItemQty(e.target.value)}
                          className="w-14 h-6 text-xs rounded border border-border bg-background px-1.5"
                          min="1"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const id = parseInt(addItemId, 10);
                            if (!id) return;
                            setNativePossessions(prev => [...prev, { entry_id: id, quantity: parseInt(addItemQty, 10) || 1 }]);
                            setAddItemId("");
                            setAddItemQty("1");
                          }}
                          className="text-muted-foreground hover:text-foreground"
                          title="Add item"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Sharing — visible for all existing entries in all projects ── */}
              {isExisting && (
                <div className="rounded-lg border border-border overflow-hidden">
                  {/* Collapsible header */}
                  <button
                    type="button"
                    onClick={() => setSharingSectionOpen(o => !o)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-left hover:bg-secondary/30 transition-colors"
                  >
                    <Share2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1">Sharing</span>
                    {shareMode === "all" && (
                      <span className="text-[10px] text-muted-foreground/70 font-normal">All projects</span>
                    )}
                    {shareMode === "specific" && (
                      <span className="text-[10px] text-primary/70 font-normal">{accessProjectIds.length} selected</span>
                    )}
                    {shareMode === "none" && (
                      <span className="text-[10px] text-muted-foreground/70 font-normal">This project only</span>
                    )}
                    {sharingSectionOpen
                      ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    }
                  </button>

                  {sharingSectionOpen && (
                    <div className="px-3 pb-3 space-y-3 border-t border-border/50">
                      {/* Mode picker */}
                      <div className="pt-2 space-y-1">
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Visible to</p>
                        <div className="space-y-1.5">
                          {(["all", "specific", "none"] as const).map((mode) => (
                            <label key={mode} className="flex items-start gap-2 cursor-pointer select-none">
                              <input
                                type="radio"
                                name="shareMode"
                                value={mode}
                                checked={shareMode === mode}
                                onChange={() => setShareMode(mode)}
                                className="mt-0.5 accent-primary"
                              />
                              <div>
                                <span className="text-sm font-medium">
                                  {mode === "all" && (
                                    <span className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" /> All linked projects</span>
                                  )}
                                  {mode === "specific" && (
                                    <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Specific projects</span>
                                  )}
                                  {mode === "none" && (
                                    <span className="flex items-center gap-1.5"><EyeOff className="h-3.5 w-3.5" /> This project only</span>
                                  )}
                                </span>
                                <p className="text-[11px] text-muted-foreground">
                                  {mode === "all" && "Visible to all linked projects — current and future (default)"}
                                  {mode === "specific" && "Only visible to the projects you select below"}
                                  {mode === "none" && "Private — not shared with any linked project"}
                                </p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Project checklist — only when 'specific' */}
                      {shareMode === "specific" && (
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Select projects</p>
                          {sharingProjects.length > 0 ? (
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                              {sharingProjects.map(p => (
                                <label key={p.id} className="flex items-center gap-2 cursor-pointer px-1 py-0.5 rounded hover:bg-secondary/40 select-none">
                                  <input
                                    type="checkbox"
                                    checked={accessProjectIds.includes(p.id)}
                                    onChange={(e) => setAccessProjectIds(prev =>
                                      e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id)
                                    )}
                                    className="accent-primary"
                                  />
                                  <span className="text-sm">{p.title}</span>
                                </label>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground/60 italic">No other projects are linked to this codex yet.</p>
                          )}
                          {/* Auto-share with future linked projects */}
                          <label className="flex items-center gap-2 cursor-pointer pt-1 select-none border-t border-border/30 mt-2">
                            <input
                              type="checkbox"
                              checked={shareFuture}
                              onChange={e => setShareFuture(e.target.checked)}
                              className="accent-primary"
                            />
                            <div>
                              <span className="text-sm">Auto-share with future linked projects</span>
                              <p className="text-[11px] text-muted-foreground">Automatically grant access when a new project links this codex</p>
                            </div>
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Relations — only for existing (saved) entries */}
              {isExisting && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5" /> {t("entry_relations")}
                  </Label>

                  {/* Existing relations list — auto: entries are shown in Inventory, not here */}
                  {relations.filter((r: CodexRelationResolved) => !r.relation_type?.startsWith("auto:")).length > 0 && (
                    <div className="space-y-1">
                      {relations.filter((r: CodexRelationResolved) => !r.relation_type?.startsWith("auto:")).map((r: CodexRelationResolved) => (
                        <div
                          key={r.id}
                          className="flex items-center justify-between text-sm px-2 py-1 rounded bg-secondary/40"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: r.other_color }}
                            />
                            {onOpenRelation ? (
                              <button
                                type="button"
                                onClick={() => onOpenRelation(r.other_id)}
                                className="font-medium truncate hover:underline hover:text-primary transition-colors text-left"
                              >
                                {r.other_name}
                              </button>
                            ) : (
                              <span className="font-medium truncate">{r.other_name}</span>
                            )}
                            {r.relation_type && (
                              <span className="text-xs text-muted-foreground">— {r.relation_type}</span>
                            )}
                          </div>
                          <button
                            onClick={() => deleteRel.mutate(r.id)}
                            className="text-muted-foreground hover:text-destructive ml-2 flex-shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add relation row */}
                  {otherEntries.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      <Select value={relTarget} onValueChange={setRelTarget}>
                        <SelectTrigger className="flex-1 min-w-0 h-8 text-xs">
                          <SelectValue placeholder={t("bulk_select_entry")} />
                        </SelectTrigger>
                        <SelectContent>
                          {otherEntriesByType.map(({ type, label, entries }) => (
                            <SelectGroup key={type}>
                              <SelectLabel>{label}</SelectLabel>
                              {entries.map((e) => (
                                <SelectItem key={e.id} value={String(e.id)}>
                                  <span className="flex items-center gap-1.5">
                                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
                                    {e.name}{e.is_main_char ? " ★" : ""}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select value={relPreset} onValueChange={setRelPreset}>
                        <SelectTrigger className="w-32 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RELATION_GROUPS.map(({ label, items }) => (
                            <SelectGroup key={label}>
                              <SelectLabel>{label}</SelectLabel>
                              {items.map((r) => (
                                <SelectItem key={r} value={r}>{r}</SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>

                      {relPreset === "custom…" && (
                        <Input
                          className="h-8 text-xs flex-1 min-w-0"
                          value={relCustom}
                          onChange={(e) => setRelCustom(e.target.value)}
                          placeholder={t("bulk_custom_relation")}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRelation(); } }}
                        />
                      )}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2"
                        onClick={addRelation}
                        disabled={!relTarget || !effectiveRelType || createRel.isPending}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Right column: Description ── */}
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              {/* Label row with structure + translate buttons */}
              <div className="flex items-center justify-between min-h-[1.5rem]">
                <Label>{t("entry_description")}</Label>
                <div className="flex items-center gap-1">
                  {(translating || structuring) && (
                    <span className="text-[11px] text-muted-foreground animate-pulse">
                      {structuring ? "Structuring…" : "Translating…"}
                    </span>
                  )}
                  {!aiDisabled && !translateOpen && !structureOpen && !translating && !structuring && (
                    <>
                      <button
                        type="button"
                        onClick={() => setStructureOpen(true)}
                        disabled={!description.trim()}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-secondary transition-colors disabled:opacity-40"
                        title="Organise description into sections"
                      >
                        <LayoutList className="h-3 w-3" />
                        Structure
                      </button>
                      <button
                        type="button"
                        onClick={() => setTranslateOpen(true)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-secondary transition-colors"
                        title="Translate description with AI"
                      >
                        <Globe className="h-3 w-3" />
                        Translate
                      </button>
                    </>
                  )}
                  {!aiDisabled && structureOpen && !structuring && !translating && (
                    <div className="flex items-center gap-1">
                      <select
                        value={structureLang}
                        onChange={e => setStructureLang(e.target.value)}
                        className="h-6 text-[11px] rounded border border-border bg-background px-1.5 outline-none"
                      >
                        {TRANSLATE_LANGUAGES.map(l => (
                          <option key={l.code} value={l.label}>{l.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleStructure}
                        disabled={!description.trim()}
                        className="text-[11px] px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
                      >
                        Go
                      </button>
                      <button
                        type="button"
                        onClick={() => setStructureOpen(false)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  {!aiDisabled && translateOpen && !translating && !structuring && (
                    <div className="flex items-center gap-1">
                      <select
                        value={translateLang}
                        onChange={e => setTranslateLang(e.target.value)}
                        className="h-6 text-[11px] rounded border border-border bg-background px-1.5 outline-none"
                      >
                        {TRANSLATE_LANGUAGES.map(l => (
                          <option key={l.code} value={l.label}>{l.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleTranslate}
                        disabled={!description.trim()}
                        className="text-[11px] px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
                      >
                        Go
                      </button>
                      <button
                        type="button"
                        onClick={() => setTranslateOpen(false)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Who or what is this?"
                className="flex-1 resize-none min-h-[120px]"
              />

              {/* ── AI structure suggestions confirmation panel ── */}
              {pendingSugg && (
                <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2.5 text-sm">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    Suggestions — check what to apply
                  </p>

                  {pendingSugg.suggested_tags.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">Tags</p>
                      <div className="flex flex-wrap gap-1.5">
                        {pendingSugg.suggested_tags.map(tag => (
                          <label key={tag} className="flex items-center gap-1 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={suggTags.includes(tag)}
                              onChange={e => setSuggTags(prev =>
                                e.target.checked ? [...prev, tag] : prev.filter(t => t !== tag)
                              )}
                              className="accent-primary w-3.5 h-3.5"
                            />
                            <span className="text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                              #{tag}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {pendingSugg.suggested_groups.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">Groups</p>
                      <div className="flex flex-wrap gap-1.5">
                        {pendingSugg.suggested_groups.map(group => (
                          <label key={group} className="flex items-center gap-1 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={suggGroups.includes(group)}
                              onChange={e => setSuggGroups(prev =>
                                e.target.checked ? [...prev, group] : prev.filter(g => g !== group)
                              )}
                              className="accent-primary w-3.5 h-3.5"
                            />
                            <span className="text-[11px] bg-secondary px-1.5 py-0.5 rounded">
                              {group}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {pendingSugg.suggested_subtype && entryType !== "character" && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">Subtype</p>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={suggSubtype}
                          onChange={e => setSuggSubtype(e.target.checked)}
                          className="accent-primary w-3.5 h-3.5"
                        />
                        <span className="text-[11px]">{pendingSugg.suggested_subtype}</span>
                      </label>
                    </div>
                  )}

                  <div className="flex gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={handleApplySuggestions}
                      disabled={!suggTags.length && !suggGroups.length && !suggSubtype}
                      className="text-[11px] px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                    >
                      Apply selected
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingSugg(null)}
                      className="text-[11px] px-3 py-1 rounded hover:bg-secondary text-muted-foreground transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>{/* end two-column row */}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>{t("common_cancel")}</Button>
            <Button onClick={handleSave} disabled={!name.trim()}>{t("entry_save")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
