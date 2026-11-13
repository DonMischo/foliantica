import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { EditorView } from "@tiptap/pm/view";
import type { SceneComment } from "@/lib/api";
import { createCommentHighlightPlugin } from "@/components/editor/CommentHighlightExtension";

const comment = (over: Partial<SceneComment>): SceneComment => ({
  id: 1, scene_id: 1, from_pos: 1, to_pos: 5, anchor_text: "anchor", ctx_before: null, ctx_after: null,
  body: "body", author_name: "Ann", author_role: "host", color: "#ff0000", category: "",
  resolved: false, created_at: "2026-11-13T10:00:00", ...over,
});

const comments = [
  comment({ id: 1, body: "First body", category: "Plot" }),
  comment({ id: 2, body: "Second body", category: "Style" }),
];

vi.mock("@/lib/api", () => ({ getCoworkIdentity: () => null }));

vi.mock("@/store/queries", () => ({
  useComments: () => ({ data: comments, isLoading: false }),
  useUpdateComment: () => ({ mutate: vi.fn() }),
  useDeleteComment: () => ({ mutate: vi.fn() }),
}));

const { CommentsPanel } = await import("../CommentsPanel");

describe("comment highlight click", () => {
  it("reports the clicked comment id", () => {
    const onClick = vi.fn();
    const plugin = createCommentHighlightPlugin(() => [], onClick);
    const span = document.createElement("span");
    span.dataset.commentId = "2";
    const inner = document.createElement("b");
    span.appendChild(inner);
    const handled = plugin.props.handleClick!.call(plugin, {} as EditorView, 0, { target: inner } as unknown as MouseEvent);
    expect(handled).toBe(true);
    expect(onClick).toHaveBeenCalledWith(2);
  });

  it("ignores clicks outside a highlight", () => {
    const onClick = vi.fn();
    const plugin = createCommentHighlightPlugin(() => [], onClick);
    const handled = plugin.props.handleClick!.call(plugin, {} as EditorView, 0,
      { target: document.createElement("p") } as unknown as MouseEvent);
    expect(handled).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("CommentsPanel focus", () => {
  const props = { sceneId: 1, isHost: true, onClose: () => {}, onJumpTo: () => {} };

  it("expands the focused comment", () => {
    render(<CommentsPanel {...props} focus={{ id: 2 }} />);
    expect(screen.getByText("Second body")).toBeTruthy();
    expect(screen.queryByText("First body")).toBeNull();
  });

  it("shows nothing expanded without focus", () => {
    render(<CommentsPanel {...props} />);
    expect(screen.queryByText("First body")).toBeNull();
    expect(screen.queryByText("Second body")).toBeNull();
  });
});
