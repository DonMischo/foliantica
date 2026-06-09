import { describe, it, expect } from "vitest";
import { generateName, NAME_TYPE_LABELS, NAME_TYPES } from "../nameGenerator";
import type { NameType } from "../nameGenerator";

describe("NAME_TYPE_LABELS", () => {
  it("has an entry for every NameType", () => {
    for (const type of NAME_TYPES) {
      expect(NAME_TYPE_LABELS[type], `missing label for "${type}"`).toBeTruthy();
    }
  });

  it("NAME_TYPES and NAME_TYPE_LABELS cover exactly the same set of types", () => {
    // Every type in the array must have a label, and there must be no extra labels
    // for types that aren't in the array. This is the semantic contract.
    const labelKeys = Object.keys(NAME_TYPE_LABELS) as NameType[];
    expect(new Set(labelKeys)).toEqual(new Set(NAME_TYPES));
  });

  it("all labels are non-empty strings", () => {
    for (const [type, label] of Object.entries(NAME_TYPE_LABELS)) {
      expect(typeof label, `label for "${type}" is not a string`).toBe("string");
      expect(label.length, `label for "${type}" is empty`).toBeGreaterThan(0);
    }
  });
});

describe("generateName", () => {
  it("returns an object with first and last strings", () => {
    const result = generateName("german");
    expect(typeof result.first).toBe("string");
    expect(typeof result.last).toBe("string");
  });

  it("returns non-empty strings", () => {
    const result = generateName("elvish");
    expect(result.first.length).toBeGreaterThan(0);
    expect(result.last.length).toBeGreaterThan(0);
  });

  it("first name starts with an uppercase letter", () => {
    // assemble() calls cap() which uppercases the first character
    for (let i = 0; i < 20; i++) {
      const { first } = generateName("nordic");
      expect(first[0]).toBe(first[0].toUpperCase());
    }
  });

  // Spot-check a range of different styles to ensure no type throws
  const stylesUnderTest: NameType[] = [
    "german", "nordic", "russian", "chinese", "japanese",
    "arabic", "french", "italian", "spanish", "celtic",
    "elvish", "dwarven", "orcish", "klingon", "fantasy",
    "droid", "robot", "cyberpunk_human", "steampunk_human",
    "scifi_human", "sw_twi_lek", "sw_mandalorian",
  ];

  for (const type of stylesUnderTest) {
    it(`generates a valid name for type "${type}"`, () => {
      expect(() => generateName(type)).not.toThrow();
      const { first, last } = generateName(type);
      expect(first.length).toBeGreaterThan(0);
      expect(last.length).toBeGreaterThan(0);
    });
  }
});
