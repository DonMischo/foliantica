import { describe, it, expect } from "vitest";
import { cn, formatWordCount } from "../utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("deduplicates conflicting Tailwind classes (last wins)", () => {
    // twMerge resolves conflicts: p-4 then p-2 → p-2
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("filters out falsy values", () => {
    expect(cn("foo", false && "bar", null, undefined, "baz")).toBe("foo baz");
  });

  it("handles object syntax from clsx", () => {
    expect(cn({ foo: true, bar: false })).toBe("foo");
  });

  it("returns empty string for no arguments", () => {
    expect(cn()).toBe("");
  });
});

describe("formatWordCount", () => {
  it("returns singular 'word' for 1", () => {
    expect(formatWordCount(1)).toBe("1 word");
  });

  it("returns plural 'words' for 0", () => {
    expect(formatWordCount(0)).toBe("0 words");
  });

  it("returns plural 'words' for numbers > 1 below 1000", () => {
    expect(formatWordCount(42)).toBe("42 words");
    expect(formatWordCount(999)).toBe("999 words");
  });

  it("formats 1000 as '1.0k words'", () => {
    expect(formatWordCount(1000)).toBe("1.0k words");
  });

  it("formats 1500 as '1.5k words'", () => {
    expect(formatWordCount(1500)).toBe("1.5k words");
  });

  it("formats large numbers", () => {
    expect(formatWordCount(100_000)).toBe("100.0k words");
  });
});
