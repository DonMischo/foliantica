"use client";

import { useState } from "react";
import { X, MessageSquare, CheckCircle, Trash2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SceneComment } from "@/lib/api";
import { useComments, useUpdateComment, useDeleteComment } from "@/store/queries";
import { getCoworkIdentity } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  sceneId:   number;
  isHost:    boolean;
  onClose:   () => void;
  onJumpTo:  (from: number) => void;
}

export function CommentsPanel({ sceneId, isHost, onClose, onJumpTo }: Props) {
  const { data: comments = [], isLoading } = useComments(sceneId);
  const updateComment = useUpdateComment(sceneId);
  const deleteComment = useDeleteComment(sceneId);
  const identity = getCoworkIdentity();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function isOwn(c: SceneComment): boolean {
    if (isHost) return true;
    return c.author_name === (identity?.name ?? "");
  }

  const unresolved = comments.filter((c) => !c.resolved);
  const resolved   = comments.filter((c) => c.resolved);

  return (
    <div className="w-72 shrink-0 border-l border-border bg-card flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Comments</span>
          {unresolved.length > 0 && (
            <span className="text-[10px] bg-primary/15 text-primary rounded-full px-1.5 py-0.5">
              {unresolved.length}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading && (
          <p className="text-xs text-muted-foreground text-center py-6">Loading…</p>
        )}
        {!isLoading && comments.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">No comments yet.</p>
        )}

        {unresolved.map((c) => (
          <CommentCard
            key={c.id}
            comment={c}
            expanded={expandedId === c.id}
            isHost={isHost}
            canDelete={isOwn(c)}
            onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
            onJumpTo={() => onJumpTo(c.from_pos)}
            onResolve={() => updateComment.mutate({ id: c.id, data: { resolved: true } })}
            onDelete={() => deleteComment.mutate(c.id)}
          />
        ))}

        {resolved.length > 0 && (
          <>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 pt-3 pb-1">
              Resolved ({resolved.length})
            </p>
            {resolved.map((c) => (
              <CommentCard
                key={c.id}
                comment={c}
                expanded={expandedId === c.id}
                isHost={isHost}
                canDelete={isOwn(c)}
                onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                onJumpTo={() => onJumpTo(c.from_pos)}
                onResolve={() => updateComment.mutate({ id: c.id, data: { resolved: false } })}
                onDelete={() => deleteComment.mutate(c.id)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

interface CardProps {
  comment:   SceneComment;
  expanded:  boolean;
  isHost:    boolean;
  canDelete: boolean;
  onToggle:  () => void;
  onJumpTo:  () => void;
  onResolve: () => void;
  onDelete:  () => void;
}

function CommentCard({ comment: c, expanded, isHost, canDelete, onToggle, onJumpTo, onResolve, onDelete }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-border/60 bg-background/40 text-xs cursor-pointer hover:bg-secondary/30 transition-colors",
        c.resolved && "opacity-50",
      )}
      onClick={onToggle}
    >
      {/* Compact row */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ background: c.color }}
        />
        <span className="font-medium truncate flex-1">{c.author_name}</span>
        <span className="text-muted-foreground/60 shrink-0 text-[10px]">
          {new Date(c.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      </div>

      {/* Anchor text excerpt */}
      <div className="px-2 pb-1.5">
        <span
          className="italic text-muted-foreground/80 line-clamp-1 text-[10px]"
          style={{ borderLeft: `2px solid ${c.color}`, paddingLeft: 6 }}
        >
          {c.anchor_text}
        </span>
      </div>

      {/* Expanded body + actions */}
      {expanded && (
        <div className="px-2 pb-2 space-y-2 border-t border-border/40 pt-2" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs leading-relaxed">{c.body}</p>
          <div className="flex items-center gap-1 flex-wrap">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] gap-1"
              onClick={onJumpTo}
            >
              <Circle className="h-2.5 w-2.5" />
              Jump
            </Button>
            {isHost && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px] gap-1"
                onClick={onResolve}
              >
                <CheckCircle className="h-2.5 w-2.5" />
                {c.resolved ? "Unresolve" : "Resolve"}
              </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px] gap-1 text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="h-2.5 w-2.5" />
                Delete
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
