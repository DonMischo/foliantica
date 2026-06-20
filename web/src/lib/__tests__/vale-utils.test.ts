import { describe, it, expect } from "vitest";
import { displayKey, postProcessAlerts, computeValeSkipCount, countOccurrencesBefore } from "../vale-utils";
import type { ValeAlert } from "../api";

describe("displayKey", () => {
  it("strips \\b from both ends", () => {
    expect(displayKey("\\bgewissermaßen\\b")).toBe("gewissermaßen");
  });

  it("strips only a leading \\b", () => {
    expect(displayKey("\\bword")).toBe("word");
  });

  it("strips only a trailing \\b", () => {
    expect(displayKey("word\\b")).toBe("word");
  });

  it("leaves a plain token unchanged", () => {
    expect(displayKey("absolutely")).toBe("absolutely");
  });

  it("handles multi-word phrases", () => {
    expect(displayKey("\\bfoo bar\\b")).toBe("foo bar");
  });

  it("handles non-ASCII tokens", () => {
    expect(displayKey("\\bweißer Schimmel\\b")).toBe("weißer Schimmel");
  });

  it("returns an empty string unchanged", () => {
    expect(displayKey("")).toBe("");
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeAlert(overrides: Partial<ValeAlert> = {}): ValeAlert {
  return {
    Action: { Name: "replace", Params: [] },
    Check: "Vale.Repetition",
    Description: "",
    Line: 1,
    Link: "",
    Message: "Repeated word",
    Severity: "error",
    Span: [1, 3],
    Match: "die",
    ...overrides,
  };
}

// ── countOccurrencesBefore ────────────────────────────────────────────────────

describe("countOccurrencesBefore", () => {
  it("returns 0 when match not found", () => {
    expect(countOccurrencesBefore("hello world", "xyz", 100)).toBe(0);
  });

  it("returns 0 when the only occurrence is at beforeOffset", () => {
    // "die" starts at offset 0 — not before offset 0
    expect(countOccurrencesBefore("die Katze", "die", 0)).toBe(0);
  });

  it("counts one prior occurrence", () => {
    const text = "die Katze, die die Maus";
    // Third "die" starts at offset 15; two prior occurrences at 0 and 11
    expect(countOccurrencesBefore(text, "die", 15)).toBe(2);
  });

  it("counts zero when offset is before the first occurrence", () => {
    expect(countOccurrencesBefore("abc die", "die", 3)).toBe(0);
  });

  it("handles single-char match", () => {
    // "a b a b a": a(0) _(1) b(2) _(3) a(4)...
    // before offset 4: only the a at 0 qualifies → 1 occurrence
    expect(countOccurrencesBefore("a b a b a", "a", 4)).toBe(1);
  });

  it("empty matched string returns 0 without looping", () => {
    expect(countOccurrencesBefore("anything", "", 100)).toBe(0);
  });
});

// ── computeValeSkipCount ─────────────────────────────────────────────────────

describe("computeValeSkipCount", () => {
  it("skip 0 for first occurrence on line 1", () => {
    // text = "die Katze", alert at Line=1, Span=[1,3] → globalOffset=0 → 0 priors
    const text = "die Katze";
    const alert = makeAlert({ Line: 1, Span: [1, 3], Match: "die" });
    expect(computeValeSkipCount(text, alert)).toBe(0);
  });

  it("skip 1 for second occurrence on same line", () => {
    // "die die" — second "die" starts at col 5 (1-based)
    const text = "die die Maus";
    const alert = makeAlert({ Line: 1, Span: [5, 7], Match: "die" });
    expect(computeValeSkipCount(text, alert)).toBe(1);
  });

  it("computes global offset correctly across newlines", () => {
    // Line 1: "Clara ging.\n"  (12 chars + newline = 13)
    // Line 2: "die die Maus"  — second "die" at col 5 (1-based)
    const text = "Clara ging.\ndie die Maus";
    const alert = makeAlert({ Line: 2, Span: [5, 7], Match: "die" });
    // globalOffset = 13 + 4 = 17 (0-based start of second "die")
    // First "die" is at offset 12 — before 17 → skipCount=1
    expect(computeValeSkipCount(text, alert)).toBe(1);
  });

  it("skip 0 for first occurrence on second line", () => {
    const text = "Narration.\ndie Katze";
    const alert = makeAlert({ Line: 2, Span: [1, 3], Match: "die" });
    expect(computeValeSkipCount(text, alert)).toBe(0);
  });

  it("returns 0 for empty Match", () => {
    const text = "some text";
    const alert = makeAlert({ Line: 1, Span: [1, 1], Match: "" });
    expect(computeValeSkipCount(text, alert)).toBe(0);
  });
});

// ── postProcessAlerts ────────────────────────────────────────────────────────

describe("postProcessAlerts", () => {
  const text = "die Frauen, die die Bücher lesen";

  it("returns alerts unchanged for non-German language", () => {
    const alert = makeAlert({ Check: "Vale.Repetition", Match: "die", Span: [17, 19] });
    const result = postProcessAlerts([alert], text, "en");
    expect(result[0].Severity).toBe("error"); // unchanged
  });

  it("returns alerts unchanged for undefined language", () => {
    const alert = makeAlert({ Check: "Vale.Repetition", Match: "die", Span: [17, 19] });
    const result = postProcessAlerts([alert], text, undefined);
    expect(result[0].Severity).toBe("error");
  });

  it("downgrades German relative-clause repetition after comma to warning", () => {
    // text: "die Frauen, die die Bücher lesen"
    //         0123456789012345
    // Comma at col 10 (0-based), first repeated "die" at 0-based 12 → Span=[13,15] (1-based)
    // The comma check: offset=12, before=text.slice(0,12)="die Frauen, ",
    //   commaIdx=10, gap=before.slice(11)=" ", " ".trim()="" → downgrade
    const alert = makeAlert({
      Check: "Vale.Repetition",
      Match: "die",
      Severity: "error",
      Span: [13, 15],
    });
    const result = postProcessAlerts([alert], text, "de");
    expect(result[0].Severity).toBe("warning");
  });

  it("does not downgrade if no preceding comma", () => {
    const noCommaText = "die die Katze";
    // "die" starts at 0-based 4 → Span=[5,7]
    const alert = makeAlert({ Check: "Vale.Repetition", Match: "die", Span: [5, 7] });
    const result = postProcessAlerts([alert], noCommaText, "de");
    expect(result[0].Severity).toBe("error");
  });

  it("does not downgrade non-relative pronoun", () => {
    const text2 = "gut, gut gemacht";
    const alert = makeAlert({ Check: "Vale.Repetition", Match: "gut", Span: [6, 8] });
    const result = postProcessAlerts([alert], text2, "de");
    expect(result[0].Severity).toBe("error");
  });

  it("does not downgrade non-Repetition checks", () => {
    const alert = makeAlert({ Check: "write-good.Weasel", Match: "die", Severity: "warning" });
    const result = postProcessAlerts([alert], text, "de");
    expect(result[0].Severity).toBe("warning");
    expect(result[0].Check).toBe("write-good.Weasel");
  });

  it("passes through empty array", () => {
    expect(postProcessAlerts([], text, "de")).toEqual([]);
  });

  it("only modifies matching alerts, leaves others intact", () => {
    const repAlert = makeAlert({ Check: "Vale.Repetition", Match: "die", Severity: "error", Span: [13, 15] });
    const weaselAlert = makeAlert({ Check: "write-good.Weasel", Match: "sehr", Severity: "warning" });
    const result = postProcessAlerts([repAlert, weaselAlert], text, "de");
    expect(result[0].Severity).toBe("warning");  // downgraded
    expect(result[1].Severity).toBe("warning");  // unchanged weasel
    expect(result[1].Check).toBe("write-good.Weasel");
  });
});
