import { create } from "zustand";
import type { SaveStatus } from "@/types";
import type { Settings } from "@/types";

interface UIState {
  sidebarOpen: boolean;
  codexSidebarOpen: boolean;
  saveStatus: SaveStatus;
  showParagraphNumbers: boolean;
  typewriterMode: boolean;
  typewriterOffset: number;   // 0-100, vertical % position for cursor
  focusMode: boolean;
  showCodexHighlights: boolean;
  autosaveInterval: number;   // scene editor autosave period, seconds
  // Session timer
  sessionTimerEnabled: boolean;
  sessionGoal: number | null;       // target word delta for this session
  sessionStartTime: number | null;  // Date.now() when session began
  sessionBaseWords: number | null;  // word count at session start
  setSidebarOpen: (open: boolean) => void;
  setCodexSidebarOpen: (open: boolean) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setShowParagraphNumbers: (show: boolean) => void;
  setTypewriterMode: (on: boolean) => void;
  setTypewriterOffset: (pct: number) => void;
  setFocusMode: (on: boolean) => void;
  setShowCodexHighlights: (on: boolean) => void;
  setAutosaveInterval: (seconds: number) => void;
  setSessionTimerEnabled: (on: boolean) => void;
  setSessionGoal: (goal: number, baseWords: number) => void;
  clearSession: () => void;
  /** Called once after settings load from DB to hydrate UI prefs. */
  initFromSettings: (s: Pick<Settings, "show_paragraph_numbers" | "typewriter_mode" | "typewriter_offset" | "session_timer_enabled" | "codex_highlight_enabled" | "autosave_interval">) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  codexSidebarOpen: false,
  saveStatus: "idle",
  showParagraphNumbers: false,
  typewriterMode: false,
  typewriterOffset: 50,
  focusMode: false,
  showCodexHighlights: true,
  autosaveInterval: 30,
  sessionTimerEnabled: true,
  sessionGoal: null,
  sessionStartTime: null,
  sessionBaseWords: null,

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setCodexSidebarOpen: (open) => set({ codexSidebarOpen: open }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setShowParagraphNumbers: (show) => set({ showParagraphNumbers: show }),
  setTypewriterMode: (on) => set({ typewriterMode: on }),
  setTypewriterOffset: (pct) => set({ typewriterOffset: pct }),
  setFocusMode: (on) => set({ focusMode: on }),
  setShowCodexHighlights: (on) => set({ showCodexHighlights: on }),
  setAutosaveInterval: (seconds) => set({ autosaveInterval: seconds }),
  setSessionTimerEnabled: (on) =>
    set({ sessionTimerEnabled: on, sessionGoal: null, sessionStartTime: null, sessionBaseWords: null }),
  setSessionGoal: (goal, baseWords) =>
    set({ sessionGoal: goal, sessionStartTime: Date.now(), sessionBaseWords: baseWords }),
  clearSession: () =>
    set({ sessionGoal: null, sessionStartTime: null, sessionBaseWords: null }),
  initFromSettings: (s) =>
    set({
      showParagraphNumbers: s.show_paragraph_numbers,
      typewriterMode:       s.typewriter_mode,
      typewriterOffset:     s.typewriter_offset,
      sessionTimerEnabled:  s.session_timer_enabled,
      showCodexHighlights:  s.codex_highlight_enabled,
      autosaveInterval:     s.autosave_interval,
    }),
}));
