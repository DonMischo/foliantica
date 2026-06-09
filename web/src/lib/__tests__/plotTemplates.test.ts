import { describe, it, expect } from "vitest";
import { PLOT_TEMPLATES } from "../plotTemplates";

describe("PLOT_TEMPLATES", () => {
  it("contains exactly 3 templates", () => {
    expect(PLOT_TEMPLATES.length).toBe(3);
  });

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

  it("'Save the Cat' implements Blake Snyder's 15-beat structure", () => {
    const stc = PLOT_TEMPLATES.find((t) => t.id === "save-the-cat");
    // Snyder's canon: Opening Image, Theme Stated, Set-Up, Catalyst, Debate,
    // Break into Two, B Story, Fun & Games, Midpoint, Bad Guys Close In,
    // All Is Lost, Dark Night of the Soul, Break into Three, Finale, Final Image
    expect(stc?.beats.length).toBe(15);
  });

  it("'Hero's Journey' implements Vogler's 12-stage monomyth", () => {
    const hj = PLOT_TEMPLATES.find((t) => t.id === "heros-journey");
    // Vogler's adaptation of Campbell: Ordinary World, Call to Adventure, Refusal,
    // Meeting the Mentor, Crossing the Threshold, Tests/Allies/Enemies,
    // Approach, Ordeal, Reward, Road Back, Resurrection, Return with Elixir
    expect(hj?.beats.length).toBe(12);
  });

  it("'Seven-Point Structure' implements Dan Wells's 7 plot points", () => {
    const sp = PLOT_TEMPLATES.find((t) => t.id === "seven-point");
    // Wells's structure: Hook, Plot Turn 1, Pinch 1, Midpoint,
    // Pinch 2, Plot Turn 2, Resolution
    expect(sp?.beats.length).toBe(7);
  });
});
