import { describe, it, expect, afterEach } from "vitest";
import { translate, LOCALE_NAMES, translations } from "../i18n";
import type { Locale } from "../i18n";

describe("LOCALE_NAMES", () => {
  it("has entries for all 9 supported locales", () => {
    const expected: Locale[] = ["en", "de", "es", "fr", "pt", "sv", "da", "no", "zh"];
    for (const locale of expected) {
      expect(LOCALE_NAMES[locale], `missing name for locale "${locale}"`).toBeTruthy();
    }
    expect(Object.keys(LOCALE_NAMES).length).toBe(9);
  });

  it("English locale name is 'English'", () => {
    expect(LOCALE_NAMES.en).toBe("English");
  });
});

describe("translate", () => {
  it("returns the English value for a known key", () => {
    expect(translate("en", "common_cancel")).toBe("Cancel");
  });

  it("returns the German value when locale is 'de'", () => {
    expect(translate("de", "common_cancel")).toBe("Abbrechen");
  });

  it("falls back to English when the key is missing from the target locale", () => {
    // Add a key only to `en` so we can exercise the en-fallback path.
    translations.en["_test_en_only"] = "English only value";
    try {
      expect(translate("de", "_test_en_only")).toBe("English only value");
      expect(translate("zh", "_test_en_only")).toBe("English only value");
    } finally {
      delete translations.en["_test_en_only"];
    }
  });

  it("falls back to the key string if the key is not in any locale", () => {
    const key = "nonexistent_key_xyz";
    expect(translate("en", key)).toBe(key);
    expect(translate("de", key)).toBe(key);
  });

  it("performs variable interpolation", () => {
    // dash_delete_warning contains {title}
    const result = translate("en", "dash_delete_warning", { title: "My Novel" });
    expect(result).toContain("My Novel");
    expect(result).not.toContain("{title}");
  });

  it("replaces multiple distinct placeholders in a single string", () => {
    translations.en["_test_multi"] = "Hello {first} and {second}!";
    try {
      const result = translate("en", "_test_multi", { first: "Alice", second: "Bob" });
      expect(result).toBe("Hello Alice and Bob!");
    } finally {
      delete translations.en["_test_multi"];
    }
  });

  it("leaves unmatched placeholders intact", () => {
    const result = translate("en", "dash_delete_warning", { other: "X" });
    // {title} was not replaced — should still contain it
    expect(result).toContain("{title}");
  });

  it("German interpolation replaces {title}", () => {
    const result = translate("de", "dash_delete_warning", { title: "MeinRoman" });
    expect(result).toContain("MeinRoman");
    expect(result).not.toContain("{title}");
  });
});
