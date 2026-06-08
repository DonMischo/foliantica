"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Key, Cpu, Globe, Loader2, RefreshCw, Sparkles, Plus, Trash2, RotateCcw, HelpCircle, Palette, FolderOpen, RotateCw, Hash, AlignCenter, Timer, Container, CheckCircle2, XCircle, AlertCircle, Play, ExternalLink, X, Trophy, Database, Users, Copy, Link2, ShieldCheck, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings, useUpdateSettings, useOpenRouterModels, usePrompts, useCreatePrompt, useUpdatePrompt, useDeletePrompt, useRevertPrompt, useServiceStatus, useSyncStatus } from "@/store/queries";
import { dataDirApi, settingsApi, syncApi, pgConfigApi, collabApi, type PgConfig, type PgActive, type Invitation, type TeacherSession, type UPnPStatus, type CloudflareStatus } from "@/lib/api";
import { AssignmentPicker } from "@/components/collab/AssignmentPicker";
import { ACH_POPUPS_KEY } from "@/components/AchievementToast";
import { useLanguage } from "@/contexts/LanguageContext";
import { useUIStore } from "@/store/ui";
import { useTheme, THEMES, THEME_LABELS, THEME_PREVIEW } from "@/contexts/ThemeContext";
import { LOCALE_NAMES, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AIPrompt } from "@/types";

const GRAMMAR_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "ru", label: "Russian" },
  { code: "ca", label: "Catalan" },
  { code: "sv", label: "Swedish" },
  { code: "da", label: "Danish" },
  { code: "nb", label: "Norwegian" },
  { code: "cs", label: "Czech" },
  { code: "uk", label: "Ukrainian" },
];

const PLACEHOLDER_HELP = [
  { token: "{{SCENE_CONTENT}}", desc: "Full text of the current scene" },
  { token: "{{SCENE_TITLE}}", desc: "Title of the current scene" },
  { token: "{{CODEX_ENTRIES}}", desc: "Selected codex entries (name, type, description)" },
  { token: "{{USER_PROMPT}}", desc: "The instruction entered in the /ki command" },
  { token: "{{USER_NOTES}}", desc: "Same as USER_PROMPT (alias for codex distill context)" },
  { token: "{{EXTRA_SCENES}}", desc: "Content of additionally selected scenes" },
  { token: "{{ENTRY_TYPE}}", desc: "For codex distillation: character/location/item/lore" },
  { token: "{{LANGUAGE}}", desc: "Project language from Project Info (e.g. English, German)" },
  { token: "{{WORD_COUNT}}", desc: "Target word count configured on this prompt (default 400)" },
];

function ServiceStatusBadge({ label, status }: { label: string; status: "ok" | "error" | "offline" }) {
  const icon = status === "ok"
    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    : status === "error"
    ? <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />
    : <XCircle className="h-3.5 w-3.5 text-destructive" />;
  const text = status === "ok" ? "Running" : status === "error" ? "Error" : "Offline";
  const color = status === "ok" ? "text-green-600 dark:text-green-400" : status === "error" ? "text-yellow-600 dark:text-yellow-400" : "text-destructive";
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="font-medium">{label}</span>
      <span className={color}>— {text}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const { data: availableModels = [], isLoading: modelsLoading, refetch: refetchModels } = useOpenRouterModels();
  const { t, locale, setLocale } = useLanguage();
  const { theme, setTheme } = useTheme();
  const showParagraphNumbers    = useUIStore((s) => s.showParagraphNumbers);
  const setShowParagraphNumbers = useUIStore((s) => s.setShowParagraphNumbers);
  const typewriterOffset        = useUIStore((s) => s.typewriterOffset);
  const setTypewriterOffset     = useUIStore((s) => s.setTypewriterOffset);
  const sessionTimerEnabled     = useUIStore((s) => s.sessionTimerEnabled);
  const setSessionTimerEnabled  = useUIStore((s) => s.setSessionTimerEnabled);
  const [achPopupsEnabled, setAchPopupsEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(ACH_POPUPS_KEY) !== "false";
  });
  const [aiDisabled, setAiDisabled] = useState(false);

  // ── Sync mirror ───────────────────────────────────────────────────────────
  const { data: syncStatus } = useSyncStatus();
  const [syncEnabled, setSyncEnabled]     = useState(false);
  const [syncLocalDir, setSyncLocalDir]   = useState("");
  const [syncSaving, setSyncSaving]       = useState(false);

  const { data: prompts = [] } = usePrompts();
  const createPrompt  = useCreatePrompt();
  const updatePrompt  = useUpdatePrompt();
  const deletePrompt  = useDeletePrompt();
  const revertPrompt  = useRevertPrompt();

  const [apiKey, setApiKey]               = useState("");
  const [apiKeyDirty, setApiKeyDirty]     = useState(false);
  const [defaultModel, setDefaultModel]                   = useState("anthropic/claude-3.5-sonnet");
  const [defaultChatModel, setDefaultChatModel]           = useState<string>("");
  const [defaultSynopsisModel, setDefaultSynopsisModel]   = useState<string>("");
  const [defaultCodexModel, setDefaultCodexModel]         = useState<string>("");
  const [enabledModels, setEnabledModels]       = useState<string[]>([]);
  const [modelSearch, setModelSearch]     = useState("");
  const [saved, setSaved]                 = useState(false);

  // ── Services ──────────────────────────────────────────────────────────────
  const [grammarEnabled, setGrammarEnabled]   = useState(false);
  const [grammarUrl, setGrammarUrl]           = useState("http://localhost:8081");
  const [grammarLanguages, setGrammarLanguages] = useState<string[]>(["en"]);
  const [pandocEnabled, setPandocEnabled]     = useState(false);
  const [pandocUrl, setPandocUrl]           = useState("http://localhost:8082");
  const [showServiceStatus, setShowServiceStatus] = useState(false);
  const { data: serviceStatus, isLoading: statusLoading, refetch: refetchStatus } =
    useServiceStatus(showServiceStatus);
  const [dockerUpState, setDockerUpState] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [dockerUpMsg, setDockerUpMsg]     = useState("");
  const [dockerUpStep, setDockerUpStep]   = useState("");
  const [helpOpen, setHelpOpen]           = useState(false);

  // ── Docker PostgreSQL ─────────────────────────────────────────────────────
  const defaultPgCfg: PgConfig = { useDocker: false, host: "127.0.0.1", port: 5434, user: "foliantica", pass: "foliantica", db: "foliantica" };
  const [pgCfg,    setPgCfg]    = useState<PgConfig>(defaultPgCfg);
  const [pgActive, setPgActive] = useState<PgActive | null>(null);
  const [pgSaving, setPgSaving] = useState(false);
  const [pgSaved,  setPgSaved]  = useState(false);
  const [pgSwitching, setPgSwitching] = useState(false);

  useEffect(() => {
    pgConfigApi.get().then(cfg => setPgCfg({ ...defaultPgCfg, ...cfg })).catch(() => {});
    pgConfigApi.getActive().then(setPgActive).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // activeIsDocker: what the API is actually running on right now
  const activeIsDocker = pgActive?.mode === "pg" && (pgActive.port ?? 5433) !== 5433;
  // savedIsDocker: what lw-config says (takes effect after restart)
  const savedIsDocker  = pgCfg.useDocker;
  const restartNeeded  = activeIsDocker !== savedIsDocker;

  const handleSavePgConn = async () => {
    setPgSaving(true);
    try {
      await pgConfigApi.save(pgCfg);
      setPgSaved(true);
      setTimeout(() => setPgSaved(false), 3000);
    } finally {
      setPgSaving(false);
    }
  };

  const handleSwitch = async (toDocker: boolean) => {
    setPgSwitching(true);
    try {
      const saved = await pgConfigApi.save({ ...pgCfg, useDocker: toDocker });
      setPgCfg(saved);
    } finally {
      setPgSwitching(false);
    }
  };

  // Transfer state — target is always the INACTIVE db (other than what's running now)
  const embeddedConn = { host: "127.0.0.1", port: 5433, user: "foliantica", pass: "foliantica", db: "foliantica" };
  const dockerConn   = { host: pgCfg.host, port: pgCfg.port, user: pgCfg.user, pass: pgCfg.pass, db: pgCfg.db };
  // Copy TO whichever db is NOT currently active
  const transferTarget   = activeIsDocker ? embeddedConn : dockerConn;
  const transferTargetLabel = activeIsDocker
    ? "Embedded (port 5433)"
    : `Docker (${pgCfg.host}:${pgCfg.port})`;

  const [transferState,  setTransferState]  = useState<"idle"|"busy"|"ok"|"error">("idle");
  const [transferResult, setTransferResult] = useState<string>("");

  const handleTransfer = async () => {
    setTransferState("busy");
    setTransferResult("");
    try {
      const res = await pgConfigApi.transfer(transferTarget);
      setTransferState("ok");
      setTransferResult(`Copied ${res.rows_copied} rows across ${res.tables_copied} tables.`);
    } catch (e: any) {
      setTransferState("error");
      setTransferResult(e.message ?? "Transfer failed");
    }
  };

  const handleLoadDump = async () => {
    setRestoreState("busy");
    setRestoreMsg("");
    try {
      const res = await syncApi.restore();
      setRestoreState("ok");
      const dt = res.dump_time
        ? new Date(res.dump_time + "Z").toLocaleString()
        : "";
      setRestoreMsg(`Loaded ${res.statements} statements${dt ? ` (dump from ${dt})` : ""}.`);
    } catch (e: any) {
      setRestoreState("error");
      setRestoreMsg(e.message ?? "Restore failed");
    }
  };

  const handleDump = async (force = false) => {
    setDumpState("busy");
    setDumpMsg("");
    setDumpConflict(null);
    try {
      await syncApi.dump(force);
      setDumpState("ok");
      setDumpMsg("Dumped to sync dir.");
    } catch (e: any) {
      const msg: string = e.message ?? "";
      // req() throws "409: <json body>" — detect and parse the conflict payload
      if (msg.startsWith("409:")) {
        try {
          const body = JSON.parse(msg.slice(4).trim());
          const detail = body.detail ?? body;
          setDumpConflict({ dump_time: detail.dump_time ?? "" });
          setDumpState("idle");
          return;
        } catch { /* fall through to generic error */ }
      }
      setDumpState("error");
      setDumpMsg(msg || "Dump failed");
    }
  };

  // ── Data directory ────────────────────────────────────────────────────────
  const isElectron = typeof window !== "undefined" && !!(window as any).electron;
  const [dataDir, setDataDir]               = useState<string>("");
  const [dataDirConfigured, setDataDirConfigured] = useState<string | null>(null);
  const [dataDirPending, setDataDirPending]   = useState(false);
  const [dataDirBrowseErr, setDataDirBrowseErr] = useState<string | null>(null);
  const [dataDirRestarting, setDataDirRestarting] = useState(false);
  const [restoreState,  setRestoreState]  = useState<"idle"|"busy"|"ok"|"error">("idle");
  const [restoreMsg,    setRestoreMsg]    = useState("");
  const [dumpState,     setDumpState]     = useState<"idle"|"busy"|"ok"|"error">("idle");
  const [dumpMsg,       setDumpMsg]       = useState("");
  const [dumpConflict,  setDumpConflict]  = useState<{ dump_time: string } | null>(null);

  // ── Co-Work ───────────────────────────────────────────────────────────────
  const [coworkEnabled,      setCoworkEnabled]      = useState(false);
  const [coworkInfo,         setCoworkInfo]         = useState<{ lan_ip: string; lan_url: string; active_sessions: number } | null>(null);
  const [invitations,        setInvitations]        = useState<Invitation[]>([]);
  const [coworkLoading,      setCoworkLoading]      = useState(false);
  const [newInvName,         setNewInvName]         = useState("");
  const [newInvRole,         setNewInvRole]         = useState<"coauthor"|"student">("coauthor");
  const [newInvPin,          setNewInvPin]          = useState("");
  const [newInvMaxSessions,  setNewInvMaxSessions]  = useState(1);
  const [copiedInvId,        setCopiedInvId]        = useState<string | null>(null);
  const [coworkToggleBusy,   setCoworkToggleBusy]   = useState(false);
  const [assigningInv,       setAssigningInv]       = useState<Invitation | null>(null);
  const [teacherSessions,    setTeacherSessions]    = useState<TeacherSession[]>([]);
  const [teacherLoading,     setTeacherLoading]     = useState(false);

  // ── UPnP state ────────────────────────────────────────────────────────────
  const [upnpStatus,         setUpnpStatus]         = useState<UPnPStatus | null>(null);
  const [upnpRiskChecked,    setUpnpRiskChecked]    = useState(false);
  const [upnpBusy,           setUpnpBusy]           = useState(false);
  const [upnpError,          setUpnpError]          = useState<string | null>(null);

  // ── Cloudflare Tunnel state ───────────────────────────────────────────────
  const [cfStatus,           setCfStatus]           = useState<CloudflareStatus | null>(null);
  const [cfBusy,             setCfBusy]             = useState(false);
  const [cfError,            setCfError]            = useState<string | null>(null);

  useEffect(() => {
    collabApi.info().then(d => {
      setCoworkEnabled(d.enabled);
      setCoworkInfo(d);
    }).catch(() => {});
    collabApi.listInvitations().then(setInvitations).catch(() => {});
    collabApi.upnpStatus().then(setUpnpStatus).catch(() => {});
    collabApi.cloudflareStatus().then(setCfStatus).catch(() => {});
  }, []);

  const handleUpnpAcceptDisclaimer = async () => {
    await collabApi.upnpAcceptDisclaimer();
    setUpnpStatus(prev => prev ? { ...prev, disclaimer_accepted: true } : prev);
  };

  const handleUpnpOpen = async () => {
    setUpnpBusy(true);
    setUpnpError(null);
    try {
      const result = await collabApi.upnpOpen();
      setUpnpStatus(prev => prev ? {
        ...prev,
        active: true,
        external_ip: result.external_ip,
        external_url: result.external_url,
        ports_mapped: result.ports_mapped,
      } : prev);
    } catch (e: any) {
      setUpnpError(e.message ?? "Failed to open UPnP port mapping");
    } finally {
      setUpnpBusy(false);
    }
  };

  const handleUpnpClose = async () => {
    setUpnpBusy(true);
    setUpnpError(null);
    try {
      await collabApi.upnpClose();
      setUpnpStatus(prev => prev ? {
        ...prev, active: false, external_ip: null, external_url: null, ports_mapped: [],
      } : prev);
    } finally {
      setUpnpBusy(false);
    }
  };

  const handleCfOpen = async () => {
    setCfBusy(true);
    setCfError(null);
    try {
      const result = await collabApi.cloudflareOpen();
      setCfStatus(prev => prev ? { ...prev, active: true, url: result.url } : prev);
    } catch (e: any) {
      setCfError(e.message ?? "Failed to start Cloudflare tunnel");
    } finally {
      setCfBusy(false);
    }
  };

  const handleCfClose = async () => {
    setCfBusy(true);
    setCfError(null);
    try {
      await collabApi.cloudflareClose();
      setCfStatus(prev => prev ? { ...prev, active: false, url: null } : prev);
    } finally {
      setCfBusy(false);
    }
  };

  const loadTeacherView = () => {
    setTeacherLoading(true);
    collabApi.teacherView()
      .then(setTeacherSessions)
      .catch(() => {})
      .finally(() => setTeacherLoading(false));
  };

  // Reload teacher view whenever co-work section is visible
  useEffect(() => {
    if (coworkEnabled) loadTeacherView();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coworkEnabled]);

  const handleCoworkToggle = async (enabled: boolean) => {
    setCoworkToggleBusy(true);
    try {
      await collabApi.toggle(enabled);
      setCoworkEnabled(enabled);
    } finally {
      setCoworkToggleBusy(false);
    }
  };

  const handleCreateInvitation = async () => {
    if (!newInvName.trim()) return;
    setCoworkLoading(true);
    try {
      const inv = await collabApi.createInvitation({
        name: newInvName.trim(),
        role: newInvRole,
        pin: newInvPin || undefined,
        max_sessions: newInvMaxSessions,
      });
      setInvitations(prev => [...prev, inv]);
      setNewInvName("");
      setNewInvPin("");
      setNewInvMaxSessions(1);
    } finally {
      setCoworkLoading(false);
    }
  };

  const handleDeleteInvitation = async (id: string) => {
    await collabApi.deleteInvitation(id);
    setInvitations(prev => prev.filter(i => i.id !== id));
  };

  const handleCopyLink = async (id: string) => {
    try {
      const { join_url } = await collabApi.getInvitationToken(id);
      await navigator.clipboard.writeText(join_url);
      setCopiedInvId(id);
      setTimeout(() => setCopiedInvId(null), 2000);
    } catch {}
  };

  useEffect(() => {
    dataDirApi.get().then((res) => {
      setDataDir(res.configured ?? res.current);
      setDataDirConfigured(res.configured);
    }).catch(() => {});
  }, []);

  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(null);
  const [editName, setEditName]                 = useState("");
  const [editDescription, setEditDescription]   = useState("");
  const [editSystem, setEditSystem]             = useState("");
  const [editTemplate, setEditTemplate]         = useState("");
  const [editWordCount, setEditWordCount]       = useState(400);
  const [showPlaceholderHelp, setShowPlaceholderHelp] = useState(false);
  const [promptSaved, setPromptSaved]           = useState(false);

  const selectedPrompt = prompts.find(p => p.id === selectedPromptId) ?? null;

  const selectPrompt = (p: AIPrompt) => {
    setSelectedPromptId(p.id);
    setEditName(p.name);
    setEditDescription(p.description);
    setEditSystem(p.system);
    setEditTemplate(p.user_template);
    setEditWordCount(p.word_count ?? 400);
    setShowPlaceholderHelp(false);
    setPromptSaved(false);
  };

  const handleSavePrompt = async () => {
    if (!selectedPromptId) return;
    await updatePrompt.mutateAsync({
      id: selectedPromptId,
      data: { name: editName, description: editDescription, system: editSystem, user_template: editTemplate, word_count: editWordCount },
    });
    setPromptSaved(true);
    setTimeout(() => setPromptSaved(false), 2000);
  };

  const handleCreatePrompt = async () => {
    const p = await createPrompt.mutateAsync({ name: "New Prompt" });
    selectPrompt(p);
  };

  const handleDeletePrompt = async () => {
    if (!selectedPromptId) return;
    await deletePrompt.mutateAsync(selectedPromptId);
    setSelectedPromptId(null);
  };

  const handleRevertPrompt = async () => {
    if (!selectedPromptId) return;
    const p = await revertPrompt.mutateAsync(selectedPromptId);
    selectPrompt(p);
  };

  useEffect(() => {
    if (settings) {
      setDefaultModel(settings.default_model);
      setDefaultChatModel(settings.default_chat_model ?? "");
      setDefaultSynopsisModel(settings.default_synopsis_model ?? "");
      setDefaultCodexModel(settings.default_codex_model ?? "");
      setEnabledModels(settings.enabled_models ?? []);
      setGrammarEnabled(settings.grammar_check_enabled ?? false);
      setGrammarUrl(settings.grammar_check_url ?? "http://localhost:8081");
      setGrammarLanguages(settings.grammar_languages ?? ["en"]);
      setPandocEnabled(settings.pandoc_enabled ?? false);
      setPandocUrl(settings.pandoc_url ?? "http://localhost:8082");
      setAiDisabled(settings.ai_disabled ?? false);
      setSyncEnabled(settings.sync_mirror_enabled ?? false);
      setSyncLocalDir(settings.sync_local_dir ?? "");
    }
  }, [settings]);

  const handleSyncToggle = async (enabled: boolean) => {
    setSyncEnabled(enabled);
    setSyncSaving(true);
    try {
      await updateSettings.mutateAsync({ sync_mirror_enabled: enabled, sync_local_dir: syncLocalDir || null });
    } finally {
      setSyncSaving(false);
    }
  };

  const handleSyncDirSave = async () => {
    setSyncSaving(true);
    try {
      await updateSettings.mutateAsync({ sync_local_dir: syncLocalDir || null });
    } finally {
      setSyncSaving(false);
    }
  };

  const toggleModel = (id: string) => {
    setEnabledModels(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    );
  };

  const handleSave = async () => {
    const payload: Parameters<typeof updateSettings.mutateAsync>[0] = {
      default_model: defaultModel,
      default_chat_model: defaultChatModel || null,
      default_synopsis_model: defaultSynopsisModel || null,
      default_codex_model: defaultCodexModel || null,
      enabled_models: enabledModels,
      theme,
      grammar_check_enabled: grammarEnabled,
      grammar_check_url: grammarUrl,
      grammar_languages: grammarLanguages,
      pandoc_enabled: pandocEnabled,
      pandoc_url: pandocUrl,
    };
    // Only include the key when the user has explicitly typed in the field.
    // Guards against browser autofill silently populating a password field on load.
    if (apiKeyDirty && apiKey) payload.openrouter_api_key = apiKey;
    await updateSettings.mutateAsync(payload);
    setApiKey("");
    setApiKeyDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Models to show in the list: if API returned results use those, else show enabled_models already stored
  const listModels = availableModels.length > 0 ? availableModels : enabledModels.map(id => ({ id, name: id }));
  const filteredModels = modelSearch
    ? listModels.filter(m => m.name.toLowerCase().includes(modelSearch.toLowerCase()) || m.id.toLowerCase().includes(modelSearch.toLowerCase()))
    : listModels;

  // Default model dropdown: available models or just stored enabled ones
  const defaultModelChoices = availableModels.length > 0 ? availableModels : listModels;

  // Restart the Python API then reload the UI.
  // In Electron: restart the API process first so the new data-dir is live,
  // then relaunch the Electron shell (which will re-spawn the API in prod mode).
  // In browser: poll /api/health until the server is back, then hard-navigate.
  const restartAndReload = async () => {
    if (isElectron) {
      // Restart the API process so it picks up the new dataDir from config.
      // Ignore errors — in production the binary may not support self-restart,
      // and in that case the Electron relaunch will spawn a fresh API anyway.
      try { await dataDirApi.restart(); } catch { /* expected */ }
      // Short pause so the API process starts dying before Electron exits.
      await new Promise(r => setTimeout(r, 400));
      (window as any).electron.restart();
      return;
    }
    // Browser mode: show overlay, restart backend, poll until healthy, reload.
    setDataDirRestarting(true);
    try { await dataDirApi.restart(); } catch { /* process exits — expected */ }
    await new Promise(r => setTimeout(r, 2000));
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        const res = await fetch("/api/health");
        if (res.ok) break;
      } catch { /* still starting */ }
    }
    window.location.href = "/";
  };

  // Full-screen restart overlay — rendered while backend is cycling.
  // Covering the whole page prevents React Query hooks from firing more
  // requests into the dead server and flooding the console with ECONNRESET.
  if (dataDirRestarting) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium">Restarting…</p>
        <p className="text-xs text-muted-foreground">Waiting for backend to come back up</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4 flex items-center gap-3">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-lg font-semibold">{t("settings_title")}</h1>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-8">

        {/* AI Configuration */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{t("settings_ai_config")}</h2>
          </div>

          {/* AI features toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className={cn("h-3.5 w-3.5", aiDisabled ? "text-muted-foreground/40" : "text-primary")} />
              <div>
                <p className="text-sm font-medium">AI features</p>
                <p className="text-xs text-muted-foreground">Enable AI writing assistant, synopsis generation, and codex distillation</p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!aiDisabled}
              onClick={() => {
                const next = !aiDisabled;
                setAiDisabled(next);
                updateSettings.mutate({ ai_disabled: next });
              }}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                !aiDisabled ? "bg-primary" : "bg-input"
              )}
            >
              <span className={cn(
                "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
                !aiDisabled ? "translate-x-4" : "translate-x-0"
              )} />
            </button>
          </div>

          {aiDisabled && (
            <p className="text-xs text-muted-foreground/60 italic pl-5 border-l-2 border-border/40">
              AI features are disabled. Enable them above to configure models and the API key.
              The "All Human" achievement is available when AI is off.
            </p>
          )}

          {!aiDisabled && (<>
          <div className="space-y-1.5">
            <Label htmlFor="api-key" className="flex items-center gap-1.5">
              <Key className="h-3.5 w-3.5" />
              {t("settings_api_key")}
            </Label>
            <Input
              id="api-key"
              type="password"
              placeholder={settings?.has_api_key ? "••••••••••••••••••••••••••••••" : "sk-or-..."}
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setApiKeyDirty(true); }}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              {t("settings_api_key_note")}{" "}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" className="text-primary hover:underline">
                Get a key →
              </a>
            </p>
          </div>

          {/* Default model */}
          <div className="space-y-1.5">
            <Label>{t("settings_default_model")}</Label>
            <Select value={defaultModel} onValueChange={setDefaultModel}>
              <SelectTrigger className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {defaultModelChoices.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Used by the AI writing panel.</p>
          </div>

          {/* Default chat model */}
          <div className="space-y-1.5">
            <Label>Default Chat Model</Label>
            <Select
              value={defaultChatModel || "__default__"}
              onValueChange={(v) => setDefaultChatModel(v === "__default__" ? "" : v)}
            >
              <SelectTrigger className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Same as default model</SelectItem>
                {defaultModelChoices.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Used by the Scene Chat panel.</p>
          </div>

          {/* Default synopsis model */}
          <div className="space-y-1.5">
            <Label>Default Synopsis Model</Label>
            <Select
              value={defaultSynopsisModel || "__default__"}
              onValueChange={(v) => setDefaultSynopsisModel(v === "__default__" ? "" : v)}
            >
              <SelectTrigger className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Same as default model</SelectItem>
                {defaultModelChoices.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Used when auto-generating scene synopses.</p>
          </div>

          {/* Default codex distillation model */}
          <div className="space-y-1.5">
            <Label>Default Codex Distillation Model</Label>
            <Select
              value={defaultCodexModel || "__default__"}
              onValueChange={(v) => setDefaultCodexModel(v === "__default__" ? "" : v)}
            >
              <SelectTrigger className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Same as default model</SelectItem>
                {defaultModelChoices.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Used by /ki when distilling codex entries.</p>
          </div>

          {/* Available models (checkbox list for /ki command) */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Models available in /ki command</Label>
              <button
                type="button"
                onClick={() => refetchModels()}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Refresh model list"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", modelsLoading && "animate-spin")} />
              </button>
            </div>

            {!settings?.has_api_key && (
              <p className="text-xs text-muted-foreground">Add an API key to load available models.</p>
            )}

            {settings?.has_api_key && (
              <>
                <Input
                  className="h-7 text-xs max-w-xs"
                  placeholder="Search models…"
                  value={modelSearch}
                  onChange={e => setModelSearch(e.target.value)}
                />

                {modelsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading models…
                  </div>
                ) : filteredModels.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No models found.</p>
                ) : (
                  <div className="border border-border rounded-lg overflow-hidden max-h-72 overflow-y-auto divide-y divide-border/50">
                    {filteredModels.map(m => (
                      <label
                        key={m.id}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-secondary/40 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={enabledModels.includes(m.id)}
                          onChange={() => toggleModel(m.id)}
                          className="accent-primary shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-sm truncate">{m.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{m.id}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}

                {enabledModels.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {enabledModels.length} model{enabledModels.length !== 1 ? "s" : ""} enabled
                  </p>
                )}
              </>
            )}
          </div>
          </>)}
        </section>

        {!aiDisabled && (<>
        <div className="border-t border-border" />

        {/* AI Prompts */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">AI Prompts</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Wrapper prompts define how the /ki command structures its request to the AI. Select a prompt to edit it.
          </p>

          {/* Prompt list */}
          <div className="flex flex-wrap gap-2">
            {prompts.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPrompt(p)}
                className={cn(
                  "text-xs px-3 py-1.5 rounded border transition-colors text-left",
                  selectedPromptId === p.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-secondary/50"
                )}
              >
                {p.name}
                {p.is_built_in && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">(built-in)</span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={handleCreatePrompt}
              className="text-xs px-3 py-1.5 rounded border border-dashed border-border hover:bg-secondary/50 flex items-center gap-1 text-muted-foreground"
            >
              <Plus className="h-3 w-3" /> New Prompt
            </button>
          </div>

          {/* Prompt editor */}
          {selectedPrompt && (
            <div className="space-y-3 border border-border rounded-lg p-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input value={editDescription} onChange={e => setEditDescription(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Word Count Target</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={50}
                    max={10000}
                    step={50}
                    value={editWordCount}
                    onChange={e => setEditWordCount(Number(e.target.value))}
                    className="w-28 h-8 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">words — use <code className="text-primary">{"{{WORD_COUNT}}"}</code> in your prompt</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>System Prompt</Label>
                <Textarea
                  value={editSystem}
                  onChange={e => setEditSystem(e.target.value)}
                  rows={8}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label>User Template</Label>
                  <button
                    type="button"
                    onClick={() => setShowPlaceholderHelp(v => !v)}
                    className="text-muted-foreground hover:text-foreground"
                    title="Show available placeholders"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                </div>
                {showPlaceholderHelp && (
                  <div className="rounded border border-border bg-secondary/30 p-3 space-y-1">
                    <p className="text-[11px] font-semibold text-muted-foreground mb-1">Available placeholders:</p>
                    {PLACEHOLDER_HELP.map(ph => (
                      <div key={ph.token} className="flex gap-2 text-[11px]">
                        <code className="text-primary shrink-0">{ph.token}</code>
                        <span className="text-muted-foreground">— {ph.desc}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Textarea
                  value={editTemplate}
                  onChange={e => setEditTemplate(e.target.value)}
                  rows={5}
                  className="font-mono text-xs"
                />
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={handleSavePrompt}
                  disabled={updatePrompt.isPending}
                >
                  {promptSaved ? "Saved" : updatePrompt.isPending ? "Saving…" : "Save"}
                </Button>
                {selectedPrompt.is_built_in && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRevertPrompt}
                    disabled={revertPrompt.isPending}
                    className="flex items-center gap-1"
                  >
                    <RotateCcw className="h-3 w-3" /> Revert to default
                  </Button>
                )}
                {!selectedPrompt.is_built_in && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleDeletePrompt}
                    disabled={deletePrompt.isPending}
                    className="flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>
        </>)}

        <div className="border-t border-border" />

        {/* Appearance */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Palette className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">Appearance</h2>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Choose a color theme for the interface.</p>
            <div className="grid grid-cols-4 gap-2">
              {THEMES.map((themeId) => {
                const preview = THEME_PREVIEW[themeId];
                return (
                  <button
                    key={themeId}
                    type="button"
                    onClick={() => setTheme(themeId)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-xs transition-colors",
                      theme === themeId
                        ? "border-primary ring-1 ring-primary"
                        : "border-border hover:border-border/70"
                    )}
                  >
                    <div
                      className="w-full h-8 rounded"
                      style={{ background: preview.bg, boxShadow: `inset 0 0 0 2px ${preview.accent}33` }}
                    >
                      <div
                        className="h-2 rounded-t mt-1.5 mx-1.5"
                        style={{ background: preview.accent, opacity: 0.85 }}
                      />
                    </div>
                    <span className={cn("font-medium", theme === themeId && "text-primary")}>
                      {THEME_LABELS[themeId]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Editor options */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Hash className="h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Paragraph numbers</p>
                <p className="text-xs text-muted-foreground">Show a count every 5 / 10 paragraphs in the scene editor</p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showParagraphNumbers}
              onClick={() => {
                const next = !showParagraphNumbers;
                setShowParagraphNumbers(next);
                updateSettings.mutate({ show_paragraph_numbers: next });
              }}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                showParagraphNumbers ? "bg-primary" : "bg-input"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
                  showParagraphNumbers ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
          </div>

          {/* Session timer */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Timer className="h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Session timer</p>
                <p className="text-xs text-muted-foreground">Show a Goal button in the editor to track writing sessions</p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={sessionTimerEnabled}
              onClick={() => {
                const next = !sessionTimerEnabled;
                setSessionTimerEnabled(next);
                updateSettings.mutate({ session_timer_enabled: next });
              }}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                sessionTimerEnabled ? "bg-primary" : "bg-input"
              )}
            >
              <span className={cn(
                "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
                sessionTimerEnabled ? "translate-x-4" : "translate-x-0"
              )} />
            </button>
          </div>

          {/* Achievement popups */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Trophy className="h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Achievement popups</p>
                <p className="text-xs text-muted-foreground">Show a notification when a new achievement is unlocked</p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={achPopupsEnabled}
              onClick={() => {
                const next = !achPopupsEnabled;
                setAchPopupsEnabled(next);
                localStorage.setItem(ACH_POPUPS_KEY, next ? "true" : "false");
              }}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                achPopupsEnabled ? "bg-primary" : "bg-input"
              )}
            >
              <span className={cn(
                "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
                achPopupsEnabled ? "translate-x-4" : "translate-x-0"
              )} />
            </button>
          </div>

          {/* Typewriter cursor position */}
          <div className="flex items-center gap-2 pt-1">
            <AlignCenter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div className="flex flex-1 items-center gap-3">
              <p className="text-sm font-medium shrink-0">Typewriter position</p>
              <input
                type="range"
                min={10}
                max={90}
                step={5}
                value={typewriterOffset}
                onChange={(e) => setTypewriterOffset(Number(e.target.value))}
                onMouseUp={(e) => updateSettings.mutate({ typewriter_offset: Number((e.target as HTMLInputElement).value) })}
                className="flex-1 accent-primary"
              />
              <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">{typewriterOffset}%</span>
            </div>
          </div>
        </section>

        <div className="border-t border-border" />

        {/* Sync Dir */}
        <section className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold">Sync Dir</h2>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={restartAndReload}
            >
              <RotateCw className="h-3.5 w-3.5" />
              Restart Backend
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Where Foliantica stores uploaded resources and database dumps.
            Point this to a Dropbox, Google Drive, or OneDrive folder to sync
            files across devices. The PostgreSQL cluster is always stored
            locally and is unaffected by this setting.
          </p>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 truncate rounded border border-border bg-secondary/40 px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={dataDir}
              onChange={(e) => setDataDir(e.target.value)}
              placeholder="Default (app data folder)"
              spellCheck={false}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                setDataDirBrowseErr(null);
                try {
                  const picked = isElectron
                    ? await (window as any).electron.pickDataDir()
                    : (await dataDirApi.pick()).path;
                  if (picked) setDataDir(picked);
                } catch (e) {
                  setDataDirBrowseErr("Could not open folder picker. Try typing the path manually.");
                }
              }}
            >
              <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
              Browse
            </Button>
          </div>
          {dataDirBrowseErr && (
            <p className="text-xs text-destructive">{dataDirBrowseErr}</p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              disabled={dataDirPending}
              onClick={async () => {
                setDataDirPending(true);
                try {
                  await dataDirApi.set(dataDir || null, false);
                  setDataDirConfigured(dataDir || null);
                } finally {
                  setDataDirPending(false);
                }
              }}
            >
              {dataDirPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
            </Button>
            {dumpConflict ? (
              <span className="flex items-center gap-1.5 text-xs text-amber-500">
                Dump from {dumpConflict.dump_time ? new Date(dumpConflict.dump_time + "Z").toLocaleString() : "unknown"} exists — overwrite?
                <button
                  className="underline hover:text-amber-400"
                  onClick={() => handleDump(true)}
                >Yes</button>
                <button
                  className="underline hover:text-foreground text-muted-foreground"
                  onClick={() => setDumpConflict(null)}
                >No</button>
              </span>
            ) : (
              <Button
                size="sm" variant="outline"
                disabled={dumpState === "busy"}
                onClick={() => handleDump(false)}
              >
                {dumpState === "busy"
                  ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Dumping…</>
                  : "Dump"}
              </Button>
            )}
            <Button
              size="sm" variant="outline"
              disabled={restoreState === "busy"}
              onClick={handleLoadDump}
            >
              {restoreState === "busy"
                ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Loading…</>
                : "Load Dump"}
            </Button>
            {dataDirConfigured && (
              <Button
                size="sm"
                variant="outline"
                disabled={dataDirPending}
                onClick={async () => {
                  setDataDirPending(true);
                  try {
                    await dataDirApi.set(null, false);
                    setDataDirConfigured(null);
                    setDataDir("");
                  } finally {
                    setDataDirPending(false);
                  }
                }}
              >
                Reset to default
              </Button>
            )}
          </div>
          {dumpState    === "ok"    && <p className="text-xs text-emerald-500">{dumpMsg}</p>}
          {dumpState    === "error" && <p className="text-xs text-destructive">{dumpMsg}</p>}
          {restoreState === "ok"    && <p className="text-xs text-emerald-500">{restoreMsg}</p>}
          {restoreState === "error" && <p className="text-xs text-destructive">{restoreMsg}</p>}
        </section>

        <div className="border-t border-border" />

        {/* Data Mirror */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Database className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">Data Mirror</h2>
          </div>

          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Keep a local mirror copy</p>
                <p className="text-xs text-muted-foreground">
                  Maintains an up-to-date backup at a local path, synced every 5 minutes.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={syncEnabled}
                disabled={syncSaving}
                onClick={() => handleSyncToggle(!syncEnabled)}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50",
                  syncEnabled ? "bg-primary" : "bg-input"
                )}
              >
                <span className={cn(
                  "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-lg ring-0 transition-transform",
                  syncEnabled ? "translate-x-4" : "translate-x-0"
                )} />
              </button>
            </div>

            {syncEnabled && (
              <>
                <p className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2 leading-relaxed">
                  Keeps a local backup of the database dump (<code className="text-primary font-mono text-[11px]">foliantica.sql</code>)
                  and uploaded files, updated after every save. Useful as a second copy on a
                  local drive when your primary sync dir is on a cloud folder that may be
                  temporarily unavailable.
                </p>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Mirror location</Label>
                  <div className="flex gap-2">
                    <Input
                      value={syncLocalDir}
                      onChange={(e) => setSyncLocalDir(e.target.value)}
                      placeholder={`${typeof window !== "undefined" ? "~" : ""}/.foliantica/mirror  (default)`}
                      className="text-xs h-8 flex-1 font-mono"
                    />
                    <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={handleSyncDirSave} disabled={syncSaving}>
                      Apply
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      syncStatus?.mode === "online"  ? "bg-emerald-400" :
                      syncStatus?.mode === "offline" ? "bg-amber-400"   : "bg-muted-foreground/40"
                    )} />
                    {syncStatus?.mode === "online"  ? "Online" :
                     syncStatus?.mode === "offline" ? "Sync drive offline" : "Initialising…"}
                    {syncStatus?.last_sync_at && (
                      <span className="text-muted-foreground/50">
                        · Last synced {new Date(syncStatus.last_sync_at).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm" variant="ghost"
                    className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => syncApi.trigger().catch(() => {})}
                    disabled={syncStatus?.mode !== "online"}
                  >
                    <RefreshCw className="h-3 w-3" /> Sync now
                  </Button>
                </div>

                {syncStatus?.error && (
                  <p className="text-xs text-destructive">{syncStatus.error}</p>
                )}
              </>
            )}
          </div>
        </section>

        <div className="border-t border-border" />

        {/* External Services */}
        <section className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <Container className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">External Services</h2>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="text-muted-foreground hover:text-foreground transition-colors ml-0.5"
              title="How to set up these services"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Optional Docker-based services for grammar checking and PDF/EPUB export.
            Enable the ones you want, then click <strong className="text-foreground font-medium">Start Services</strong>.
          </p>

          {/* Grammar check */}
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Grammar Check (LanguageTool)</p>
                <p className="text-xs text-muted-foreground">On-demand grammar and style suggestions in the scene editor</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={grammarEnabled}
                onClick={() => setGrammarEnabled(v => !v)}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  grammarEnabled ? "bg-primary" : "bg-input"
                )}
              >
                <span className={cn(
                  "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
                  grammarEnabled ? "translate-x-4" : "translate-x-0"
                )} />
              </button>
            </div>
            {grammarEnabled && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Service URL</Label>
                  <Input
                    value={grammarUrl}
                    onChange={e => setGrammarUrl(e.target.value)}
                    placeholder="http://localhost:8081"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Languages to download</Label>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Ngram models improve detection of confused words and style issues (~1–2 GB each). Only select the ones you need — they are downloaded when you click <strong className="text-foreground">Start Services</strong>.
                  </p>
                  <div className="grid grid-cols-3 gap-x-3 gap-y-1 pt-0.5">
                    {GRAMMAR_LANGUAGES.map(lang => (
                      <label key={lang.code} className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={grammarLanguages.includes(lang.code)}
                          onChange={() => setGrammarLanguages(prev =>
                            prev.includes(lang.code)
                              ? prev.filter(c => c !== lang.code)
                              : [...prev, lang.code]
                          )}
                          className="accent-primary shrink-0"
                        />
                        <span className="text-xs">{lang.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Pandoc / PDF+EPUB */}
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">PDF & EPUB Export (Pandoc)</p>
                <p className="text-xs text-muted-foreground">Export projects to PDF (via LaTeX) or EPUB format</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={pandocEnabled}
                onClick={() => setPandocEnabled(v => !v)}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  pandocEnabled ? "bg-primary" : "bg-input"
                )}
              >
                <span className={cn(
                  "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
                  pandocEnabled ? "translate-x-4" : "translate-x-0"
                )} />
              </button>
            </div>
            {pandocEnabled && (
              <div className="space-y-1.5">
                <Label className="text-xs">Service URL</Label>
                <Input
                  value={pandocUrl}
                  onChange={e => setPandocUrl(e.target.value)}
                  placeholder="http://localhost:8082"
                  className="h-8 text-xs font-mono"
                />
              </div>
            )}
          </div>

          {/* PostgreSQL Database */}
          <div className="rounded-lg border border-border p-4 space-y-4">

            {/* Header */}
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-primary" />
              PostgreSQL Database
            </p>

            {/* ── Active database indicator + switch ── */}
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Active database</p>
                <p className="text-xs font-medium">
                  {activeIsDocker
                    ? <><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle" />Docker ({pgActive?.host}:{pgActive?.port})</>
                    : <><span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400 mr-1.5 align-middle" />Embedded (port 5433)</>}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs shrink-0"
                disabled={pgSwitching}
                onClick={() => handleSwitch(!activeIsDocker)}
                title="Saves config and requires backend restart"
              >
                {pgSwitching
                  ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  : null}
                Switch to {activeIsDocker ? "Embedded" : "Docker"}
              </Button>
            </div>

            {/* Pending restart banner */}
            {restartNeeded && (
              <p className="text-[11px] text-amber-500 dark:text-amber-400">
                ⚠ Restart the backend to activate{" "}
                <strong>{savedIsDocker ? "Docker" : "Embedded"}</strong> mode.
                {savedIsDocker && " Include postgres in Start Services below."}
              </p>
            )}

            {/* ── Docker connection fields (always shown) ── */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Docker connection</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Host</Label>
                  <Input value={pgCfg.host} onChange={e => setPgCfg(c => ({ ...c, host: e.target.value }))} className="h-8 text-xs font-mono" placeholder="127.0.0.1" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Port</Label>
                  <Input value={pgCfg.port} onChange={e => setPgCfg(c => ({ ...c, port: Number(e.target.value) }))} className="h-8 text-xs font-mono" placeholder="5434" type="number" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">User</Label>
                  <Input value={pgCfg.user} onChange={e => setPgCfg(c => ({ ...c, user: e.target.value }))} className="h-8 text-xs font-mono" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Password</Label>
                  <Input value={pgCfg.pass} onChange={e => setPgCfg(c => ({ ...c, pass: e.target.value }))} className="h-8 text-xs font-mono" type="password" />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Database</Label>
                  <Input value={pgCfg.db} onChange={e => setPgCfg(c => ({ ...c, db: e.target.value }))} className="h-8 text-xs font-mono" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleSavePgConn} disabled={pgSaving}>
                  {pgSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Save connection
                </Button>
                {pgSaved && <span className="text-xs text-emerald-500">Saved</span>}
              </div>
            </div>

            {/* ── Copy to inactive DB (always shown) ── */}
            <div className="border-t border-border/50 pt-3 space-y-2">
              <p className="text-xs font-medium">
                Copy to{" "}
                <span className="text-foreground">{transferTargetLabel}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                Copies all rows from the current live database to the target.
                The target must be running. Existing data in the target is replaced.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm" variant="outline" className="h-7 text-xs"
                  disabled={transferState === "busy"}
                  onClick={handleTransfer}
                >
                  {transferState === "busy"
                    ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Transferring…</>
                    : "Transfer now"}
                </Button>
                {transferState === "ok"    && <p className="text-xs text-emerald-500">{transferResult}</p>}
                {transferState === "error" && <p className="text-xs text-destructive">{transferResult}</p>}
              </div>
            </div>
          </div>

          {/* Start + status row */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Start Services button */}
            <Button
              size="sm"
              variant="outline"
              disabled={dockerUpState === "busy"}
              onClick={async () => {
                setDockerUpState("busy");
                setDockerUpMsg("");
                setDockerUpStep("Saving settings…");
                try {
                  // Persist current service settings first so docker compose
                  // reads the latest language selection and URLs from the DB.
                  await updateSettings.mutateAsync({
                    grammar_check_enabled: grammarEnabled,
                    grammar_check_url: grammarUrl,
                    grammar_languages: grammarLanguages,
                    pandoc_enabled: pandocEnabled,
                    pandoc_url: pandocUrl,
                  });
                  setDockerUpStep("Starting Docker… (may take up to 90 s if Docker Desktop was closed)");
                  const res = await settingsApi.dockerComposeUp();
                  setDockerUpStep("");
                  setDockerUpState("ok");
                  setDockerUpMsg(res.output || "Services started.");
                  // auto-refresh status after startup
                  setTimeout(() => { setShowServiceStatus(true); refetchStatus(); }, 1500);
                } catch (e: any) {
                  setDockerUpStep("");
                  setDockerUpState("error");
                  const detail = e.message?.includes(": ") ? e.message.split(": ").slice(1).join(": ") : e.message;
                  setDockerUpMsg(detail ?? "Failed to start services.");
                }
              }}
              className="gap-1.5"
            >
              {dockerUpState === "busy"
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Play className="h-3.5 w-3.5" />}
              {dockerUpState === "busy" ? "Starting…" : "Start Services"}
            </Button>
            {dockerUpState === "busy" && dockerUpStep && (
              <span className="text-xs text-muted-foreground animate-pulse">{dockerUpStep}</span>
            )}

            {/* Check status button */}
            <button
              type="button"
              onClick={() => { setShowServiceStatus(true); refetchStatus(); }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", statusLoading && "animate-spin")} />
              Check status
            </button>
          </div>

          {/* Docker output / error */}
          {dockerUpState === "ok" && dockerUpMsg && (
            <pre className="text-[11px] text-green-600 dark:text-green-400 bg-green-500/10 border border-green-500/20 rounded-md px-3 py-2 whitespace-pre-wrap leading-relaxed max-h-28 overflow-y-auto">
              {dockerUpMsg}
            </pre>
          )}
          {dockerUpState === "error" && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 space-y-1">
              <p className="text-xs font-medium text-destructive">Could not start services</p>
              <p className="text-[11px] text-destructive/80 whitespace-pre-wrap">{dockerUpMsg}</p>
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="text-[11px] text-primary hover:underline flex items-center gap-1"
              >
                <HelpCircle className="h-3 w-3" /> Setup guide
              </button>
            </div>
          )}

          {/* Service status badges */}
          {showServiceStatus && serviceStatus && (
            <div className="flex flex-wrap gap-3 text-xs">
              {grammarEnabled && (
                <ServiceStatusBadge label="LanguageTool" status={serviceStatus.languagetool} />
              )}
              {pandocEnabled && (
                <ServiceStatusBadge label="Pandoc" status={serviceStatus.pandoc} />
              )}
            </div>
          )}
        </section>

        {/* ── Docker Setup Help Modal ───────────────────────────────────────── */}
        {helpOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={() => setHelpOpen(false)}
          >
            <div
              className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <Container className="h-4 w-4 text-primary" />
                  <h2 className="text-base font-semibold">Setting Up External Services</h2>
                </div>
                <button onClick={() => setHelpOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal body */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-sm">

                {/* What is Docker */}
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">What is Docker?</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Docker is a free tool that runs programs in isolated containers — think of it like a
                    self-contained mini-computer for each service. You don&apos;t need to install
                    LanguageTool or Pandoc yourself; Docker downloads and runs everything automatically.
                  </p>
                </div>

                {/* Step 1 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground shrink-0">1</span>
                    <h3 className="font-semibold text-sm">Install Docker Desktop</h3>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed pl-7">
                    Download and install Docker Desktop for your operating system. It&apos;s free for personal use.
                    After installing, open it and wait for the whale icon to appear in your taskbar/menu bar
                    (that means Docker is running).
                  </p>
                  <div className="pl-7">
                    <a
                      href="https://www.docker.com/products/docker-desktop/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Download Docker Desktop →
                    </a>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground shrink-0">2</span>
                    <h3 className="font-semibold text-sm">Enable the services you want</h3>
                  </div>
                  <div className="pl-7 space-y-2">
                    <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 space-y-1.5">
                      <p className="text-xs font-medium">Grammar Check (LanguageTool)</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Checks your writing for grammar mistakes, style issues, and typos in 30+ languages.
                        Works like the grammar checker in Word, but privately — your text never leaves your computer.
                        <br /><span className="text-foreground/60">First download: ~500 MB. Runs on port 8081.</span>
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 space-y-1.5">
                      <p className="text-xs font-medium">PDF & EPUB Export (Pandoc)</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Converts your project into a professional PDF or an e-book file (EPUB) that works
                        on Kindle, Kobo, and Apple Books. Uses LaTeX for high-quality PDF typesetting.
                        <br /><span className="text-foreground/60">First download: ~600 MB. Runs on port 8082.</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground shrink-0">3</span>
                    <h3 className="font-semibold text-sm">Click "Start Services"</h3>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed pl-7">
                    Hit the <strong className="text-foreground">Start Services</strong> button. Foliantica will
                    download the container images (this only happens once — later starts are instant) and
                    launch them in the background. The first time may take a few minutes depending on your
                    internet connection.
                  </p>
                </div>

                {/* Step 4 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground shrink-0">4</span>
                    <h3 className="font-semibold text-sm">Save settings and check status</h3>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed pl-7">
                    Click <strong className="text-foreground">Save settings</strong> at the bottom of the page,
                    then use <strong className="text-foreground">Check status</strong> to confirm the services
                    are running. A green "Running" badge means everything is ready.
                  </p>
                </div>

                {/* Troubleshooting */}
                <div className="rounded-md border border-border bg-secondary/20 px-3 py-3 space-y-1.5">
                  <p className="text-xs font-semibold">Troubleshooting</p>
                  <ul className="text-[11px] text-muted-foreground space-y-1 leading-relaxed list-disc list-inside">
                    <li><strong className="text-foreground">Docker not found</strong> — Docker Desktop isn&apos;t installed or not running. Open Docker Desktop first.</li>
                    <li><strong className="text-foreground">Port already in use</strong> — Another app is using port 8081 or 8082. Change the URL field above to a different port (e.g. <code className="text-primary">http://localhost:8083</code>).</li>
                    <li><strong className="text-foreground">Services stay "Offline"</strong> — LanguageTool can take 30–60 seconds to fully start. Wait a moment, then click Check status again.</li>
                    <li><strong className="text-foreground">Services stop when you restart your computer</strong> — Open Docker Desktop, or click Start Services again. You can also set Docker Desktop to start automatically on login.</li>
                  </ul>
                </div>
              </div>

              {/* Modal footer */}
              <div className="px-5 py-3 border-t border-border shrink-0">
                <Button size="sm" onClick={() => setHelpOpen(false)} className="w-full">Got it</Button>
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-border" />

        {/* Co-Work */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">Co-Work</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Let co-authors or students join your project over your local network.
            Each person gets a named invitation link. A restart is required to change the bind address.
          </p>

          {/* Enable toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium">Enable Co-Work mode</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Binds the server to <code className="font-mono text-[11px]">0.0.0.0</code> so guests can connect.
                {coworkEnabled && coworkInfo && (
                  <span className="ml-1 text-primary">
                    LAN: <code className="font-mono text-[11px]">{coworkInfo.lan_url}</code>
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={coworkEnabled}
              disabled={coworkToggleBusy}
              onClick={() => handleCoworkToggle(!coworkEnabled)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50",
                coworkEnabled ? "bg-primary" : "bg-input"
              )}
            >
              <span className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-lg ring-0 transition-transform",
                coworkEnabled ? "translate-x-4" : "translate-x-0"
              )} />
            </button>
          </div>

          {coworkEnabled && (
            <>
              {/* Network info */}
              {coworkInfo && (
                <div className="rounded-md bg-muted/40 border border-border px-3 py-2 flex items-center gap-3 text-xs">
                  <Link2 className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="text-muted-foreground">LAN URL:</span>
                  <code className="font-mono text-[11px] text-foreground flex-1">{coworkInfo.lan_url}/join?token=…</code>
                  <span className="text-muted-foreground">{coworkInfo.active_sessions} active</span>
                </div>
              )}

              {/* Internet Access — UPnP */}
              <div className="rounded-lg border border-border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-sm font-medium">Internet Access</p>
                    <span className="text-[10px] px-1.5 py-0.5 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 rounded-full font-medium shrink-0">
                      UPnP · experimental
                    </span>
                  </div>
                  {upnpStatus?.active && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active
                    </span>
                  )}
                </div>

                {/* Disclaimer — shown until accepted */}
                {upnpStatus && !upnpStatus.disclaimer_accepted && (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground rounded-md border border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-950/20 p-3 space-y-2">
                      <p className="font-semibold text-orange-700 dark:text-orange-400">⚠ Read before enabling</p>
                      <p>
                        UPnP asks your router to open a public port so guests outside your home network can
                        join. This exposes the Foliantica service to the internet.
                      </p>
                      <div>
                        <p className="font-medium text-foreground mb-1">Risks</p>
                        <ul className="list-disc list-inside space-y-1">
                          <li>Traffic is <strong>unencrypted (HTTP, not HTTPS)</strong> — everything
                              sent over the internet is visible to your ISP and network observers.</li>
                          <li>Your public IP address and port become reachable by anyone on the internet,
                              including automated scanners and bots.</li>
                          <li>UPnP support varies by router. Some routers have known UPnP
                              vulnerabilities — consult your router documentation.</li>
                          <li>If the app is hard-killed (power loss, crash), the port mapping may
                              remain open until your router is restarted. The app cleans up properly
                              on normal shutdown.</li>
                          <li>Your public IP may change (DHCP), invalidating existing invite links.</li>
                        </ul>
                      </div>
                      <div>
                        <p className="font-medium text-foreground mb-1">Protections in place</p>
                        <ul className="list-disc list-inside space-y-1">
                          <li>Every guest requires a valid invitation token.</li>
                          <li>Optional PIN adds a second factor.</li>
                          <li>One failed auth attempt triggers a 5-minute IP ban.</li>
                          <li>You can revoke any invitation instantly.</li>
                        </ul>
                      </div>
                      <p className="font-semibold text-orange-700 dark:text-orange-400">
                        Use at your own risk. Foliantica provides no warranty for internet-facing deployments.
                      </p>
                    </div>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5 shrink-0"
                        checked={upnpRiskChecked}
                        onChange={e => setUpnpRiskChecked(e.target.checked)}
                      />
                      <span className="text-xs text-muted-foreground">
                        I have read and understood the risks above. I accept full responsibility
                        for enabling internet access and will use strong PINs.
                      </span>
                    </label>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!upnpRiskChecked}
                      onClick={handleUpnpAcceptDisclaimer}
                      className="border-orange-300 dark:border-orange-700"
                    >
                      I accept — show internet access controls
                    </Button>
                  </div>
                )}

                {/* Controls — shown after disclaimer accepted */}
                {upnpStatus?.disclaimer_accepted && (
                  <div className="space-y-2">
                    {upnpStatus.active && upnpStatus.external_url && (
                      <div className="flex items-center gap-2 rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 px-3 py-2 text-xs">
                        <span className="text-muted-foreground shrink-0">External URL:</span>
                        <code className="flex-1 font-mono text-[11px] text-foreground truncate">
                          {upnpStatus.external_url}/join?token=…
                        </code>
                        <button
                          onClick={() => navigator.clipboard.writeText(upnpStatus.external_url!).catch(() => {})}
                          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          title="Copy base URL"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    {upnpError && (
                      <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">{upnpError}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant={upnpStatus.active ? "destructive" : "outline"}
                        onClick={upnpStatus.active ? handleUpnpClose : handleUpnpOpen}
                        disabled={upnpBusy}
                      >
                        {upnpBusy
                          ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Working…</>
                          : upnpStatus.active ? "Close port" : "Open port"
                        }
                      </Button>
                      {!upnpStatus.active && (
                        <p className="text-[11px] text-muted-foreground">
                          Opens ports {/* show them once available from status */}
                          on your router via UPnP.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Internet Access — Cloudflare Tunnel */}
              <div className="rounded-lg border border-border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-sm font-medium">Cloudflare Tunnel</p>
                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded-full font-medium shrink-0">
                      HTTPS · recommended
                    </span>
                  </div>
                  {cfStatus?.active && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Creates an encrypted HTTPS tunnel via Cloudflare&apos;s network — no router
                  configuration or port forwarding needed. Requires{" "}
                  <a
                    href="https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    cloudflared
                  </a>{" "}
                  to be installed. Traffic passes through Cloudflare servers.
                </p>
                {cfStatus?.active && cfStatus.url && (
                  <div className="flex items-center gap-2 rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 px-3 py-2 text-xs">
                    <span className="text-muted-foreground shrink-0">Tunnel URL:</span>
                    <code className="flex-1 font-mono text-[11px] text-foreground truncate">
                      {cfStatus.url}/join?token=…
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(cfStatus.url!).catch(() => {})}
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      title="Copy base URL"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {cfError && (
                  <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">{cfError}</p>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={cfStatus?.active ? "destructive" : "outline"}
                    onClick={cfStatus?.active ? handleCfClose : handleCfOpen}
                    disabled={cfBusy || !cfStatus}
                  >
                    {cfBusy
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />{cfStatus?.active ? "Closing…" : "Starting…"}</>
                      : cfStatus?.active ? "Close tunnel" : "Open tunnel"
                    }
                  </Button>
                </div>
              </div>

              {/* Invitations list */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Invitations</p>
                {invitations.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No invitations yet.</p>
                )}
                {invitations.map(inv => (
                  <div key={inv.id} className="rounded-lg border border-border p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{inv.name}</span>
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0",
                          inv.role === "student" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                                 : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                        )}>
                          {inv.role === "student" ? "Student" : "Co-Author"}
                        </span>
                        {inv.has_pin && <ShieldCheck className="h-3 w-3 text-muted-foreground shrink-0" aria-label="PIN required" />}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <p className="text-[11px] text-muted-foreground">
                          max {inv.max_sessions} session{inv.max_sessions !== 1 ? "s" : ""}
                        </p>
                        {inv.role === "student" && (
                          <p className="text-[11px] text-muted-foreground">
                            {inv.assigned_items.length > 0
                              ? `${inv.assigned_items.length} scene${inv.assigned_items.length !== 1 ? "s" : ""} assigned`
                              : <span className="text-amber-600 dark:text-amber-400">no scenes assigned</span>}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Assign scenes button — students only */}
                    {inv.role === "student" && (
                      <button
                        onClick={() => setAssigningInv(inv)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        title="Assign scenes"
                      >
                        <ListChecks className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleCopyLink(inv.id)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      title="Copy join link"
                    >
                      {copiedInvId === inv.id
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => handleDeleteInvitation(inv.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      title="Revoke invitation"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* New invitation form */}
              <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">New invitation</p>
                <div className="flex gap-2">
                  <Input
                    value={newInvName}
                    onChange={e => setNewInvName(e.target.value)}
                    placeholder="Name  (e.g. Alice, Student Group A)"
                    className="text-xs h-8 flex-1"
                    onKeyDown={e => e.key === "Enter" && handleCreateInvitation()}
                  />
                  <select
                    value={newInvRole}
                    onChange={e => setNewInvRole(e.target.value as "coauthor" | "student")}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="coauthor">Co-Author</option>
                    <option value="student">Student</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newInvPin}
                    onChange={e => setNewInvPin(e.target.value)}
                    placeholder="PIN (optional)"
                    type="password"
                    className="text-xs h-8 flex-1"
                  />
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Max</span>
                    <Input
                      type="number"
                      min={1} max={20}
                      value={newInvMaxSessions}
                      onChange={e => setNewInvMaxSessions(Number(e.target.value))}
                      className="text-xs h-8 w-16 text-center"
                    />
                  </div>
                  <Button size="sm" className="h-8 shrink-0" onClick={handleCreateInvitation} disabled={coworkLoading || !newInvName.trim()}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-md px-3 py-2">
                <strong className="text-amber-700 dark:text-amber-400">Restart required</strong> — changes to Co-Work mode take effect after restarting the app.
                Internet access (UPnP) coming in a later update.
              </p>

              {/* Teacher view — live sessions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Live sessions</p>
                  <button
                    onClick={loadTeacherView}
                    disabled={teacherLoading}
                    className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                    title="Refresh"
                  >
                    <RefreshCw className={cn("h-3 w-3", teacherLoading && "animate-spin")} />
                  </button>
                </div>
                {teacherSessions.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No active sessions.</p>
                ) : (
                  teacherSessions.map(sess => (
                    <div key={sess.session_id} className="rounded-lg border border-border p-2.5 flex items-center gap-3">
                      <span
                        className="h-6 w-6 rounded-full shrink-0 inline-flex items-center justify-center text-[9px] font-bold text-white"
                        style={{ backgroundColor: sess.color }}
                      >
                        {sess.display_name.split(/\s+/).map((w: string) => w[0]?.toUpperCase() ?? "").slice(0, 2).join("")}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium truncate">{sess.display_name}</span>
                          <span className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0",
                            sess.role === "student"
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                          )}>
                            {sess.role === "student" ? "Student" : "Co-Author"}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {sess.item_type === "scene" && sess.item_id != null
                            ? `Viewing a scene`
                            : "Browsing"}
                          {sess.role === "student" && sess.assigned_items.length > 0
                            ? ` · ${sess.assigned_items.length} scene${sess.assigned_items.length !== 1 ? "s" : ""} assigned`
                            : ""}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* Assignment picker modal */}
          {assigningInv && (
            <AssignmentPicker
              invitationId={assigningInv.id}
              invitationName={assigningInv.name}
              current={assigningInv.assigned_items}
              onClose={() => setAssigningInv(null)}
              onSaved={(items) => {
                setInvitations(prev =>
                  prev.map(i => i.id === assigningInv.id ? { ...i, assigned_items: items } : i)
                );
              }}
            />
          )}
        </section>

        <div className="border-t border-border" />

        {/* Language */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{t("settings_language")}</h2>
          </div>
          <div className="space-y-1.5">
            <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              <SelectTrigger className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(LOCALE_NAMES) as [Locale, string][]).map(([code, name]) => (
                  <SelectItem key={code} value={code}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        <div className="border-t border-border" />

        {/* About */}
        <section className="space-y-2 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t("settings_about_title")}</p>
          <p>{t("settings_about_desc")}</p>
        </section>

        <Button onClick={handleSave} disabled={updateSettings.isPending}>
          {saved ? t("settings_saved") : updateSettings.isPending ? t("settings_saving") : t("settings_save")}
        </Button>
      </main>
    </div>
  );
}
