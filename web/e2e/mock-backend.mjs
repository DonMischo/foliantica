/**
 * Lightweight mock backend for Playwright E2E tests.
 *
 * Runs on port 8000 (the default LW_API_PORT) so the Next.js dev-server proxy
 * has a target to forward requests to.  This handles server-side requests (SSR
 * pre-rendering, Next.js prefetching) that Playwright's page.route() cannot
 * intercept because they originate inside the Node.js process, not the browser.
 *
 * Browser-initiated API calls are intercepted earlier by page.route() handlers
 * registered in each spec file, so those requests never reach this server.
 */

import http from "node:http";

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

const PORT = process.env.LW_API_PORT ?? 8000;

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // Preflight
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Non-GET mutations → generic success
  if (method !== "GET") {
    res.writeHead(200);
    res.end('{"id":1}');
    return;
  }

  // GET routing ─────────────────────────────────────────────────────────────
  let body;

  if (url === "/api/settings") {
    body = JSON.stringify({ ai_disabled: false });
  } else if (url.includes("time-config")) {
    // page falls back to DEFAULT_TIME_CONFIG when data is null
    body = "null";
  } else if (/^\/api\/projects\/\d+$/.test(url)) {
    body = JSON.stringify(PROJECT);
  } else if (/^\/api\/scenes\/\d+$/.test(url)) {
    body = JSON.stringify(SCENE);
  } else {
    // Everything else (acts, codex, chapters, research, etc.) is a list
    body = "[]";
  }

  res.writeHead(200);
  res.end(body);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock backend ready on http://127.0.0.1:${PORT}`);
});
