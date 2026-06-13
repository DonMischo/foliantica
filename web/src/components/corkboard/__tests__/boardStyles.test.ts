import { describe, it, expect } from "vitest";
import { BOARD_STYLES } from "../boardStyles";

describe("BOARD_STYLES — isDark", () => {
  it("every style defines isDark as a boolean", () => {
    for (const style of BOARD_STYLES) {
      expect(typeof style.isDark).toBe("boolean");
    }
  });

  it("light themes (Manuscript, Cork) have isDark = false", () => {
    const light = BOARD_STYLES.filter((s) => s.id === "manuscript" || s.id === "cork");
    expect(light).toHaveLength(2);
    light.forEach((s) => expect(s.isDark).toBe(false));
  });

  it("dark themes (Default, Noir, Blueprint) have isDark = true", () => {
    const dark = BOARD_STYLES.filter((s) => ["default", "noir", "blueprint"].includes(s.id));
    expect(dark).toHaveLength(3);
    dark.forEach((s) => expect(s.isDark).toBe(true));
  });

  it("all 5 canonical styles are present", () => {
    const ids = BOARD_STYLES.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["default", "manuscript", "noir", "blueprint", "cork"]));
    expect(ids).toHaveLength(5);
  });
});
