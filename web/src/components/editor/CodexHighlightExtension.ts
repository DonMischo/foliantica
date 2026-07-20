import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { CodexEntry } from "@/types";

export const PLUGIN_KEY = new PluginKey("codexHighlight");

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * German genitive of a name/phrase by suffixing "-s" onto the last word,
 * e.g. "Lyra" -> "Lyras", "Lyra Nightsong" -> "Lyra Nightsongs". German fuses
 * the genitive onto a name with no separator (unlike English's apostrophe,
 * "Lyra's"), so there is no word boundary for the highlight regex to already
 * catch this — the suffixed form is registered as its own term instead.
 * Names already ending in a sibilant (s/ß/x/z, or "tz") form the genitive
 * with an apostrophe instead of a fused "-s" (e.g. "Klaus" -> "Klaus'"), so
 * those are left unmodified. Mirrors _genitive_suffixed in
 * api/routers/scenes.py and docker/spacy/server.py (duplicated, not shared —
 * different runtimes), so all three mention-matching paths agree.
 */
function genitiveSuffixed(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(" ");
  const last = parts[parts.length - 1];
  const lastChar = last?.[last.length - 1];
  if (!lastChar || !/\p{L}/u.test(lastChar)) return null;
  const lastLower = last.toLowerCase();
  if ("sxzß".includes(lastLower[lastLower.length - 1]) || lastLower.endsWith("tz")) return null;
  return [...parts.slice(0, -1), last + "s"].join(" ");
}

export interface PatchedEntry extends CodexEntry {
  _allTerms: string[];
}

/** `lang`: BCP 47 project language (e.g. "de-DE") — pass to also match the
 * German genitive form of each name/alias. Omit or "en" for English-only. */
export function patchEntryAliases(entries: CodexEntry[], lang?: string | null): PatchedEntry[] {
  const primaryLang = (lang || "en").split("-")[0].split("_")[0].toLowerCase();
  return entries.map((e) => {
    const base = [e.name, ...(Array.isArray(e.aliases) ? e.aliases : [])];
    const terms = primaryLang === "de"
      ? [...base, ...base.map(genitiveSuffixed).filter((t): t is string => !!t)]
      : base;
    return {
      ...e,
      _allTerms: terms.sort((a, b) => b.length - a.length),
    };
  });
}

function buildDecorations(doc: any, entries: PatchedEntry[]): DecorationSet {
  if (!entries.length) return DecorationSet.empty;

  const decorations: Decoration[] = [];

  for (const entry of entries) {
    if (!entry._allTerms.length) continue;
    const pattern = new RegExp(`\\b(${entry._allTerms.map(escapeRegex).join("|")})\\b`, "gi");

    doc.descendants((node: any, pos: number) => {
      if (!node.isText || !node.text) return;
      let match;
      while ((match = pattern.exec(node.text)) !== null) {
        const from = pos + match.index;
        const to = from + match[0].length;
        decorations.push(
          Decoration.inline(from, to, {
            class: "codex-highlight",
            style: `border-color: ${entry.color}; background-color: ${entry.color}22; color: ${entry.color};`,
            "data-codex-id": String(entry.id),
            "data-codex-name": entry.name,
            "data-codex-type": entry.entry_type,
            "data-codex-desc": (entry.description || "").substring(0, 120),
          })
        );
      }
    });
  }

  return DecorationSet.create(doc, decorations);
}

export function createCodexHighlightPlugin(
  getEntries: () => PatchedEntry[],
  onEntryClick: (id: number) => void
) {
  return new Plugin({
    key: PLUGIN_KEY,
    state: {
      init(_, { doc }) {
        return buildDecorations(doc, getEntries());
      },
      apply(tr, old) {
        if (tr.docChanged || tr.getMeta(PLUGIN_KEY)) {
          return buildDecorations(tr.doc, getEntries());
        }
        return old.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) {
        return PLUGIN_KEY.getState(state);
      },
      handleClick(view, _pos, event) {
        const target = event.target as HTMLElement;
        const el = target.closest("[data-codex-id]") as HTMLElement | null;
        if (el) {
          onEntryClick(Number(el.dataset.codexId));
          return true;
        }
        return false;
      },
    },
  });
}
