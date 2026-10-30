import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { DecorationSet, Decoration } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// ── Plugin state ──────────────────────────────────────────────────────────────

export interface SearchOptions {
  regex?: boolean;
  caseSensitive?: boolean;
}

interface SearchState {
  term: string;
  options: SearchOptions;
  results: Array<{ from: number; to: number }>;
  current: number;
}

export const SEARCH_KEY = new PluginKey<SearchState>("editorSearch");

/** null when `term` is not a valid regex in regex mode. */
export function buildSearchRegex(term: string, options: SearchOptions, flags = "g"): RegExp | null {
  const source = options.regex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(source, flags + (options.caseSensitive ? "" : "i"));
  } catch {
    return null;
  }
}

// A textblock's content as a string with exactly one character per document
// position (inline non-text nodes become U+FFFC), so string offsets map
// straight back to positions. Searching per block lets ^/$ anchor to the
// paragraph and matches span bold/italic boundaries.
function blockText(block: ProseMirrorNode): string {
  let text = "";
  block.forEach((child) => {
    text += child.isText ? child.text! : "\ufffc".repeat(child.nodeSize);
  });
  return text;
}

function findAll(doc: ProseMirrorNode, term: string, options: SearchOptions): Array<{ from: number; to: number }> {
  const re = term ? buildSearchRegex(term, options) : null;
  if (!re) return [];
  const results: Array<{ from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = blockText(node);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      results.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length });
      if (m[0] === "") re.lastIndex++; // don't loop forever on empty matches like ^
    }
    return false;
  });
  return results;
}

/** Re-runs the regex at a known result to recover its capture groups. */
function matchAt(doc: ProseMirrorNode, from: number, term: string, options: SearchOptions): RegExpExecArray | null {
  const re = buildSearchRegex(term, options, "y");
  if (!re) return null;
  const $pos = doc.resolve(from);
  re.lastIndex = from - $pos.start();
  return re.exec(blockText($pos.parent));
}

/**
 * Notepad++-style replacement: $0 / $& / \0 whole match, $1–$99 / ${n} / \1–\9
 * groups, \t tab, \\ backslash, $$ dollar. Unknown groups expand to "".
 */
export function expandReplacement(template: string, m: RegExpExecArray): string {
  return template.replace(/\$\$|\$&|\$\{(\d+)\}|\$(\d\d?)|\\([0-9t\\])/g, (tok, braced, dollar, esc) => {
    if (tok === "$$") return "$";
    if (tok === "$&") return m[0];
    if (braced !== undefined) return m[Number(braced)] ?? "";
    if (dollar !== undefined) {
      // $12 with fewer than 12 groups means group 1 followed by a literal "2"
      if (dollar.length === 2 && Number(dollar) >= m.length) return (m[Number(dollar[0])] ?? "") + dollar[1];
      return m[Number(dollar)] ?? "";
    }
    if (esc === "t") return "\t";
    if (esc === "\\") return "\\";
    return m[Number(esc)] ?? "";
  });
}

function replacementFor(doc: ProseMirrorNode, from: number, s: SearchState, replacement: string): string {
  if (!s.options.regex) return replacement;
  const m = matchAt(doc, from, s.term, s.options);
  return m ? expandReplacement(replacement, m) : replacement;
}

// ── Command type augmentation ─────────────────────────────────────────────────

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    editorSearch: {
      setSearchTerm: (term: string, options?: SearchOptions) => ReturnType;
      clearSearch: () => ReturnType;
      nextSearchResult: () => ReturnType;
      prevSearchResult: () => ReturnType;
      replaceCurrent: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
    };
  }
}

// ── Extension ─────────────────────────────────────────────────────────────────

export const SearchExtension = Extension.create({
  name: "editorSearch",

  addCommands() {
    return {
      setSearchTerm: (term: string, options: SearchOptions = {}) => ({ tr, dispatch, state }) => {
        if (dispatch) {
          if (!term) {
            tr.setMeta(SEARCH_KEY, { type: "CLEAR" });
          } else {
            const results = findAll(state.doc, term, options);
            tr.setMeta(SEARCH_KEY, { type: "SET", term, options, results, current: 0 });
            if (results.length > 0) {
              tr.setSelection(TextSelection.create(state.doc, results[0].from));
              tr.scrollIntoView();
            }
          }
          dispatch(tr);
        }
        return true;
      },

      clearSearch: () => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.setMeta(SEARCH_KEY, { type: "CLEAR" });
          dispatch(tr);
        }
        return true;
      },

      nextSearchResult: () => ({ tr, dispatch, state }) => {
        const s = SEARCH_KEY.getState(state);
        if (!s?.results.length) return false;
        const next = (s.current + 1) % s.results.length;
        if (dispatch) {
          tr.setMeta(SEARCH_KEY, { type: "GOTO", current: next });
          tr.setSelection(TextSelection.create(state.doc, s.results[next].from));
          tr.scrollIntoView();
          dispatch(tr);
        }
        return true;
      },

      prevSearchResult: () => ({ tr, dispatch, state }) => {
        const s = SEARCH_KEY.getState(state);
        if (!s?.results.length) return false;
        const prev = (s.current - 1 + s.results.length) % s.results.length;
        if (dispatch) {
          tr.setMeta(SEARCH_KEY, { type: "GOTO", current: prev });
          tr.setSelection(TextSelection.create(state.doc, s.results[prev].from));
          tr.scrollIntoView();
          dispatch(tr);
        }
        return true;
      },

      replaceCurrent: (replacement: string) => ({ tr, dispatch, state }) => {
        const s = SEARCH_KEY.getState(state);
        if (!s?.results.length) return false;
        if (dispatch) {
          const { from, to } = s.results[s.current];
          const text = replacementFor(state.doc, from, s, replacement);
          tr.insertText(text, from, to);
          // Continue at the first match after the inserted text, so a
          // replacement that itself contains the term isn't matched again.
          const end = from + text.length;
          const results = findAll(tr.doc, s.term, s.options);
          const next = Math.max(0, results.findIndex((r) => r.from >= end));
          tr.setMeta(SEARCH_KEY, { type: "SET", term: s.term, options: s.options, results, current: next });
          if (results.length > 0) {
            tr.setSelection(TextSelection.create(tr.doc, results[next].from));
            tr.scrollIntoView();
          }
          dispatch(tr);
        }
        return true;
      },

      replaceAll: (replacement: string) => ({ tr, dispatch, state }) => {
        const s = SEARCH_KEY.getState(state);
        if (!s?.results.length) return false;
        if (dispatch) {
          // Expand against the original doc, then apply back to front so
          // earlier positions stay valid.
          const texts = s.results.map((r) => replacementFor(state.doc, r.from, s, replacement));
          for (let i = s.results.length - 1; i >= 0; i--) {
            tr.insertText(texts[i], s.results[i].from, s.results[i].to);
          }
          dispatch(tr);
        }
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: SEARCH_KEY,
        state: {
          init(): SearchState {
            return { term: "", options: {}, results: [], current: 0 };
          },
          apply(tr, prev, _, newState): SearchState {
            const meta = tr.getMeta(SEARCH_KEY);
            if (meta?.type === "SET") {
              return { term: meta.term, options: meta.options, results: meta.results, current: meta.current ?? 0 };
            }
            if (meta?.type === "CLEAR") {
              return { term: "", options: {}, results: [], current: 0 };
            }
            if (meta?.type === "GOTO") {
              return { ...prev, current: meta.current };
            }
            // Re-run search when doc changes so highlights stay in sync while typing
            if (tr.docChanged && prev.term) {
              const results = findAll(newState.doc, prev.term, prev.options);
              return { ...prev, results, current: Math.min(prev.current, Math.max(0, results.length - 1)) };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            const s = SEARCH_KEY.getState(state);
            if (!s?.term || !s.results.length) return DecorationSet.empty;
            const decos = s.results.map((r, i) =>
              Decoration.inline(r.from, r.to, {
                class: i === s.current ? "search-result search-result-current" : "search-result",
              })
            );
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
