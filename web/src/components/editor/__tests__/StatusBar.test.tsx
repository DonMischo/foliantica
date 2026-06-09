import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "../StatusBar";
import { useUIStore } from "@/store/ui";
import type { SaveStatus } from "@/types";

function renderStatusBar(wordCount = 0) {
  return render(<StatusBar sceneWordCount={wordCount} />);
}

beforeEach(() => {
  useUIStore.setState({
    saveStatus: "idle",
    sessionTimerEnabled: false,
    sessionGoal: null,
    sessionStartTime: null,
    sessionBaseWords: null,
  });
});

describe("StatusBar — word count display", () => {
  it("shows '0 words' for zero", () => {
    renderStatusBar(0);
    expect(screen.getByText("0 words")).toBeInTheDocument();
  });

  it("shows '1 word' for one", () => {
    renderStatusBar(1);
    expect(screen.getByText("1 word")).toBeInTheDocument();
  });

  it("shows plural for multiple words", () => {
    renderStatusBar(42);
    expect(screen.getByText("42 words")).toBeInTheDocument();
  });

  it("formats thousands as '1.0k words'", () => {
    renderStatusBar(1000);
    expect(screen.getByText("1.0k words")).toBeInTheDocument();
  });
});

describe("StatusBar — save status", () => {
  const cases: Array<{ status: SaveStatus; expectedText: string }> = [
    { status: "saved",  expectedText: "Saved" },
    { status: "saving", expectedText: "Saving…" },
    { status: "error",  expectedText: "Unsaved changes" },
  ];

  for (const { status, expectedText } of cases) {
    it(`shows "${expectedText}" when status is "${status}"`, () => {
      useUIStore.setState({ saveStatus: status });
      renderStatusBar(10);
      expect(screen.getByText(expectedText)).toBeInTheDocument();
    });
  }

  it("shows no label text when status is 'idle'", () => {
    useUIStore.setState({ saveStatus: "idle" });
    renderStatusBar(10);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });
});

describe("StatusBar — session timer", () => {
  it("does not show session progress bar when timer is disabled", () => {
    useUIStore.setState({ sessionTimerEnabled: false });
    renderStatusBar(100);
    // No elapsed time display like 00:00
    expect(screen.queryByText(/^\d{2}:\d{2}$/)).not.toBeInTheDocument();
  });

  it("shows session progress when timer is enabled with a goal", () => {
    useUIStore.setState({
      sessionTimerEnabled: true,
      sessionGoal: 500,
      sessionStartTime: Date.now(),
      sessionBaseWords: 100,
    });
    renderStatusBar(200);
    // Shows timer in mm:ss format
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
    // Shows word progress: "100/500"
    expect(screen.getByText("/500")).toBeInTheDocument();
  });
});
