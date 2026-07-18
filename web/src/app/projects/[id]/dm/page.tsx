"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Dices, Send, Plus, Hand, Cpu, MapPin, Undo2, UserPlus, Minus, X, ListTree, BookCheck, Sparkles, AlertTriangle, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dmApi, codexApi, type DmRollRequest } from "@/lib/api";
import {
  useDmSessions, useCreateDmSession, useDmTurns, useDmRoll,
  useDmPrefs, useUpdateDmPrefs, useDmScene, useUndoDmEffects, useCodexEntries,
  useDmThreads, useEndDmSession, useDmStyle, useProject,
} from "@/store/queries";
import { useLanguage } from "@/contexts/LanguageContext";
import { CharacterWizard } from "@/components/dm/CharacterWizard";
import { SessionZeroWizard } from "@/components/dm/SessionZeroWizard";
import type { CodexEntry, DmTurn } from "@/types";

const DICE = [4, 6, 8, 10, 12, 20, 100];

// ── Transcript entries ────────────────────────────────────────────────────────

function EffectChips({
  turn, onUndo, undoPending,
}: { turn: DmTurn; onUndo: (turnId: number) => void; undoPending: boolean }) {
  const { t } = useLanguage();
  const fx = turn.effects;
  if (!fx?.applied || fx.undone) return null;
  const created = fx.applied.created_entries ?? [];
  const updated = fx.applied.updated_entries ?? [];
  const scene = fx.applied.scene;
  if (created.length === 0 && updated.length === 0 && !scene) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      {created.map((c) => (
        <span key={c.id} className="px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/30 text-[10px]">
          {t("dm_added_npc")}: {c.name}
        </span>
      ))}
      {updated.length > 0 && (
        <span className="px-2 py-0.5 rounded-full bg-secondary/70 text-[10px] text-muted-foreground">
          {t("dm_world_updated")} ({updated.length})
        </span>
      )}
      {scene && (
        <span className="px-2 py-0.5 rounded-full bg-secondary/70 text-[10px] text-muted-foreground">
          {t("dm_scene_changed")}
        </span>
      )}
      <button
        onClick={() => onUndo(turn.id)}
        disabled={undoPending}
        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive"
      >
        <Undo2 className="h-3 w-3" />
        {t("dm_undo")}
      </button>
    </div>
  );
}

function TurnItem({
  turn, onUndo, undoPending,
}: { turn: DmTurn; onUndo: (turnId: number) => void; undoPending: boolean }) {
  if (turn.role === "roll") {
    return (
      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary/60 text-xs text-muted-foreground">
          <Dices className="h-3 w-3" />
          {turn.content}
        </span>
      </div>
    );
  }
  if (turn.role === "player") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-primary/10 border border-primary/20 px-3 py-2 text-sm whitespace-pre-wrap">
          {turn.content}
        </div>
      </div>
    );
  }
  if (turn.role === "system") {
    return <p className="text-center text-xs text-muted-foreground italic">{turn.content}</p>;
  }
  return (
    <div className="max-w-[92%]">
      <div className="text-sm leading-relaxed whitespace-pre-wrap">{turn.content}</div>
      <EffectChips turn={turn} onUndo={onUndo} undoPending={undoPending} />
    </div>
  );
}

// ── Right rail: scene + party ─────────────────────────────────────────────────

function SceneCard({ projectId }: { projectId: number }) {
  const { t } = useLanguage();
  const { data: scene } = useDmScene(projectId);
  if (!scene) return null;
  return (
    <div className="rounded-lg border border-border p-2.5 space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        <MapPin className="h-3 w-3" />
        {t("dm_scene")}
      </p>
      <p className="text-xs font-medium">{scene.title}</p>
      {scene.situation && <p className="text-[11px] text-muted-foreground leading-snug">{scene.situation}</p>}
      {scene.present_npcs.length > 0 && (
        <p className="text-[10px] text-muted-foreground">{scene.present_npcs.join(" · ")}</p>
      )}
    </div>
  );
}

function PartyCard({ projectId }: { projectId: number }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const { data: entries = [] } = useCodexEntries(projectId);
  const party = entries.filter((e: CodexEntry) => e.rpg_sheet?.is_pc);

  const bumpHp = async (entry: CodexEntry, delta: number) => {
    const sheet = entry.rpg_sheet!;
    const current = Math.max(0, Math.min(sheet.hp.max, sheet.hp.current + delta));
    await codexApi.update(entry.id, { rpg_sheet: { ...sheet, hp: { ...sheet.hp, current } } });
    qc.invalidateQueries({ queryKey: ["codex", projectId] });
  };

  if (party.length === 0) return null;
  return (
    <div className="rounded-lg border border-border p-2.5 space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("dm_party")}</p>
      {party.map((entry: CodexEntry) => {
        const sheet = entry.rpg_sheet!;
        return (
          <div key={entry.id} className="space-y-0.5">
            <p className="text-xs font-medium truncate">{entry.name}</p>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-muted-foreground">{t("dm_hp")}</span>
              <button onClick={() => bumpHp(entry, -1)} className="text-muted-foreground hover:text-destructive">
                <Minus className="h-3 w-3" />
              </button>
              <span className={cn("tabular-nums font-medium", sheet.hp.current === 0 && "text-destructive")}>
                {sheet.hp.current}/{sheet.hp.max}
              </span>
              <button onClick={() => bumpHp(entry, 1)} className="text-muted-foreground hover:text-emerald-500">
                <Plus className="h-3 w-3" />
              </button>
              <span className="text-muted-foreground ml-1">{t("dm_ac")} {sheet.ac}</span>
            </div>
            {sheet.conditions.length > 0 && (
              <p className="text-[10px] text-amber-500">{sheet.conditions.join(", ")}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ThreadsCard({ projectId }: { projectId: number }) {
  const { t } = useLanguage();
  const { data: threads = [] } = useDmThreads(projectId);
  if (threads.length === 0) return null;
  return (
    <div className="rounded-lg border border-border p-2.5 space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        <ListTree className="h-3 w-3" />
        {t("dm_threads")}
      </p>
      <ul className="space-y-1">
        {threads.map((f) => (
          <li key={f.id} className="text-[11px] text-muted-foreground leading-snug">• {f.text}</li>
        ))}
      </ul>
    </div>
  );
}

// ── Dice tray ─────────────────────────────────────────────────────────────────

function DiceTray({
  diceMode, onModeChange, onRoll, disabled, requestedSides,
}: {
  diceMode: "digital" | "physical";
  onModeChange: (mode: "digital" | "physical") => void;
  onRoll: (req: DmRollRequest) => void;
  disabled: boolean;
  requestedSides: number | null;
}) {
  const { t } = useLanguage();
  const [modifier, setModifier] = useState(0);
  const [advantage, setAdvantage] = useState<"adv" | "dis" | null>(null);
  const [purpose, setPurpose] = useState("");
  const [manualFor, setManualFor] = useState<number | null>(null);
  const [manualA, setManualA] = useState("");
  const [manualB, setManualB] = useState("");

  const needsTwo = manualFor === 20 && advantage !== null;

  const buildRequest = (sides: number, manual_results?: number[]): DmRollRequest => ({
    sides,
    modifier,
    advantage: sides === 20 ? advantage : null,
    purpose: purpose.trim() || undefined,
    manual_results,
  });

  const clickDie = (sides: number) => {
    if (diceMode === "physical") {
      setManualFor(manualFor === sides ? null : sides);
      setManualA("");
      setManualB("");
      return;
    }
    onRoll(buildRequest(sides));
  };

  const confirmManual = () => {
    if (manualFor === null) return;
    const values = needsTwo ? [Number(manualA), Number(manualB)] : [Number(manualA)];
    if (values.some((v) => !Number.isInteger(v) || v < 1 || v > manualFor)) return;
    onRoll(buildRequest(manualFor, values));
    setManualFor(null);
    setManualA("");
    setManualB("");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("dm_dice_tray")}</span>
        {/* Digital ↔ physical table dice */}
        <div className="flex rounded-md border border-border overflow-hidden">
          {(["digital", "physical"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onModeChange(mode)}
              title={mode === "digital" ? t("dm_mode_digital") : t("dm_mode_physical")}
              className={cn(
                "px-2 py-1 text-[10px] flex items-center gap-1",
                diceMode === mode ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {mode === "digital" ? <Cpu className="h-3 w-3" /> : <Hand className="h-3 w-3" />}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {DICE.map((sides) => (
          <button
            key={sides}
            disabled={disabled}
            onClick={() => clickDie(sides)}
            className={cn(
              "rounded-md border py-1.5 text-xs font-medium transition-colors",
              manualFor === sides
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
              requestedSides === sides && "ring-1 ring-primary animate-pulse",
              disabled && "opacity-40 cursor-not-allowed"
            )}
          >
            d{sides}
          </button>
        ))}
      </div>

      {manualFor !== null && (
        <div className="space-y-1.5 rounded-md border border-primary/30 bg-primary/5 p-2">
          <p className="text-[11px] text-muted-foreground">{t("dm_enter_roll")} (d{manualFor})</p>
          <div className="flex gap-1.5">
            <Input
              type="number" min={1} max={manualFor} value={manualA}
              onChange={(e) => setManualA(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmManual()}
              className="h-7 text-xs" autoFocus
            />
            {needsTwo && (
              <Input
                type="number" min={1} max={manualFor} value={manualB}
                onChange={(e) => setManualB(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmManual()}
                className="h-7 text-xs"
              />
            )}
          </div>
          <Button size="sm" className="w-full h-7 text-xs" onClick={confirmManual}>
            {t("dm_confirm_roll")}
          </Button>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">{t("dm_modifier")}</label>
        <Input
          type="number" value={modifier}
          onChange={(e) => setModifier(Number(e.target.value) || 0)}
          className="h-7 text-xs"
        />
      </div>

      <div className="flex gap-1.5">
        <button
          onClick={() => setAdvantage(advantage === "adv" ? null : "adv")}
          className={cn(
            "flex-1 rounded-md border px-2 py-1 text-[10px]",
            advantage === "adv" ? "border-emerald-500/60 bg-emerald-500/10 text-foreground" : "border-border text-muted-foreground"
          )}
        >
          {t("dm_advantage")}
        </button>
        <button
          onClick={() => setAdvantage(advantage === "dis" ? null : "dis")}
          className={cn(
            "flex-1 rounded-md border px-2 py-1 text-[10px]",
            advantage === "dis" ? "border-red-500/60 bg-red-500/10 text-foreground" : "border-border text-muted-foreground"
          )}
        >
          {t("dm_disadvantage")}
        </button>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">{t("dm_roll_purpose")}</label>
        <Input
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          className="h-7 text-xs"
        />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DmPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const { t } = useLanguage();
  const qc = useQueryClient();

  const sessionsQuery = useDmSessions(projectId);
  const createSession = useCreateDmSession(projectId);
  const sessions = sessionsQuery.data ?? [];
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const activeSession =
    sessions.find((s) => s.id === selectedSessionId) ?? sessions[sessions.length - 1];

  // First visit: create Session 1 automatically
  const bootRef = useRef(false);
  useEffect(() => {
    if (sessionsQuery.isSuccess && sessions.length === 0 && !bootRef.current) {
      bootRef.current = true;
      createSession.mutate(undefined);
    }
  }, [sessionsQuery.isSuccess, sessions.length, createSession]);

  const turnsQuery = useDmTurns(activeSession?.id);
  const turns = turnsQuery.data ?? [];
  const rollMutation = useDmRoll(activeSession?.id);
  const undoMutation = useUndoDmEffects(projectId, activeSession?.id);
  const endMutation = useEndDmSession(projectId);
  const sessionEnded = activeSession?.status === "ended";

  const prefsQuery = useDmPrefs(projectId);
  const updatePrefs = useUpdateDmPrefs(projectId);
  const diceMode = prefsQuery.data?.dice_mode ?? "digital";

  const [input, setInput] = useState("");
  const [pendingPlayer, setPendingPlayer] = useState<string | null>(null);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractFailed, setExtractFailed] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [sessionZeroOpen, setSessionZeroOpen] = useState(false);
  const [clicheHits, setClicheHits] = useState<string[]>([]);
  const [dismissedGates, setDismissedGates] = useState<number[]>([]);
  const streaming = streamText !== null;
  const { data: style } = useDmStyle();
  const { data: project } = useProject(projectId);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, streamText, pendingPlayer]);

  // Roll gate: last DM turn requested a roll and no roll has been made since
  const rollGate = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (turn.role === "roll") return null;
      if (turn.role === "dm") {
        const fx = turn.effects;
        const request = fx && !fx.undone ? fx.effects?.roll_request : null;
        if (request && !dismissedGates.includes(turn.id)) return { turnId: turn.id, ...request };
        return null;
      }
    }
    return null;
  }, [turns, dismissedGates]);

  const lastTurn = turns[turns.length - 1];
  const canSend =
    !streaming && !extracting && !!activeSession && !sessionEnded && !rollGate &&
    (input.trim() !== "" || lastTurn?.role === "roll");

  const runExtraction = async (sessionId: number) => {
    setExtracting(true);
    setExtractFailed(false);
    try {
      const fresh = await dmApi.turns(sessionId);
      const lastDm = [...fresh].reverse().find((turn) => turn.role === "dm");
      if (lastDm && !lastDm.effects) {
        await dmApi.extractEffects(lastDm.id);
        qc.invalidateQueries({ queryKey: ["dm-turns", sessionId] });
        qc.invalidateQueries({ queryKey: ["dm-scene", projectId] });
        qc.invalidateQueries({ queryKey: ["codex", projectId] });
        // Memory consolidation (L1) — fire and forget, threshold-gated server-side
        dmApi.consolidate(sessionId)
          .then((res) => {
            if (res.extracted > 0) qc.invalidateQueries({ queryKey: ["dm-facts", projectId] });
          })
          .catch(() => {});
      }
    } catch {
      setExtractFailed(true);
    } finally {
      setExtracting(false);
    }
  };

  const doAction = async (text: string) => {
    if (!activeSession) return;
    setPendingPlayer(text || null);
    setStreamText("");
    setError(null);
    setClicheHits([]);

    let streamed = false;
    let acc = "";
    try {
      const res = await dmApi.actionStream(activeSession.id, text);
      if (!res.ok) throw new Error(await res.text());
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            if (json.error) throw new Error(typeof json.error === "string" ? json.error : JSON.stringify(json.error));
            const delta = json.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              acc += delta;
              setStreamText(acc);
            }
          } catch (inner) {
            if (inner instanceof SyntaxError) continue; // partial JSON line
            throw inner;
          }
        }
      }
      streamed = acc.length > 0;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      await qc.invalidateQueries({ queryKey: ["dm-turns", activeSession.id] });
      setPendingPlayer(null);
      setStreamText(null);
    }
    if (streamed) {
      const lower = acc.toLowerCase();
      setClicheHits((style?.ban_list ?? []).filter((b) => lower.includes(b.toLowerCase())));
      await runExtraction(activeSession.id);
    }
  };

  const send = () => {
    if (!canSend) return;
    const text = input.trim();
    setInput("");
    doAction(text);
  };

  const rerollNarration = async () => {
    if (!activeSession || streaming) return;
    const lastDm = [...turns].reverse().find((turn) => turn.role === "dm");
    if (!lastDm) return;
    setClicheHits([]);
    try {
      if (lastDm.effects?.applied && !lastDm.effects.undone) {
        await dmApi.undoEffects(lastDm.id);
      }
      await dmApi.deleteTurn(lastDm.id);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\d+: /, "") : String(e));
      return;
    }
    await qc.invalidateQueries({ queryKey: ["dm-turns", activeSession.id] });
    qc.invalidateQueries({ queryKey: ["dm-scene", projectId] });
    qc.invalidateQueries({ queryKey: ["codex", projectId] });
    doAction("");
  };

  return (
    <div className="h-full flex">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <Dices className="h-4 w-4 text-primary" />
          <h1 className="text-sm font-semibold">{t("dm_placeholder_title")}</h1>
          <button
            onClick={() => setWizardOpen(true)}
            title={t("dm_create_character")}
            className="text-muted-foreground hover:text-foreground"
          >
            <UserPlus className="h-4 w-4" />
          </button>
          <button
            onClick={() => setSessionZeroOpen(true)}
            title={t("dm_session_zero")}
            className="text-muted-foreground hover:text-foreground"
          >
            <Sparkles className="h-4 w-4" />
          </button>
          {sessions.length > 0 && (
            <select
              value={activeSession?.id ?? ""}
              onChange={(e) => setSelectedSessionId(Number(e.target.value))}
              className="ml-auto h-7 rounded-md border border-input bg-background px-2 text-xs"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          )}
          <Button
            variant="outline" size="sm" className="h-7 text-xs"
            onClick={() => createSession.mutate(undefined, { onSuccess: (s) => setSelectedSessionId(s.id) })}
            disabled={streaming}
          >
            <Plus className="h-3 w-3" />
            {t("dm_new_session")}
          </Button>
          {activeSession && !sessionEnded && turns.length > 0 && (
            <Button
              variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => {
                if (confirm(`${t("dm_end_session")}?`)) endMutation.mutate(activeSession.id);
              }}
              disabled={streaming || endMutation.isPending}
            >
              <BookCheck className="h-3 w-3" />
              {t("dm_end_session")}
            </Button>
          )}
        </header>

        {/* Transcript */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
          {turns.length === 0 && !streaming && (
            <div className="text-center max-w-md mx-auto pt-12 space-y-3">
              <p className="text-sm text-muted-foreground">{t("dm_no_turns")}</p>
              {!project?.campaign_brief && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setSessionZeroOpen(true)}>
                    <Sparkles className="h-3.5 w-3.5" />
                    {t("dm_session_zero")}
                  </Button>
                  <p className="text-xs text-muted-foreground/70">{t("dm_setup_cta")}</p>
                </>
              )}
            </div>
          )}
          {turns.map((turn) => (
            <TurnItem
              key={turn.id}
              turn={turn}
              onUndo={(turnId) => undoMutation.mutate(turnId)}
              undoPending={undoMutation.isPending}
            />
          ))}
          {pendingPlayer && (
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-lg bg-primary/10 border border-primary/20 px-3 py-2 text-sm whitespace-pre-wrap">
                {pendingPlayer}
              </div>
            </div>
          )}
          {streaming && (
            streamText ? (
              <div className="max-w-[92%] text-sm leading-relaxed whitespace-pre-wrap">{streamText}</div>
            ) : (
              <p className="text-xs text-muted-foreground animate-pulse">{t("dm_narrating")}</p>
            )
          )}
          {extracting && <p className="text-xs text-muted-foreground animate-pulse">{t("dm_updating_world")}</p>}
          {extractFailed && <p className="text-xs text-amber-500">{t("dm_extract_failed")}</p>}
          {error && <p className="text-xs text-destructive whitespace-pre-wrap">{error}</p>}
          <div ref={bottomRef} />
        </div>

        {/* Cliché banner */}
        {clicheHits.length > 0 && !streaming && (
          <div className="mx-3 mb-1 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <p className="flex-1 text-xs">
              <span className="font-medium">{t("dm_cliche_found")}:</span>{" "}
              {clicheHits.map((hit) => `"${hit}"`).join(", ")}
            </p>
            <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={rerollNarration}>
              <RefreshCw className="h-3 w-3" />
              {t("dm_reroll_narration")}
            </Button>
            <button
              onClick={() => setClicheHits([])}
              className="text-muted-foreground hover:text-foreground"
              title={t("common_cancel")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Roll-request banner */}
        {rollGate && (
          <div className="mx-3 mb-1 flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
            <Dices className="h-4 w-4 text-primary shrink-0 animate-pulse" />
            <p className="flex-1 text-xs">
              <span className="font-medium">{t("dm_roll_needed")}</span>{" "}
              d{rollGate.sides} — {rollGate.purpose}
            </p>
            <button
              onClick={() => setDismissedGates((prev) => [...prev, rollGate.turnId])}
              className="text-muted-foreground hover:text-foreground"
              title={t("common_cancel")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Ended-session summary */}
        {sessionEnded && (
          <div className="border-t border-border p-3">
            <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <BookCheck className="h-3 w-3" />
                {t("dm_session_ended")}{activeSession?.summary ? ` — ${t("dm_summary")}` : ""}
              </p>
              {activeSession?.summary && (
                <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{activeSession.summary}</p>
              )}
            </div>
          </div>
        )}

        {/* Input */}
        {!sessionEnded && (
        <div className="border-t border-border p-3 flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={rollGate ? `${t("dm_roll_needed")} d${rollGate.sides}` : t("dm_input_placeholder")}
            rows={2}
            className="flex-1 resize-none text-sm"
            disabled={streaming || !!rollGate}
          />
          <Button onClick={send} disabled={!canSend} size="sm" className="h-9" title={t("dm_send")}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        )}
      </div>

      {/* Right rail */}
      <aside className="w-60 shrink-0 border-l border-border flex flex-col p-3 gap-3 overflow-y-auto">
        <SceneCard projectId={projectId} />
        <PartyCard projectId={projectId} />
        <ThreadsCard projectId={projectId} />
        <DiceTray
          diceMode={diceMode}
          onModeChange={(mode) => updatePrefs.mutate({ dice_mode: mode })}
          onRoll={(req) => rollMutation.mutate(req)}
          disabled={!activeSession || streaming || sessionEnded}
          requestedSides={rollGate?.sides ?? null}
        />
      </aside>

      <CharacterWizard projectId={projectId} open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <SessionZeroWizard projectId={projectId} open={sessionZeroOpen} onClose={() => setSessionZeroOpen(false)} />
    </div>
  );
}
