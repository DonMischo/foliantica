import { describe, it, expect } from "vitest";
import { displayKey } from "../vale-utils";

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
