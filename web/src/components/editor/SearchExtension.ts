import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { DecorationSet, Decoration } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// ── Plugin state ──────────────────────────────────────────────────────────────

interface SearchState {
  term: string;
  results: Array<{ from: number; to: number }>;
  current: number;
}

export const SEARCH_KEY = new PluginKey<SearchState>("editorSearch");

function findAll(doc: ProseMirrorNode, term: string): Array<{ from: number; to: number }> {
  if (!term) return [];
  const lower = term.toLowerCase();
  const results: Array<{ from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let idx = 0;
    while ((idx = text.indexOf(lower, idx)) !== -1) {
      results.push({ from: pos + idx, to: pos + idx + term.length });
      idx += 1;
    }
  });
  return results;
}

// ── Command type augmentation ─────────────────────────────────────────────────

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    editorSearch: {
      setSearchTerm: (term: string) => ReturnType;
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
      setSearchTerm: (term: string) => ({ tr, dispatch, state }) => {
        if (dispatch) {
          if (!term) {
            tr.setMeta(SEARCH_KEY, { type: "CLEAR" });
          } else {
            const results = findAll(state.doc, term);
            tr.setMeta(SEARCH_KEY, { type: "SET", term, results, current: 0 });
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
          tr.insertText(replacement, from, to);
          // Continue at the first match after the inserted text, so a
          // replacement that itself contains the term isn't matched again.
          const end = from + replacement.length;
          const results = findAll(tr.doc, s.term);
          const next = Math.max(0, results.findIndex((r) => r.from >= end));
          tr.setMeta(SEARCH_KEY, { type: "SET", term: s.term, results, current: next });
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
          // Back to front so earlier positions stay valid.
          for (const { from, to } of [...s.results].reverse()) {
            tr.insertText(replacement, from, to);
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
            return { term: "", results: [], current: 0 };
          },
          apply(tr, prev, _, newState): SearchState {
            const meta = tr.getMeta(SEARCH_KEY);
            if (meta?.type === "SET") {
              return { term: meta.term, results: meta.results, current: meta.current ?? 0 };
            }
            if (meta?.type === "CLEAR") {
              return { term: "", results: [], current: 0 };
            }
            if (meta?.type === "GOTO") {
              return { ...prev, current: meta.current };
            }
            // Re-run search when doc changes so highlights stay in sync while typing
            if (tr.docChanged && prev.term) {
              const results = findAll(newState.doc, prev.term);
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
