"use client";

import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { Sparkles, X, RefreshCw, BookPlus } from "lucide-react";
import { useState } from "react";
import { useEditorContext } from "@/contexts/EditorContext";
import { useSettings, usePrompts, useProjectScenes } from "@/store/queries";
import { useLanguage } from "@/contexts/LanguageContext";
import { kiApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { CodexEntry } from "@/types";

// ── NodeView ──────────────────────────────────────────────────────────────────

const ACCENT = "#f472b6";

/** Strip markdown code fences and grab the first JSON object in the text. */
function extractJSON(text: string): string {
  // Remove ```json ... ``` or ``` ... ``` wrappers
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Try to grab first {...} block in case of leading/trailing prose
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) return brace[0].trim();
  return text.trim();
}

function KiNodeView({ node, updateAttributes, deleteNode, getPos, editor }: any) {
  const { allEntries, sceneId, projectId, onPrefillEntry } = useEditorContext();
  const { data: settings } = useSettings();
  const { data: prompts = [] } = usePrompts();
  const { data: projectScenes = [] } = useProjectScenes(projectId);
  const { t } = useLanguage();

  const [generating, setGenerating]       = useState(false);
  const [result, setResult]               = useState<string | null>(null);
  const [entryJson, setEntryJson]         = useState<Partial<CodexEntry> | null>(null);
  const [createEntryMode, setCreateEntryMode] = useState(false);
  const [updateEntryId, setUpdateEntryId] = useState<number | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [entryType, setEntryType]         = useState("character");

  const { model, codexIds: codexIdsStr, sceneIds: sceneIdsStr, prompt, promptId, wordCount: wordCountAttr } = node.attrs as {
    model: string; codexIds: string; sceneIds: string; prompt: string; promptId: string; wordCount: string;
  };

  // Enabled models from settings; fall back to just the default if none pinned
  const enabledModels: string[] = settings?.enabled_models?.length
    ? settings.enabled_models
    : settings?.default_model ? [settings.default_model] : [];

  // Parse comma-separated stored IDs
  const codexIds: number[]      = codexIdsStr ? codexIdsStr.split(",").map(Number).filter(Boolean) : [];
  const extraSceneIds: number[] = sceneIdsStr  ? sceneIdsStr.split(",").map(Number).filter(Boolean) : [];

  const selectedPrompt = prompts.find(p => String(p.id) === promptId) ?? null;
  const isCodexDistill = selectedPrompt?.built_in_key === "codex_distill";
  const jsonMode = isCodexDistill && (createEntryMode || updateEntryId !== null);

  // The effective model: use stored attr, then distill-specific default, then global default
  const effectiveModel = model || (isCodexDistill ? settings?.default_codex_model : null) || settings?.default_model || "";

  // Word count: node attribute overrides prompt default; fall back to prompt's value or 400
  const promptWordCount = selectedPrompt?.word_count ?? 400;
  const nodeWordCount   = wordCountAttr ? Number(wordCountAttr) : null;
  const displayWordCount = nodeWordCount ?? promptWordCount;

  const selectedEntries  = allEntries.filter(e => codexIds.includes(e.id));
  const availableEntries = allEntries.filter(e => !codexIds.includes(e.id));

  const addEntry = (id: number) =>
    updateAttributes({ codexIds: [...codexIds, id].join(",") });
  const removeEntry = (id: number) => {
    updateAttributes({ codexIds: codexIds.filter(i => i !== id).join(",") });
    if (updateEntryId === id) setUpdateEntryId(null);
  };

  const handleGenerate = async () => {
    if (!effectiveModel || !sceneId) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    setEntryJson(null);

    const collectingJson = jsonMode;

    try {
      const res = await kiApi.stream({
        scene_id: sceneId,
        model: effectiveModel,
        codex_ids: codexIds,
        extra_scene_ids: extraSceneIds,
        prompt: prompt || "",
        prompt_id: promptId ? Number(promptId) : null,
        entry_type: isCodexDistill ? entryType : undefined,
        word_count: !jsonMode ? nodeWordCount : null,
        create_entry: isCodexDistill && createEntryMode && updateEntryId === null,
        update_entry_id: updateEntryId ?? undefined,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);
          if (raw === "[DONE]") continue;
          try {
            const parsed = JSON.parse(raw);
            if (parsed.error) throw new Error(typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error));
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
              if (!collectingJson) setResult(accumulated);
            }
          } catch (e: any) {
            if (e.message && !e.message.startsWith("JSON")) throw e;
          }
        }
      }

      // Stream complete — finalise result
      if (collectingJson) {
        try {
          const raw = extractJSON(accumulated);
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && parsed.name) {
            setEntryJson(
              updateEntryId !== null
                ? { ...(parsed as Partial<CodexEntry>), id: updateEntryId }
                : (parsed as Partial<CodexEntry>)
            );
          } else {
            setResult(accumulated);
          }
        } catch {
          setResult(accumulated);
        }
      }
    } catch (e: any) {
      setError(e.message ?? t("common_generation_failed"));
    } finally {
      setGenerating(false);
    }
  };

  const handleInsert = () => {
    if (!result || !editor) return;
    const pos = getPos();
    // Split plain text into paragraphs
    const paragraphs = result.split(/\n\n+/).filter(Boolean).map(text => ({
      type: "paragraph" as const,
      content: text.trim() ? [{ type: "text" as const, text: text.trim() }] : [],
    }));
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .insertContentAt(pos, paragraphs)
      .run();
  };

  const handleOpenInCodex = () => {
    if (!entryJson || !onPrefillEntry) return;
    onPrefillEntry(entryJson);
    setEntryJson(null);
  };

  return (
    <NodeViewWrapper as="div">
      <div
        className="my-3 rounded-lg border-l-[3px] px-4 py-3 space-y-3"
        style={{ borderColor: ACCENT, background: `${ACCENT}10` }}
        contentEditable={false}
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0" style={{ color: ACCENT }} />
          <span className="text-[11px] font-semibold uppercase tracking-wide flex-1" style={{ color: ACCENT }}>
            {t("cmd_ki_label")}
          </span>
          <button type="button" onClick={deleteNode} className="text-muted-foreground hover:text-destructive">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Prompt selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-14 shrink-0">{t("ki_prompt_selector_label")}</span>
          <select
            value={promptId}
            onChange={e => { updateAttributes({ promptId: e.target.value }); setCreateEntryMode(false); setUpdateEntryId(null); setResult(null); setEntryJson(null); }}
            onMouseDown={e => e.stopPropagation()}
            className="bg-background text-xs rounded border border-border px-1.5 py-1 outline-none flex-1 max-w-xs"
          >
            <option value="">{t("ki_none_legacy")}</option>
            {prompts.map(p => (
              <option key={p.id} value={String(p.id)}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Entry type selector (only for Codex Entry Distillation, create mode) */}
        {isCodexDistill && (
          <div className="flex items-center gap-2 flex-wrap">
            {updateEntryId === null && (
              <>
                <span className="text-xs text-muted-foreground w-14 shrink-0">{t("entry_type")}</span>
                <select
                  value={entryType}
                  onChange={e => setEntryType(e.target.value)}
                  onMouseDown={e => e.stopPropagation()}
                  className="bg-background text-xs rounded border border-border px-1.5 py-1 outline-none"
                >
                  <option value="character">{t("type_character")}</option>
                  <option value="location">{t("type_location")}</option>
                  <option value="item">{t("type_item")}</option>
                  <option value="lore">{t("type_lore")}</option>
                </select>
              </>
            )}

            {/* Create entry toggle */}
            <label
              className="flex items-center gap-1.5 ml-2 cursor-pointer select-none"
              onMouseDown={e => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={createEntryMode}
                onChange={e => {
                  setCreateEntryMode(e.target.checked);
                  if (e.target.checked) setUpdateEntryId(null);
                  setResult(null); setEntryJson(null);
                }}
                className="accent-primary w-3.5 h-3.5"
              />
              <span className="text-xs text-muted-foreground">{t("ki_create_entry_label")}</span>
            </label>

            {/* Update entry toggle — requires a codex entry already selected below */}
            <label
              className={cn(
                "flex items-center gap-1.5 select-none",
                selectedEntries.length > 0 ? "cursor-pointer" : "cursor-not-allowed opacity-40"
              )}
              onMouseDown={e => e.stopPropagation()}
              title={selectedEntries.length === 0 ? t("ki_update_entry_disabled_hint") : undefined}
            >
              <input
                type="checkbox"
                checked={updateEntryId !== null}
                disabled={selectedEntries.length === 0}
                onChange={e => {
                  if (e.target.checked) {
                    setUpdateEntryId(selectedEntries[0].id);
                    setCreateEntryMode(false);
                  } else {
                    setUpdateEntryId(null);
                  }
                  setResult(null); setEntryJson(null);
                }}
                className="accent-primary w-3.5 h-3.5"
              />
              <span className="text-xs text-muted-foreground">{t("ki_update_entry_label")}</span>
            </label>

            {updateEntryId !== null && (
              <select
                value={updateEntryId}
                onChange={e => setUpdateEntryId(Number(e.target.value))}
                onMouseDown={e => e.stopPropagation()}
                className="bg-background text-xs rounded border border-border px-1.5 py-1 outline-none"
              >
                {selectedEntries.map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Word count — hidden in create/update-entry mode */}
        {!jsonMode && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-14 shrink-0">{t("ki_words_label")}</span>
            <input
              type="number"
              min={50}
              max={10000}
              step={50}
              value={displayWordCount}
              onChange={e => updateAttributes({ wordCount: e.target.value })}
              onKeyDown={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              className="bg-background text-xs rounded border border-border px-1.5 py-1 outline-none w-16 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            {[600, 800, 1000].map(n => (
              <button
                key={n}
                type="button"
                onMouseDown={e => e.stopPropagation()}
                onClick={() => updateAttributes({ wordCount: String(n) })}
                className={cn(
                  "text-[11px] px-1.5 py-0.5 rounded border transition-colors",
                  displayWordCount === n
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                )}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        {/* Model selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-14 shrink-0">{t("ki_model_label")}</span>
          {enabledModels.length === 0 ? (
            <span className="text-xs text-muted-foreground italic">
              {t("ki_no_models_enabled")}
            </span>
          ) : (
            <select
              value={effectiveModel}
              onChange={e => updateAttributes({ model: e.target.value })}
              onMouseDown={e => e.stopPropagation()}
              className="bg-background text-xs rounded border border-border px-1.5 py-1 outline-none flex-1 max-w-xs"
            >
              {enabledModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </div>

        {/* Context — scenes */}
        <div className="flex items-start gap-2">
          <span className="text-xs text-muted-foreground w-14 shrink-0 pt-0.5">{t("ki_scenes_label")}</span>
          <div className="flex flex-wrap gap-1 flex-1">
            <span className="text-[11px] bg-secondary px-2 py-0.5 rounded flex items-center gap-1">
              {t("ki_current_scene")}
              <span className="text-muted-foreground/50 text-[10px]">{t("ki_auto_tag")}</span>
            </span>
            {extraSceneIds.map(id => {
              const sc = projectScenes.find(s => s.id === id);
              return (
                <span key={id} className="text-[11px] bg-secondary px-2 py-0.5 rounded flex items-center gap-1">
                  {sc ? sc.title : `Scene #${id}`}
                  <button
                    type="button"
                    onClick={() => updateAttributes({ sceneIds: extraSceneIds.filter(i => i !== id).join(",") })}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            })}
            {projectScenes.filter(s => s.id !== sceneId && !extraSceneIds.includes(s.id)).length > 0 && (
              <select
                value=""
                onChange={e => { if (e.target.value) updateAttributes({ sceneIds: [...extraSceneIds, Number(e.target.value)].join(",") }); }}
                onMouseDown={e => e.stopPropagation()}
                className="text-[11px] bg-background border border-border rounded px-1.5 py-0.5 outline-none text-muted-foreground"
              >
                <option value="">{t("ki_add_scene_option")}</option>
                {projectScenes
                  .filter(s => s.id !== sceneId && !extraSceneIds.includes(s.id))
                  .map(s => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
              </select>
            )}
          </div>
        </div>

        {/* Context — codex entries */}
        <div className="flex items-start gap-2">
          <span className="text-xs text-muted-foreground w-14 shrink-0 pt-0.5">{t("corkboard_codex")}</span>
          <div className="flex flex-wrap gap-1 flex-1">
            {selectedEntries.map(e => (
              <span
                key={e.id}
                className="text-[11px] bg-secondary px-2 py-0.5 rounded flex items-center gap-1"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
                {e.name}
                <button type="button" onClick={() => removeEntry(e.id)}>
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            {availableEntries.length > 0 && (
              <select
                value=""
                onChange={e => { if (e.target.value) addEntry(Number(e.target.value)); }}
                onMouseDown={e => e.stopPropagation()}
                className="text-[11px] bg-background border border-border rounded px-1.5 py-0.5 outline-none text-muted-foreground"
              >
                <option value="">{t("ki_add_entry_option")}</option>
                {availableEntries.map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            )}
            {allEntries.length === 0 && (
              <span className="text-[11px] text-muted-foreground italic">{t("ki_no_codex_entries")}</span>
            )}
          </div>
        </div>

        {/* Prompt / author notes */}
        <div className="flex items-start gap-2">
          <span className="text-xs text-muted-foreground w-14 shrink-0 pt-1.5">
            {jsonMode ? t("ki_notes_field_label") : t("ki_prompt_selector_label")}
          </span>
          <textarea
            value={prompt}
            onChange={e => updateAttributes({ prompt: e.target.value })}
            onKeyDown={e => e.stopPropagation()}
            placeholder={
              jsonMode
                ? t("ki_notes_placeholder")
                : t("ki_prompt_placeholder")
            }
            rows={2}
            className="flex-1 bg-background text-xs rounded border border-border px-2 py-1.5 outline-none resize-none"
          />
        </div>

        {/* ── Result: text mode ── */}
        {result && !entryJson && (
          <div className="rounded border border-border/60 bg-background/60 px-3 py-2 text-xs text-foreground/90 whitespace-pre-wrap max-h-56 overflow-y-auto leading-relaxed">
            {result}
          </div>
        )}

        {/* ── Result: entry JSON preview ── */}
        {entryJson && (
          <div className="rounded border border-border/60 bg-background/60 px-3 py-2.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <BookPlus className="h-3.5 w-3.5 shrink-0" style={{ color: ACCENT }} />
              <span className="text-xs font-semibold" style={{ color: ACCENT }}>
                {entryJson.id ? t("ki_entry_updated") : t("ki_entry_extracted")}
              </span>
            </div>
            <div className="text-xs space-y-0.5">
              <div>
                <span className="text-muted-foreground">{t("ki_result_name_label")} </span>
                <span className="font-medium">{entryJson.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("ki_result_type_label")} </span>
                <span className="capitalize">{entryJson.entry_type ?? entryType}</span>
                {(entryJson.species || (entryJson as any).subtype) && (
                  <span className="text-muted-foreground">
                    {" "}· {entryJson.species ?? (entryJson as any).subtype}
                  </span>
                )}
              </div>
              {entryJson.description && (
                <div className="text-muted-foreground/80 line-clamp-3 whitespace-pre-wrap leading-relaxed pt-0.5">
                  {entryJson.description.slice(0, 200)}{entryJson.description.length > 200 ? "…" : ""}
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}

        {/* Action row */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={!effectiveModel || !sceneId || generating}
            onClick={handleGenerate}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-medium transition-opacity disabled:opacity-40"
            style={{ background: `${ACCENT}25`, color: ACCENT }}
          >
            {generating
              ? <><RefreshCw className="h-3 w-3 animate-spin" /> {jsonMode ? (updateEntryId !== null ? t("ki_updating") : t("ki_extracting")) : t("ki_generating")}</>
              : <><Sparkles className="h-3 w-3" /> {jsonMode ? (updateEntryId !== null ? t("ki_update_entry_label") : t("ki_extract_entry_btn")) : t("ki_generate_btn")}</>
            }
          </button>

          {/* Text result actions */}
          {result && !entryJson && (
            <>
              <button
                type="button"
                onClick={handleInsert}
                className="text-xs px-3 py-1.5 rounded font-medium bg-primary text-primary-foreground"
              >
                {t("ki_insert_replace")}
              </button>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {t("ki_discard")}
              </button>
            </>
          )}

          {/* Entry JSON actions */}
          {entryJson && (
            <>
              <button
                type="button"
                onClick={handleOpenInCodex}
                disabled={!onPrefillEntry}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-medium bg-primary text-primary-foreground disabled:opacity-40"
              >
                <BookPlus className="h-3 w-3" />
                {t("corkboard_open_in_codex")}
              </button>
              <button
                type="button"
                onClick={() => setEntryJson(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {t("ki_discard")}
              </button>
            </>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

// ── Node definition ───────────────────────────────────────────────────────────

export const KiNode = Node.create({
  name: "ki",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      model:      { default: "", parseHTML: el => el.getAttribute("data-model")      ?? "" },
      codexIds:   { default: "", parseHTML: el => el.getAttribute("data-codex-ids")  ?? "" },
      sceneIds:   { default: "", parseHTML: el => el.getAttribute("data-scene-ids")  ?? "" },
      prompt:     { default: "", parseHTML: el => el.getAttribute("data-prompt")     ?? "" },
      promptId:   { default: "", parseHTML: el => el.getAttribute("data-prompt-id")  ?? "" },
      wordCount:  { default: "", parseHTML: el => el.getAttribute("data-word-count") ?? "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="ki"]', priority: 100 }];
  },

  renderHTML({ node }) {
    return ["div", {
      "data-type":       "ki",
      "data-model":      node.attrs.model,
      "data-codex-ids":  node.attrs.codexIds,
      "data-scene-ids":  node.attrs.sceneIds,
      "data-prompt":     node.attrs.prompt,
      "data-prompt-id":  node.attrs.promptId,
      "data-word-count": node.attrs.wordCount,
    }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(KiNodeView);
  },
});
