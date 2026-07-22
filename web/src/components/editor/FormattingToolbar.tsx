"use client";

import { BubbleMenu } from "./BubbleMenuReact";
import type { Editor } from "@tiptap/react";
import { isTextSelection } from "@tiptap/core";
import {
  Bold, Italic, Underline, Strikethrough,
  Heading1, Heading2, Heading3,
  List, ListOrdered, Quote,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Toolbar button ─────────────────────────────────────────────────────────────

interface BtnProps {
  onClick: () => void;
  active: boolean;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}

export function Btn({ onClick, active, title, disabled, children }: BtnProps) {
  return (
    <button
      type="button"
      // onMouseDown + preventDefault keeps editor focus when clicking toolbar buttons.
      // Deliberately not using the native `disabled` attribute — that suppresses
      // hover/title tooltips in some browsers, and these icons need to stay
      // hoverable (to show what they do) even when their action isn't available.
      onMouseDown={(e) => { e.preventDefault(); if (!disabled) onClick(); }}
      aria-disabled={disabled}
      title={title}
      className={cn(
        "p-1.5 rounded transition-colors",
        disabled
          ? "opacity-40 cursor-not-allowed"
          : active
            ? "bg-primary/20 text-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
      )}
    >
      {children}
    </button>
  );
}

export function Divider() {
  return <div className="w-px h-4 bg-border mx-0.5 shrink-0" />;
}

// ── Shared formatting buttons (used by both the bubble popup and the topbar) ──

interface ButtonsProps {
  editor: Editor;
}

export function FormattingButtons({ editor }: ButtonsProps) {
  return (
    <>
      {/* Inline marks */}
      <Btn
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold (Ctrl+B)"
      >
        <Bold className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic (Ctrl+I)"
      >
        <Italic className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
        title="Underline (Ctrl+U)"
      >
        <Underline className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="Strikethrough"
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </Btn>

      <Divider />

      {/* Block headings */}
      <Btn
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        <Heading1 className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        <Heading2 className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        <Heading3 className="h-3.5 w-3.5" />
      </Btn>

      <Divider />

      {/* Lists & blockquote */}
      <Btn
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet list"
      >
        <List className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Ordered list"
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Blockquote"
      >
        <Quote className="h-3.5 w-3.5" />
      </Btn>

      <Divider />

      {/* Text alignment */}
      <Btn
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
        active={editor.isActive({ textAlign: "left" })}
        title="Align left"
      >
        <AlignLeft className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
        active={editor.isActive({ textAlign: "center" })}
        title="Align center"
      >
        <AlignCenter className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
        active={editor.isActive({ textAlign: "right" })}
        title="Align right"
      >
        <AlignRight className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().setTextAlign("justify").run()}
        active={editor.isActive({ textAlign: "justify" })}
        title="Justify"
      >
        <AlignJustify className="h-3.5 w-3.5" />
      </Btn>
    </>
  );
}

// ── Bubble menu toolbar (mouse popup on text selection) ───────────────────────

interface Props {
  editor: Editor;
}

export function FormattingToolbar({ editor }: Props) {
  return (
    <BubbleMenu
      editor={editor}
      // Only show for genuine non-empty text selections.
      // isTextSelection filters out AllSelection (set by setContent on scene load)
      // and NodeSelection (custom nodes, images, etc.).
      shouldShow={({ editor, state }) => {
        const { selection } = state;
        return editor.isEditable && isTextSelection(selection) && !selection.empty;
      }}
      options={{ placement: "top" }}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-card shadow-xl px-1.5 py-1"
    >
      <FormattingButtons editor={editor} />
    </BubbleMenu>
  );
}
