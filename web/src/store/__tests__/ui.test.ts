import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "../ui";

const DEFAULTS = {
  sidebarOpen: true,
  codexSidebarOpen: false,
  saveStatus: "idle" as const,
  showParagraphNumbers: false,
  typewriterMode: false,
  typewriterOffset: 50,
  focusMode: false,
  sessionTimerEnabled: true,
  sessionGoal: null,
  sessionStartTime: null,
  sessionBaseWords: null,
};

beforeEach(() => useUIStore.setState(DEFAULTS));

// ── Simple setters ───────────────────────────────────────────────────────────

describe("UIStore — simple setters", () => {
  it("setSidebarOpen toggles the sidebar", () => {
    useUIStore.getState().setSidebarOpen(false);
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    useUIStore.getState().setSidebarOpen(true);
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it("setCodexSidebarOpen toggles the codex sidebar", () => {
    useUIStore.getState().setCodexSidebarOpen(true);
    expect(useUIStore.getState().codexSidebarOpen).toBe(true);
  });

  it("setSaveStatus sets the status", () => {
    useUIStore.getState().setSaveStatus("saving");
    expect(useUIStore.getState().saveStatus).toBe("saving");
    useUIStore.getState().setSaveStatus("saved");
    expect(useUIStore.getState().saveStatus).toBe("saved");
  });

  it("setShowParagraphNumbers toggles paragraph numbers", () => {
    useUIStore.getState().setShowParagraphNumbers(true);
    expect(useUIStore.getState().showParagraphNumbers).toBe(true);
  });

  it("setTypewriterMode toggles typewriter mode", () => {
    useUIStore.getState().setTypewriterMode(true);
    expect(useUIStore.getState().typewriterMode).toBe(true);
  });

  it("setTypewriterOffset sets the offset value", () => {
    useUIStore.getState().setTypewriterOffset(25);
    expect(useUIStore.getState().typewriterOffset).toBe(25);
  });

  it("setFocusMode toggles focus mode", () => {
    useUIStore.getState().setFocusMode(true);
    expect(useUIStore.getState().focusMode).toBe(true);
  });

  it("setShowCodexHighlights toggles codex highlights", () => {
    useUIStore.getState().setShowCodexHighlights(false);
    expect(useUIStore.getState().showCodexHighlights).toBe(false);
  });
});

// ── Session timer ─────────────────────────────────────────────────────────────

describe("UIStore — session timer", () => {
  it("setSessionGoal records the goal, base word count, and a start timestamp", () => {
    const before = Date.now();
    useUIStore.getState().setSessionGoal(500, 1234);
    const { sessionGoal, sessionStartTime, sessionBaseWords } = useUIStore.getState();
    expect(sessionGoal).toBe(500);
    expect(sessionBaseWords).toBe(1234);
    expect(sessionStartTime).toBeGreaterThanOrEqual(before);
    expect(sessionStartTime).toBeLessThanOrEqual(Date.now());
  });

  it("clearSession nulls the in-progress session without touching sidebar or focus state", () => {
    useUIStore.getState().setSessionGoal(300, 100);
    useUIStore.setState({ sidebarOpen: false, focusMode: true });
    useUIStore.getState().clearSession();
    const s = useUIStore.getState();
    expect(s.sessionGoal).toBeNull();
    expect(s.sessionStartTime).toBeNull();
    expect(s.sessionBaseWords).toBeNull();
    // unrelated state must survive
    expect(s.sidebarOpen).toBe(false);
    expect(s.focusMode).toBe(true);
  });

  it("setSessionTimerEnabled(false) cancels any in-progress session", () => {
    useUIStore.getState().setSessionGoal(500, 1234);
    useUIStore.getState().setSessionTimerEnabled(false);
    const { sessionTimerEnabled, sessionGoal, sessionStartTime, sessionBaseWords } =
      useUIStore.getState();
    expect(sessionTimerEnabled).toBe(false);
    expect(sessionGoal).toBeNull();
    expect(sessionStartTime).toBeNull();
    expect(sessionBaseWords).toBeNull();
  });

  it("setSessionTimerEnabled(true) does not start a session on its own", () => {
    useUIStore.getState().setSessionTimerEnabled(true);
    const { sessionGoal, sessionStartTime } = useUIStore.getState();
    expect(sessionGoal).toBeNull();
    expect(sessionStartTime).toBeNull();
  });
});

// ── Settings hydration ────────────────────────────────────────────────────────

describe("UIStore — settings hydration", () => {
  it("initFromSettings applies the six DB-backed preferences", () => {
    useUIStore.getState().initFromSettings({
      show_paragraph_numbers: true,
      typewriter_mode: true,
      typewriter_offset: 30,
      session_timer_enabled: false,
      codex_highlight_enabled: false,
      autosave_interval: 120,
    });
    const s = useUIStore.getState();
    expect(s.showParagraphNumbers).toBe(true);
    expect(s.typewriterMode).toBe(true);
    expect(s.typewriterOffset).toBe(30);
    expect(s.sessionTimerEnabled).toBe(false);
    expect(s.showCodexHighlights).toBe(false);
    expect(s.autosaveInterval).toBe(120);
  });

  it("initFromSettings does not touch focusMode, sidebarOpen, or saveStatus", () => {
    useUIStore.setState({ focusMode: true, sidebarOpen: false, saveStatus: "saving" });
    useUIStore.getState().initFromSettings({
      show_paragraph_numbers: false,
      typewriter_mode: false,
      typewriter_offset: 50,
      session_timer_enabled: true,
      codex_highlight_enabled: true,
      autosave_interval: 30,
    });
    const s = useUIStore.getState();
    expect(s.focusMode).toBe(true);
    expect(s.sidebarOpen).toBe(false);
    expect(s.saveStatus).toBe("saving");
  });

  it("typewriterOffset is stored as the exact value passed from settings", () => {
    useUIStore.getState().initFromSettings({
      show_paragraph_numbers: false,
      typewriter_mode: false,
      typewriter_offset: 75,
      session_timer_enabled: true,
      codex_highlight_enabled: true,
      autosave_interval: 30,
    });
    expect(useUIStore.getState().typewriterOffset).toBe(75);
  });
});
