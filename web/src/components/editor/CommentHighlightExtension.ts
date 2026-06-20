import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

export interface CommentHighlight {
  id:    number;
  from:  number;
  to:    number;
  color: string;
}

export const COMMENT_PLUGIN_KEY = new PluginKey<DecorationSet>("commentHighlight");

function buildDecorations(doc: unknown, highlights: CommentHighlight[]): DecorationSet {
  if (!highlights.length) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  for (const h of highlights) {
    if (h.from >= h.to) continue;
    try {
      decorations.push(
        Decoration.inline(h.from, h.to, {
          class: "comment-highlight",
          style: `background-color: ${h.color}E6; border-bottom: 2px solid ${h.color};`,
          "data-comment-id": String(h.id),
        })
      );
    } catch {
      // pos out of range — skip stale highlight
    }
  }
  return DecorationSet.create(doc as Parameters<typeof DecorationSet.create>[0], decorations);
}

export function createCommentHighlightPlugin(
  getHighlights: () => CommentHighlight[],
  onClick: (commentId: number) => void,
) {
  return new Plugin<DecorationSet>({
    key: COMMENT_PLUGIN_KEY,
    state: {
      init(_, { doc }) {
        return buildDecorations(doc, getHighlights());
      },
      apply(tr, old) {
        const meta = tr.getMeta(COMMENT_PLUGIN_KEY);
        if (meta) {
          return buildDecorations(tr.doc, meta as CommentHighlight[]);
        }
        if (tr.docChanged) {
          // Remap existing decorations through the transaction for drift correction.
          return old.map(tr.mapping, tr.doc);
        }
        return old;
      },
    },
    props: {
      decorations(state) {
        return COMMENT_PLUGIN_KEY.getState(state);
      },
      handleClick(view, _pos, event) {
        const el = (event.target as HTMLElement).closest("[data-comment-id]") as HTMLElement | null;
        if (el) {
          onClick(Number(el.dataset.commentId));
          return true;
        }
        return false;
      },
    },
  });
}

/** Push a new set of highlights into the editor (replaces old set). */
export function setCommentHighlights(view: EditorView, highlights: CommentHighlight[]) {
  view.dispatch(view.state.tr.setMeta(COMMENT_PLUGIN_KEY, highlights));
}

/** Read the current remapped positions back out (for sync-on-save). */
export function getCommentPositions(view: EditorView): CommentHighlight[] {
  const set = COMMENT_PLUGIN_KEY.getState(view.state);
  if (!set) return [];
  const results: CommentHighlight[] = [];
  // DecorationSet doesn't expose decorations directly; find them via find()
  const found = set.find();
  for (const d of found) {
    const el = d.spec as { "data-comment-id"?: string; style?: string; class?: string };
    if (el["data-comment-id"]) {
      // Extract color from style for reference (not needed by caller — they only need from/to/id)
      results.push({
        id:    Number(el["data-comment-id"]),
        from:  d.from,
        to:    d.to,
        color: "",
      });
    }
  }
  return results;
}

export const CommentHighlightExtension = Extension.create({
  name: "commentHighlight",
});
