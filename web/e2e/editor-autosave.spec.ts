/**
 * E2E: autosave
 *
 * Intended behaviour under test: every time the user edits the scene, the
 * editor should call PATCH /api/scenes/:id with the updated HTML content after
 * a 1-second debounce.  This exercises the real TipTap → useAutosave pipeline
 * in a real browser; it cannot be replicated in jsdom.
 */

import { test, expect, type Page } from "@playwright/test";

// Minimal fixtures ─────────────────────────────────────────────────────────

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

// ── shared mock setup ──────────────────────────────────────────────────────

/**
 * Intercepts browser-level API GET requests (via Playwright's CDP interception)
 * so the scene editor page can fully hydrate in the test browser.
 *
 * Server-side requests (Next.js SSR / prefetch) are handled by the mock backend
 * started in playwright.config.ts; they never reach this handler.
 *
 * Caller may register additional, more-specific route handlers AFTER this call;
 * Playwright applies routes LIFO, so those handlers take priority.
 */
async function stubGetApis(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // Non-GET mutations → generic success (autosave PATCH is captured separately)
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
      // null → page falls back to DEFAULT_TIME_CONFIG
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

    // Default: return an empty array.  Most endpoints (acts, codex, chapters,
    // research, fragments, etc.) return lists; returning [] avoids the crash
    // that happens when components do data.map() on null.
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });
}

// ── tests ──────────────────────────────────────────────────────────────────

test(
  "typed content is persisted via PATCH /api/scenes/:id after the debounce",
  async ({ page }) => {
    // Register catch-all mocks first (lowest priority, runs last).
    await stubGetApis(page);

    // Register a scene-specific route AFTER stubGetApis; Playwright applies
    // routes LIFO, so this handler runs before the catch-all above and can
    // intercept both the initial GET and all subsequent PATCH requests.
    let lastPatchContent = "";
    await page.route(/\/api\/scenes\/1(\?.*)?$/, async (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON() as { content?: string };
        if (body?.content !== undefined) lastPatchContent = body.content;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: 1 }),
        });
      }
      // GET — return the scene fixture
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SCENE),
      });
    });

    await page.goto("/projects/1/scenes/1");

    // Wait for TipTap's ProseMirror contenteditable to appear.
    const editor = page.locator(".ProseMirror");
    await editor.waitFor({ state: "visible" });
    await editor.click();

    await page.keyboard.type("Hello Playwright");

    // useAutosave debounces for 1 000 ms.  expect.poll retries the assertion
    // until it passes (or the timeout expires), handling any timing variance
    // without a hard sleep.
    await expect
      .poll(() => lastPatchContent, { timeout: 10_000 })
      .toContain("Hello Playwright");
  },
);
