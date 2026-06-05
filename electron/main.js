"use strict";

const {
  app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Finds a free TCP port on 127.0.0.1. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/** Polls until the given port accepts connections (or times out). */
function waitForPort(port, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("timeout", retry);
      sock.once("error", retry);
      sock.connect(port, "127.0.0.1");
    };
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error(`Timed out waiting for port ${port}`));
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

// ── Config ────────────────────────────────────────────────────────────────────
// config.json always lives in the fixed OS userData folder.
// dataDir (where the DB and uploads live) can point elsewhere (e.g. Dropbox).

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}

function saveConfig(patch) {
  const updated = { ...loadConfig(), ...patch };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
}

// ── State ─────────────────────────────────────────────────────────────────────

const isProd   = app.isPackaged;
const config   = loadConfig();

// Shared config (~/.foliantica/config.json) — written by the settings UI.
const LW_CONFIG_PATH = path.join(require("os").homedir(), ".foliantica", "config.json");
function loadLwConfig() {
  try { return JSON.parse(fs.readFileSync(LW_CONFIG_PATH, "utf8")); } catch { return {}; }
}

const dataDir = loadLwConfig().dataDir || config.dataDir || app.getPath("userData");

// ── Logging ───────────────────────────────────────────────────────────────────
// Logs always go to the fixed OS userData folder so they're easy to find.
const logDir  = path.join(app.getPath("userData"), "logs");
const logFile = path.join(logDir, "startup.log");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch {}
}

function pipeToLog(proc, label) {
  proc.stdout?.on("data", d => log(`[${label}] ${d.toString().trim()}`));
  proc.stderr?.on("data", d => log(`[${label}] ERR: ${d.toString().trim()}`));
  proc.on("exit", code => log(`[${label}] exited with code ${code}`));
}

let mainWin   = null;
let splashWin = null;
let tray      = null;
let apiProc   = null;
let nextProc  = null;
let pgInstance = null;   // embedded-postgres instance

// ── Windows ───────────────────────────────────────────────────────────────────

function createSplash() {
  splashWin = new BrowserWindow({
    width: 440,
    height: 280,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWin.loadFile(path.join(__dirname, "splash.html"));
}

function createMain(webPort) {
  const savedWin = config.window || {};

  const winIcon = path.join(__dirname, "assets",
    process.platform === "win32" ? "icon.ico" : "icon.png");

  mainWin = new BrowserWindow({
    width:  savedWin.width  || 1400,
    height: savedWin.height || 900,
    // x/y undefined on first run → Electron centres the window automatically
    ...(savedWin.x != null && savedWin.y != null ? { x: savedWin.x, y: savedWin.y } : {}),
    minWidth: 900,
    minHeight: 600,
    show: false,
    icon: winIcon,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      spellcheck: true,
    },
  });

  if (savedWin.maximized) mainWin.maximize();

  mainWin.loadURL(`http://127.0.0.1:${webPort}`);

  mainWin.once("ready-to-show", () => {
    if (splashWin) { splashWin.close(); splashWin = null; }
    mainWin.show();
    mainWin.focus();
  });

  // ── Context menu (right-click) with spell suggestions ─────────────────────
  mainWin.webContents.on("context-menu", (_event, params) => {
    const items = [];

    if (params.misspelledWord) {
      if (params.dictionarySuggestions.length > 0) {
        for (const suggestion of params.dictionarySuggestions) {
          items.push({
            label: suggestion,
            click: () => mainWin.webContents.replaceMisspelling(suggestion),
          });
        }
      } else {
        items.push({ label: "No suggestions", enabled: false });
      }
      items.push({ type: "separator" });
      items.push({
        label: "Add to dictionary",
        click: () =>
          mainWin.webContents.session.addWordToSpellCheckerDictionary(
            params.misspelledWord
          ),
      });
      items.push({ type: "separator" });
    }

    // Standard editing actions — always present
    items.push(
      { role: "undo",      accelerator: "CmdOrCtrl+Z" },
      { role: "redo",      accelerator: "CmdOrCtrl+Y" },
      { type: "separator" },
      { role: "cut",       accelerator: "CmdOrCtrl+X" },
      { role: "copy",      accelerator: "CmdOrCtrl+C" },
      { role: "paste",     accelerator: "CmdOrCtrl+V" },
      { type: "separator" },
      { role: "selectAll", accelerator: "CmdOrCtrl+A" },
    );

    Menu.buildFromTemplate(items).popup({ window: mainWin });
  });

  // Persist window state before the window closes or hides.
  const persistBounds = () => {
    if (!mainWin || mainWin.isMinimized()) return;
    saveConfig({
      window: { ...mainWin.getNormalBounds(), maximized: mainWin.isMaximized() },
    });
  };

  // On macOS, closing the window hides it instead of quitting.
  mainWin.on("close", (e) => {
    persistBounds();
    if (process.platform === "darwin" && !app.isQuiting) {
      e.preventDefault();
      mainWin.hide();
    }
  });

  mainWin.on("closed", () => { mainWin = null; });
}

function createTray(webPort) {
  const iconFile = process.platform === "win32" ? "icon.ico" : "icon.png";
  const iconPath = path.join(__dirname, "assets", iconFile);
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip("Foliantica");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Foliantica", click: () => { mainWin?.show(); mainWin?.focus(); } },
    { type: "separator" },
    { label: "Quit", click: () => { app.isQuiting = true; app.quit(); } },
  ]));
  tray.on("double-click", () => { mainWin?.show(); mainWin?.focus(); });
}

// ── PostgreSQL (embedded) ─────────────────────────────────────────────────────

const PG_PORT = 5433;
const PG_USER = "foliantica";
const PG_PASS = "foliantica";
const PG_DB   = "foliantica";

/**
 * Start the embedded PostgreSQL sidecar.
 * Returns the pg_dump binary path so it can be forwarded to the API process.
 *
 * First run (~3 s for initdb): splash screen is updated to show progress.
 * Subsequent launches: ~1 s (PG starts from the existing cluster directory).
 */
async function startPostgres() {
  // If the user has configured Docker PG in ~/.foliantica/config.json,
  // skip the embedded cluster and return the custom connection details.
  const lwCfgForPg = loadLwConfig();
  if (lwCfgForPg.pg && lwCfgForPg.pg.useDocker) {
    const pg = lwCfgForPg.pg;
    log(`[pg] Docker PG mode — connecting to ${pg.host || "127.0.0.1"}:${pg.port || 5434}`);
    return {
      pgHost: pg.host || "127.0.0.1",
      pgPort: String(pg.port || 5434),
      pgUser: pg.user || "foliantica",
      pgPass: pg.pass || "foliantica",
      pgDb:   pg.db   || "foliantica",
    };
  }

  // Lazy-require so non-prod builds that lack the package don't break.
  let EmbeddedPostgres;
  try {
    // embedded-postgres is an ES module; require() returns the namespace object,
    // so the class lives on .default.
    EmbeddedPostgres = require("embedded-postgres").default;
  } catch {
    log("[pg] embedded-postgres not installed — skipping PG startup");
    return { pgDumpPath: "pg_dump" };
  }

  // pgdata must always be on a local drive — never in a cloud-synced dataDir.
  const pgDataDir = path.join(app.getPath("userData"), "pgdata");
  const isFirstRun = !fs.existsSync(pgDataDir);

  if (isFirstRun && splashWin) {
    splashWin.webContents
      .executeJavaScript('document.querySelector(".status").textContent = "Preparing database…";')
      .catch(() => {});
  }

  const pg = new EmbeddedPostgres({
    databaseDir: pgDataDir,
    user: PG_USER,
    password: PG_PASS,
    port: PG_PORT,
    persistent: true,
    // Force a UTF-8 cluster regardless of the OS locale.  Without this,
    // Windows initialises with WIN1252 and Unicode chars (e.g. ≤ in seed
    // descriptions) cause UntranslatableCharacter errors at runtime.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });

  log(`[pg] initialising cluster at ${pgDataDir} (first run: ${isFirstRun})`);
  await pg.initialise();      // runs initdb only on first launch (~3 s)
  await pg.start();           // starts postmaster (~1 s)
  try { await pg.createDatabase(PG_DB); } catch {}  // no-op if already exists

  pgInstance = pg;
  log("[pg] PostgreSQL ready");

  // ── One-time SQLite → PostgreSQL data migration ───────────────────────────
  // Triggered only when pgdata was just created (first run) and an existing
  // foliantica.db is present in the data directory.
  const sqliteDb = path.join(dataDir, "foliantica.db");
  if (isFirstRun && fs.existsSync(sqliteDb)) {
    log("[pg] First PG run detected with existing SQLite DB — starting migration");
    if (splashWin) {
      splashWin.webContents
        .executeJavaScript('document.querySelector(".status").textContent = "Migrating data…";')
        .catch(() => {});
    }
    const migrateScript = path.join(process.resourcesPath, "api", "scripts", "migrate_sqlite_to_pg.py");
    const pythonExe     = path.join(process.resourcesPath, "api",
      process.platform === "win32" ? "foliantica-api.exe" : "foliantica-api");
    // We spawn the migration script via the bundled Python interpreter.
    // The script exits 0 on success; non-zero on error.
    await new Promise((resolve) => {
      const migProc = spawn(pythonExe, [
        migrateScript,
        "--sqlite-path", sqliteDb,
        "--pg-port",  String(PG_PORT),
        "--pg-user",  PG_USER,
        "--pg-pass",  PG_PASS,
        "--pg-db",    PG_DB,
        "--keep-original",
      ], { stdio: ["ignore", "pipe", "pipe"] });
      pipeToLog(migProc, "migrate");
      migProc.on("exit", (code) => {
        if (code !== 0) log(`[migrate] WARNING: migration exited with code ${code}`);
        resolve();
      });
      migProc.on("error", (err) => {
        log(`[migrate] spawn error: ${err.message}`);
        resolve();
      });
    });
    log("[pg] Migration complete");
  }

  // Locate the pg_dump binary shipped with the embedded-postgres package.
  const embeddedPgRoot = path.join(__dirname, "..", "node_modules", "embedded-postgres");
  const binSubdir = process.platform === "win32" ? "bin/win32"
                  : process.platform === "darwin" ? "bin/darwin"
                  : "bin/linux";
  const pgDumpName = process.platform === "win32" ? "pg_dump.exe" : "pg_dump";
  const pgDumpPath = path.join(embeddedPgRoot, binSubdir, pgDumpName);

  return { pgDumpPath: fs.existsSync(pgDumpPath) ? pgDumpPath : "pg_dump" };
}

// ── Server startup ────────────────────────────────────────────────────────────

async function startServers() {
  const apiPort = await findFreePort();
  const webPort = await findFreePort();

  if (isProd) {
    // ── Embedded PostgreSQL ───────────────────────────────────────────────────
    const pgResult = await startPostgres();

    // ── FastAPI sidecar ───────────────────────────────────────────────────────
    const apiExe = path.join(
      process.resourcesPath, "api",
      process.platform === "win32" ? "foliantica-api.exe" : "foliantica-api"
    );
    log(`[api] exe path: ${apiExe}`);
    log(`[api] dataDir: ${dataDir}`);
    apiProc = spawn(apiExe, [], {
      env: {
        ...process.env,
        LW_API_PORT: String(apiPort),
        LW_API_HOST: "127.0.0.1",
        LW_DATA_DIR: dataDir,
        LW_RESOURCES_DIR: process.resourcesPath,
        // PostgreSQL connection — use Docker PG values if provided, else defaults
        LW_PG_HOST: pgResult.pgHost || "127.0.0.1",
        LW_PG_PORT: pgResult.pgPort || String(PG_PORT),
        LW_PG_USER: pgResult.pgUser || PG_USER,
        LW_PG_PASS: pgResult.pgPass || PG_PASS,
        LW_PG_DB:   pgResult.pgDb   || PG_DB,
        LW_PG_DUMP_PATH: pgResult.pgDumpPath || "pg_dump",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    pipeToLog(apiProc, "api");
    apiProc.on("error", (err) => log(`[api] spawn error: ${err.message}`));

    // ── Next.js standalone ────────────────────────────────────────────────────
    // ELECTRON_RUN_AS_NODE=1 makes Electron behave as plain Node.js,
    // allowing us to reuse the bundled runtime without shipping a separate node binary.
    const nextServer = path.join(process.resourcesPath, "web", "server.js");
    log(`[web] server path: ${nextServer}`);
    log(`[web] execPath: ${process.execPath}`);
    nextProc = spawn(
      process.execPath,
      [nextServer],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          PORT: String(webPort),
          HOSTNAME: "127.0.0.1",
          LW_API_PORT: String(apiPort),
          NODE_ENV: "production",
        },
        cwd: path.dirname(nextServer),
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    pipeToLog(nextProc, "web");
    nextProc.on("error", (err) => log(`[web] spawn error: ${err.message}`));

    // Wait for both servers to be ready before showing the window.
    log(`Waiting for api:${apiPort} and web:${webPort}...`);
    await Promise.all([waitForPort(apiPort), waitForPort(webPort)]);
    log("Both servers ready.");
  }

  return {
    apiPort: isProd ? apiPort : 8000,
    webPort: isProd ? webPort : 3000,
  };
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function killServers() {
  try { apiProc?.kill(); } catch {}
  try { nextProc?.kill(); } catch {}
  // pgInstance.stop() is async but fire-and-forget is fine here;
  // the OS will reap the postgres child process either way.
  try { pgInstance?.stop(); } catch {}
}

app.on("before-quit", killServers);
process.on("exit", killServers);

// ── IPC — data directory ──────────────────────────────────────────────────────

ipcMain.handle("lw:get-data-dir", () => {
  const cfg = loadConfig();
  return { path: cfg.dataDir || app.getPath("userData"), isCustom: !!cfg.dataDir };
});

ipcMain.handle("lw:pick-data-dir", async () => {
  const result = await dialog.showOpenDialog(mainWin, {
    properties: ["openDirectory", "createDirectory"],
    title: "Choose Foliantica Data Folder",
    buttonLabel: "Select Folder",
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("lw:set-data-dir", (_, newPath) => {
  const lwCfg = loadLwConfig();
  if (newPath) {
    lwCfg.dataDir = newPath;
  } else {
    delete lwCfg.dataDir;
  }
  fs.mkdirSync(path.dirname(LW_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(LW_CONFIG_PATH, JSON.stringify(lwCfg, null, 2));
  return true;
});

ipcMain.on("lw:restart", () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.on("lw:set-spellcheck-language", (_, lang) => {
  if (!mainWin) return;
  // Normalise: Electron expects BCP-47 tags like "en-US" or "de-DE".
  // Single-subtag codes (e.g. "en", "de") are expanded to their default locale.
  const TAG_MAP = {
    en: "en-US", de: "de-DE", fr: "fr-FR", es: "es-ES",
    it: "it-IT", pt: "pt-PT", nl: "nl-NL", pl: "pl-PL",
    ru: "ru-RU", ja: "ja-JP", zh: "zh-CN", ko: "ko-KR",
    ar: "ar-SA", sv: "sv-SE", da: "da-DK", no: "nb-NO",
  };
  const resolved = TAG_MAP[lang] ?? lang;
  try {
    mainWin.webContents.session.setSpellCheckerLanguages([resolved]);
  } catch (e) {
    // If the locale isn't available, fall back silently
  }
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  log(`Foliantica starting — isProd=${isProd} dataDir=${dataDir}`);
  createSplash();

  try {
    const { webPort, apiPort } = await startServers();
    createMain(webPort);
    createTray(webPort);

    if (isProd) {
      // Auto-updater — requires a `publish` config in electron-builder.yml.
      // Silently ignored if not configured.
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }
  } catch (err) {
    if (splashWin) { splashWin.close(); splashWin = null; }
    log(`Startup failed: ${err}`);
    dialog.showErrorBox(
      "Foliantica — Startup Error",
      `${err}\n\nDiagnostics log:\n${logFile}`
    );
    app.quit();
  }
});

app.on("activate", () => {
  // macOS: re-open window when clicking dock icon.
  if (mainWin) mainWin.show();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
