"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { MessageSquare, Flag, Ban } from "lucide-react";
import { FormattingButtons, Divider, Btn } from "./FormattingToolbar";
import { SaveIndicator, StatusBar } from "./StatusBar";
import { SENSITIVITY_TYPES, type SensitivityType } from "./SensitivityExtension";
import { cn } from "@/lib/utils";

interface Props {
  editor: Editor;
  onAddComment?: () => void;
  sceneWordCount: number;
  t: (key: string) => string;
}

// Persistent formatting bar shown above the editor content — mirrors the
// mouse-selection popup (FormattingToolbar) but stays visible without a
// selection, and additionally carries the save status, the sensitivity
// "Mark" buttons and a quick comment button that were previously only
// reachable via the sandwich menu / selection popup.
export function EditorTopToolbar({ editor, onAddComment, sceneWordCount, t }: Props) {
  // Re-render on selection/content changes so isActive()/getAttributes() and
  // the selection-empty disabled state stay current — this bar isn't inside
  // a BubbleMenu, so nothing else forces a re-render on its own.
  const [, setTick] = useState(0);
  useEffect(() => {
    const rerender = () => setTick((n) => n + 1);
    editor.on("selectionUpdate", rerender);
    editor.on("transaction", rerender);
    return () => {
      editor.off("selectionUpdate", rerender);
      editor.off("transaction", rerender);
    };
  }, [editor]);

  const selectionEmpty = editor.state.selection.empty;
  const activeMark = editor.isActive("sensitivityFlag")
    ? (editor.getAttributes("sensitivityFlag").type as SensitivityType)
    : "";

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border bg-card overflow-x-auto">
      <SaveIndicator />

      <Divider />

      <FormattingButtons editor={editor} />

      <Divider />

      <Btn
        onClick={() => editor.chain().focus().unsetMark("sensitivityFlag").run()}
        active={false}
        disabled={selectionEmpty || !activeMark}
        title={`${t("toolbar_mark_label")}: ${t("common_none_option")}`}
      >
        <Ban className="h-3.5 w-3.5" />
      </Btn>
      {SENSITIVITY_TYPES.map((st) => (
        <Btn
          key={st.id}
          onClick={() => {
            if (activeMark === st.id) {
              editor.chain().focus().unsetMark("sensitivityFlag").run();
            } else {
              editor.chain().focus().setMark("sensitivityFlag", { type: st.id }).run();
            }
          }}
          active={activeMark === st.id}
          disabled={selectionEmpty}
          title={`${t("toolbar_mark_label")}: ${t(`scene_flag_${st.id}`)}`}
        >
          <Flag className={cn("h-3.5 w-3.5", st.color)} />
        </Btn>
      ))}

      {onAddComment && (
        <>
          <Divider />
          <Btn
            onClick={onAddComment}
            active={false}
            disabled={selectionEmpty}
            title={t("scene_add_comment_title")}
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </Btn>
        </>
      )}

      <div className="ml-auto pl-2">
        <StatusBar sceneWordCount={sceneWordCount} />
      </div>
    </div>
  );
}
