"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { StickyNote, Coins, Package, ImageIcon, Sparkles, MessageSquare, Braces, GitBranch, Table2, ListChecks, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

export interface CommandItem {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  keywords: string[];
  content: (() => object) | null;
}

export const COMMANDS: CommandItem[] = [
  {
    id: "note",
    label: "Note",
    description: "Annotation visible only while writing",
    icon: StickyNote,
    color: "#f59e0b",
    keywords: ["note", "annotation"],
    content: () => ({ type: "note", content: [{ type: "paragraph" }] }),
  },
  {
    id: "currency",
    label: "Currency",
    description: "Track a currency change for a character",
    icon: Coins,
    color: "#22c55e",
    keywords: ["currency", "money"],
    content: () => ({ type: "currency", attrs: { charId: 0, currencyName: "", delta: 0 } }),
  },
  {
    id: "item",
    label: "Item",
    description: "Assign an item possession to a character",
    icon: Package,
    color: "#3b82f6",
    keywords: ["item", "object", "possession"],
    content: () => ({ type: "item", attrs: { charId: 0, itemId: 0, qty: 1 } }),
  },
  {
    id: "image",
    label: "Image",
    description: "Insert an inline illustration",
    icon: ImageIcon,
    color: "#a855f7",
    keywords: ["image", "picture", "illustration"],
    content: () => ({ type: "sceneImage", attrs: { src: "", caption: "" } }),
  },
  {
    id: "ki",
    label: "AI Generate",
    description: "AI text generation with selected context",
    icon: Sparkles,
    color: "#f472b6",
    keywords: ["ai", "generate", "ki", "knowledge", "inject"],
    content: () => ({ type: "ki", attrs: { model: "", codexIds: "", sceneIds: "", prompt: "" } }),
  },
  {
    id: "chat",
    label: "Scene Chat",
    description: "Chat with AI about this scene to brainstorm ideas",
    icon: MessageSquare,
    color: "#06b6d4",
    keywords: ["chat", "discuss", "brainstorm", "ideas", "talk"],
    content: null,
  },
  {
    id: "placeholder",
    label: "Placeholder",
    description: "Insert a [ghost text] placeholder to fill in later",
    icon: Braces,
    color: "#f59e0b",
    keywords: ["placeholder", "ghost", "todo", "fill", "bracket"],
    content: null,
  },
  {
    id: "timeline",
    label: "Timeline",
    description: "Pin this scene to a timeline track with a time",
    icon: GitBranch,
    color: "#10b981",
    keywords: ["timeline", "time", "track", "event", "when", "date"],
    content: null,
  },
  {
    id: "tasklist",
    label: "Checklist",
    description: "Insert a task / to-do checklist",
    icon: ListChecks,
    color: "#22c55e",
    keywords: ["task", "checklist", "todo", "check", "list"],
    content: () => ({
      type: "taskList",
      content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }],
    }),
  },
  {
    id: "table",
    label: "Table",
    description: "Insert a 3×3 table — great for codex entries and snippets",
    icon: Table2,
    color: "#64748b",
    keywords: ["table", "grid", "row", "column", "cell", "codex", "matrix"],
    content: null,
  },
  {
    id: "link",
    label: "Scene Links",
    description: "Link research, snippets, and sources to this scene",
    icon: LinkIcon,
    color: "#0ea5e9",
    keywords: ["link", "research", "source", "snippet", "idea", "reference", "clipping"],
    content: null,
  },
];

export interface SlashMenuHandle {
  handleKey(e: KeyboardEvent): boolean;
}

interface Props {
  items: CommandItem[];
  rect: DOMRect | null;
  onSelect: (item: CommandItem) => void;
  onClose: () => void;
}

export const SlashCommandMenu = forwardRef<SlashMenuHandle, Props>(
  function SlashCommandMenu({ items, rect, onSelect, onClose }, ref) {
    const { t } = useLanguage();
    const menuRef = useRef<HTMLDivElement>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [openAbove, setOpenAbove] = useState(false);

    // Reset active index when items change (query updated)
    useEffect(() => {
      setActiveIndex(0);
    }, [items]);

    // Flip the menu above the cursor if it would overflow the bottom of the viewport.
    // useLayoutEffect runs before the browser paints so there is no visible flicker.
    useLayoutEffect(() => {
      if (!menuRef.current || !rect) return;
      const spaceBelow = window.innerHeight - rect.bottom - 4;
      setOpenAbove(spaceBelow < menuRef.current.offsetHeight);
    }, [rect, items]);

    // Close on click outside
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
          onClose();
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [onClose]);

    useImperativeHandle(ref, () => ({
      handleKey(e: KeyboardEvent): boolean {
        if (items.length === 0) return false;
        if (e.key === "ArrowDown") {
          setActiveIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (e.key === "ArrowUp") {
          setActiveIndex((i) => (i - 1 + items.length) % items.length);
          return true;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          onSelect(items[activeIndex]);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0 || !rect) return null;

    return (
      <div
        ref={menuRef}
        className="fixed z-50 w-64 rounded-lg border border-border bg-popover shadow-lg py-1"
        style={{
          left: Math.min(rect.left, window.innerWidth - 280),
          // When opening above: anchor the bottom edge just above the cursor line.
          // CSS `bottom` with position:fixed = distance from the viewport bottom.
          ...(openAbove
            ? { bottom: window.innerHeight - rect.top + 4 }
            : { top: rect.bottom + 4 }),
        }}
      >
        <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("slash_insert_command")}
        </p>
        {items.map((cmd, i) => {
          const Icon = cmd.icon;
          return (
            <button
              key={cmd.id}
              type="button"
              className={cn(
                "w-full text-left flex items-start gap-3 px-3 py-2 transition-colors",
                i === activeIndex ? "bg-secondary" : "hover:bg-secondary"
              )}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent editor blur
                onSelect(cmd);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span
                className="mt-0.5 p-1.5 rounded"
                style={{ background: `${cmd.color}20`, color: cmd.color }}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div>
                <p className="text-sm font-medium">{cmd.label}</p>
                <p className="text-xs text-muted-foreground">{cmd.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    );
  }
);
