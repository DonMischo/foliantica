/**
 * E2E: ghost-text (AI placeholder) input rule
 *
 * Intended behaviour under test: when the user types a bracketed token such as
 * [placeholder text], TipTap's GhostTextMark input rule fires and wraps the
 * token in a <span data-ghost="" class="ghost-text"> element.  This is a
 * purely client-side ProseMirror feature that cannot be unit-tested in jsdom.
 */

import { test, expect, type Page } from "@playwright/test";

// ── fixtures ───────────────────────────────────────────────────────────────

const SCENE = {
  id: 1,
  chapter_id: 1,
  title: "Test Scene",
  content: "",
  word_count: 0,
  synopsis: "",
  scene_time: null,
  order_index: 0,
};

const PROJECT = { id: 1, title: "Test Project", description: "" };

// ── shared API stubs ───────────────────────────────────────────────────────

/**
 * Intercepts browser-level API GET requests so the scene editor page can fully
 * hydrate.  Server-side requests (Next.js SSR / prefetch) are covered by the
 * mock backend launched in playwright.config.ts.
 */
async function stubGetApis(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (method !== "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"id":1}',
      });
    }

    if (url.includes("/api/settings")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ai_disabled: false }),
      });
    }
    if (url.includes("time-config")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "null",
      });
    }
    if (/\/api\/projects\/\d+$/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(PROJECT),
      });
    }
    if (/\/api\/scenes\/\d+$/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SCENE),
      });
    }

    // Default: empty list — avoids crashes in components that call .map() on data
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });
}

// ── tests ──────────────────────────────────────────────────────────────────

test(
  "typing [bracket text] applies the ghostText mark, rendering span[data-ghost]",
  async ({ page }) => {
    await stubGetApis(page);

    await page.goto("/projects/1/scenes/1");

    const editor = page.locator(".ProseMirror");
    await editor.waitFor({ state: "visible" });
    await editor.click();

    // The input rule is: /(\[[^\]]+\])$/ — fires when the user closes ]
    // completing a [token], and wraps it in the ghostText mark.
    await page.keyboard.type("[my placeholder]");

    // Verify the mark rendered as <span data-ghost="">.
    // In TipTap 3, markInputRule places the closing ] outside the mark
    // (it's the trigger character); the span content is the text up to ].
    const ghost = page.locator("span[data-ghost]");
    await expect(ghost).toBeVisible();
    await expect(ghost).toContainText("[my placeholder");
  },
);

test(
  "pressing Space after a ghost-text token exits the mark (plain space inserted outside)",
  async ({ page }) => {
    await stubGetApis(page);

    await page.goto("/projects/1/scenes/1");

    const editor = page.locator(".ProseMirror");
    await editor.waitFor({ state: "visible" });
    await editor.click();

    await page.keyboard.type("[draft]");
    await expect(page.locator("span[data-ghost]")).toBeVisible();

    // Pressing Space at the end of the mark should exit it.
    await page.keyboard.press("Space");

    // After the space, additional text must NOT be wrapped in the ghost mark.
    await page.keyboard.type("continued");

    // The word typed after the space should be outside any ghost-text span.
    // (The closing ] from [draft] is also outside the span in TipTap 3.)
    const ghostSpan = page.locator("span[data-ghost]");
    await expect(ghostSpan).toContainText("[draft");
    await expect(ghostSpan).not.toContainText("continued");
  },
);
