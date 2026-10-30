import { describe, it, expect } from "vitest";
import { PLOT_TEMPLATES } from "../plotTemplates";

// Every template follows a published structure, so its beat count is canon
// rather than an arbitrary number. Add a row here when a template is added —
// the roster test then fails until it is registered, and vice versa.
const CANONICAL_BEATS: Record<string, number> = {
  "save-the-cat": 15,    // Snyder: Opening Image → Final Image
  "heros-journey": 12,   // Vogler's adaptation of Campbell's monomyth
  "seven-point": 7,      // Dan Wells: Hook → Resolution
  "three-act": 3,        // Setup, Confrontation, Resolution
  "eight-point-arc": 8,  // Nigel Watts: Stasis → Resolution
  "snowflake": 10,       // Randy Ingermanson's ten design steps
  "freytag": 5,          // Exposition → Dénouement
};

describe("PLOT_TEMPLATES", () => {
  it("registers exactly the templates listed as canon", () => {
    expect(PLOT_TEMPLATES.map((t) => t.id).sort()).toEqual(Object.keys(CANONICAL_BEATS).sort());
  });

  it.each(Object.entries(CANONICAL_BEATS))(
    "%s keeps its canonical beat count of %i",
    (id, expected) => {
      expect(PLOT_TEMPLATES.find((t) => t.id === id)?.beats.length).toBe(expected);
    },
  );

  it("all templates have unique IDs", () => {
    const ids = PLOT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const template of PLOT_TEMPLATES) {
    describe(`template "${template.name}"`, () => {
      it("has at least one beat", () => {
        expect(template.beats.length).toBeGreaterThan(0);
      });

      it("all beat IDs are unique within the template", () => {
        const ids = template.beats.map((b) => b.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("all beat positions are in range [0, 100]", () => {
        for (const beat of template.beats) {
          expect(beat.position, `beat "${beat.name}" position out of range`).toBeGreaterThanOrEqual(0);
          expect(beat.position, `beat "${beat.name}" position out of range`).toBeLessThanOrEqual(100);
        }
      });

      it("all beat positions are unique within the template", () => {
        const positions = template.beats.map((b) => b.position);
        expect(new Set(positions).size).toBe(positions.length);
      });

      it("all beats have non-empty name and description", () => {
        for (const beat of template.beats) {
          expect(beat.name.length, `beat "${beat.id}" has empty name`).toBeGreaterThan(0);
          expect(beat.description.length, `beat "${beat.id}" has empty description`).toBeGreaterThan(0);
        }
      });
    });
  }

  it("beat order matches beat position in every template", () => {
    for (const template of PLOT_TEMPLATES) {
      const positions = template.beats.map((b) => b.position);
      expect(positions, `${template.name} lists beats out of order`).toEqual([...positions].sort((a, b) => a - b));
    }
  });
});
