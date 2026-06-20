"use strict";

const {
  app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const crypto = require("crypto");

// Random per-launch secret, injected into the main window's own requests
// (fetch + WS handshake) below so the API/web servers can recognize traffic
// from our own privileged window even if it arrives via a genuinely-loopback
// connection — e.g. another locally-running process can't fake this, unlike
// a Host header or a TCP peer address. See COWORKING_NETWORK_SECURITY_SUMMARY.md.
const hostSecret = crypto.randomBytes(32).toString("hex");

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
let pgInstance = null;   // LocalPgManager instance

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

  // Mark every request from our own window (fetch + the collab WS handshake)
  // with the per-launch secret. Scoped to this window's own origin only, so
  // the secret is never sent to any third-party resource the page might load.
  mainWin.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: [`http://127.0.0.1:${webPort}/*`] },
    (details, callback) => {
      details.requestHeaders["X-Foliantica-Host-Secret"] = hostSecret;
      callback({ requestHeaders: details.requestHeaders });
    }
  );

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

/**
 * Minimal embedded-PostgreSQL manager.
 *
 * The embedded-postgres npm package uses ESM import.meta.url to locate its
 * binaries. Inside a packaged Electron app that URL resolves to an ASAR-
 * internal path, and child_process.spawn() cannot execute files from inside
 * an ASAR archive even when asarUnpack is configured.
 *
 * We bypass the library's binary resolution entirely and compute paths
 * directly from process.resourcesPath + app.asar.unpacked, which is always
 * a real filesystem location.
 */
class LocalPgManager {
  constructor({ databaseDir, user, password, port, initdbFlags = [] }) {
    const pkgName = process.platform === "win32" ? "windows-x64"
                  : process.platform === "darwin"
                      ? (process.arch === "arm64" ? "darwin-arm64" : "darwin-x64")
                      : (process.arch === "arm64" ? "linux-arm64"
                         : process.arch === "arm"  ? "linux-arm"
                         : process.arch === "ia32" ? "linux-ia32"
                         : "linux-x64");
    const ext = process.platform === "win32" ? ".exe" : "";
    const binDir = path.join(
      process.resourcesPath, "app.asar.unpacked", "node_modules",
      "@embedded-postgres", pkgName, "native", "bin"
    );

    this.initdbBin   = path.join(binDir, `initdb${ext}`);
    this.postgresBin = path.join(binDir, `postgres${ext}`);
    this.pgDumpBin   = path.join(binDir, `pg_dump${ext}`);
    this.databaseDir = databaseDir;
    this.user        = user;
    this.password    = password;
    this.port        = port;
    this.initdbFlags = initdbFlags;
    this.process     = null;
  }

  async initialise() {
    // Ensure binaries are executable (no-op on Windows).
    if (process.platform !== "win32") {
      for (const bin of [this.initdbBin, this.postgresBin]) {
        try { await fs.promises.chmod(bin, 0o755); } catch {}
      }
    }

    // Write password to a temp file (initdb --pwfile requires a file path).
    const passwordFile = path.join(app.getPath("temp"), `pg-pass-${Date.now()}`);
    await fs.promises.writeFile(passwordFile, this.password + "\n");

    await new Promise((resolve, reject) => {
      const proc = spawn(this.initdbBin, [
        `--pgdata=${this.databaseDir}`,
        "--auth=password",
        `--username=${this.user}`,
        `--pwfile=${passwordFile}`,
        "--lc-messages=en_US.UTF-8",
        ...this.initdbFlags,
      ], { env: { ...process.env, LC_MESSAGES: "en_US.UTF-8" } });

      proc.stdout?.on("data", (d) => log(`[initdb] ${d.toString().trim()}`));
      proc.stderr?.on("data", (d) => log(`[initdb] ${d.toString().trim()}`));
      proc.on("exit", (code) => {
        code === 0 ? resolve() : reject(new Error(`initdb exited with code ${code}`));
      });
      proc.on("error", (err) =>
        reject(new Error(`initdb spawn failed: ${err.message} — path: ${this.initdbBin}`))
      );
    });

    await fs.promises.unlink(passwordFile).catch(() => {});
  }

  async start() {
    await new Promise((resolve, reject) => {
      let resolved = false;

      this.process = spawn(this.postgresBin, [
        "-D", this.databaseDir,
        "-p", String(this.port),
      ], { env: { ...process.env, LC_MESSAGES: "en_US.UTF-8" } });

      this.process.stderr?.on("data", (chunk) => {
        const msg = chunk.toString("utf-8");
        log(`[postgres] ${msg.trim()}`);
        if (!resolved && msg.includes("database system is ready to accept connections")) {
          resolved = true;
          resolve();
        }
      });
      this.process.stdout?.on("data", (chunk) => {
        log(`[postgres] ${chunk.toString().trim()}`);
      });
      this.process.on("close", (code) => {
        if (!resolved) reject(new Error(`postgres exited before ready (code ${code})`));
      });
      this.process.on("error", (err) => {
        if (!resolved) reject(new Error(`postgres spawn failed: ${err.message} — path: ${this.postgresBin}`));
      });
    });
  }

  async createDatabase(name) {
    const { Client } = require("pg");
    const client = new Client({
      host: "127.0.0.1",
      port: this.port,
      user: this.user,
      password: this.password,
      database: "postgres",
    });
    await client.connect();
    try {
      await client.query(`CREATE DATABASE "${name}"`);
    } catch (e) {
      if (!e.message.includes("already exists")) throw e;
    } finally {
      await client.end();
    }
  }

  async stop() {
    if (!this.process) return;
    await new Promise((resolve) => {
      this.process.on("exit", resolve);
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(this.process.pid), "/f", "/t"]);
      } else {
        this.process.kill("SIGINT");
      }
    }).catch(() => {});
    this.process = null;
  }
}

const PG_PORT = 5433;
const PG_USER = "foliantica";
const PG_PASS = "foliantica";
const PG_DB   = "foliantica";

// ── Docker availability check ─────────────────────────────────────────────────

/**
 * On Windows, checks the Docker named pipe to see if the daemon is running.
 * Returns true if Docker appears to be up.
 */
function isDockerRunning() {
  if (process.platform !== "win32") {
    // On macOS/Linux just try `docker info` synchronously — cheap enough.
    try {
      require("child_process").execSync("docker info --format '{{.ID}}'", {
        timeout: 3000, stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  }
  // Windows: Docker Desktop exposes a named pipe when running.
  const pipes = [
    "\\\\.\\pipe\\dockerDesktopLinuxEngine",
    "\\\\.\\pipe\\docker_engine",
  ];
  return pipes.some((p) => { try { return fs.existsSync(p); } catch { return false; } });
}

/**
 * Tries to start Docker Desktop on Windows if it isn't running, then waits
 * up to 60 s for the daemon to become available.
 * Throws a user-friendly error if Docker can't be reached.
 */
async function ensureDockerRunning() {
  if (isDockerRunning()) return;

  log("[docker] Docker daemon not running — attempting to start Docker Desktop…");
  if (splashWin) {
    splashWin.webContents
      .executeJavaScript('document.querySelector(".status").textContent = "Starting Docker Desktop…";')
      .catch(() => {});
  }

  // Try to launch Docker Desktop on Windows.
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe",
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Docker", "Docker", "Docker Desktop.exe"),
    ];
    const exe = candidates.find((p) => fs.existsSync(p));
    if (exe) {
      log(`[docker] Launching ${exe}`);
      spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
    } else {
      log("[docker] Docker Desktop executable not found in standard locations");
    }
  }

  // Poll until Docker is responsive (up to 60 s).
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    if (isDockerRunning()) {
      log("[docker] Docker daemon is now running");
      return;
    }
    log("[docker] Still waiting for Docker daemon…");
  }

  // Docker didn't come up — show a clear dialog before throwing.
  const msg = process.platform === "win32"
    ? "Docker Desktop is not running and could not be started automatically.\n\n"
      + "Please start Docker Desktop from the Start menu, wait for it to finish loading "
      + "(whale icon in the system tray turns steady), then relaunch Foliantica."
    : "Docker is not running.\n\nPlease start the Docker daemon and relaunch Foliantica.";

  await dialog.showMessageBox({
    type: "error",
    title: "Docker required",
    message: "Docker Desktop is not running",
    detail: msg,
    buttons: ["Quit"],
  });

  throw new Error("Docker Desktop is not running — user notified");
}

/**
 * Start the embedded PostgreSQL sidecar.
 * Returns the pg_dump binary path so it can be forwarded to the API process.
 *
 * First run (~3 s for initdb): splash screen is updated to show progress.
 * Subsequent launches: ~1 s (PG starts from the existing cluster directory).
 */
async function startPostgres() {
  // If the user has configured Docker PG in ~/.foliantica/config.json,
  // start the container (if not already running) and wait for it to be ready.
  const lwCfgForPg = loadLwConfig();
  if (lwCfgForPg.pg && lwCfgForPg.pg.useDocker) {
    const pgCfg  = lwCfgForPg.pg;
    const pgHost = pgCfg.host || "127.0.0.1";
    const pgPort = pgCfg.port || 5434;
    const pgUser = pgCfg.user || "foliantica";
    const pgPass = pgCfg.pass || "foliantica";
    const pgDb   = pgCfg.db   || "foliantica";

    log(`[pg] Docker PG mode — ${pgHost}:${pgPort}`);

    if (splashWin) {
      splashWin.webContents
        .executeJavaScript('document.querySelector(".status").textContent = "Starting database…";')
        .catch(() => {});
    }

    // ── Ensure Docker is running ──────────────────────────────────────────────
    await ensureDockerRunning();

    // docker-compose.yml is in resources/ in prod, project root in dev.
    const composePath = isProd
      ? path.join(process.resourcesPath, "docker-compose.yml")
      : path.join(__dirname, "..", "docker-compose.yml");

    // Bring the postgres profile up (no-op if already running).
    await new Promise((resolve, reject) => {
      // --project-name pins the compose project to "foliantica" regardless of
      // which directory the compose file lives in (resources/ in prod vs. the
      // project root in dev). Without it, compose derives the name from the
      // directory and treats the same containers as a different project, causing
      // "container name already in use" conflicts on every restart.
      // The explicit service name limits startup to postgres only.
      const proc = spawn("docker", [
        "compose", "-f", composePath,
        "--project-name", "foliantica",
        "--profile", "postgres",
        "up", "-d", "postgres",
      ], { stdio: ["ignore", "pipe", "pipe"] });
      proc.stdout?.on("data", (d) => log(`[docker] ${d.toString().trim()}`));
      proc.stderr?.on("data", (d) => log(`[docker] ${d.toString().trim()}`));
      proc.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`docker compose up exited with code ${code}`));
      });
      proc.on("error", (err) =>
        reject(new Error(`docker not found: ${err.message} — install Docker Desktop or Docker Engine`))
      );
    });

    // Poll until PostgreSQL accepts connections (up to 60 s).
    log("[pg] Waiting for Docker PostgreSQL to be ready...");
    const { Client } = require("pg");
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      const client = new Client({
        host: pgHost, port: pgPort,
        user: pgUser, password: pgPass, database: "postgres",
        connectionTimeoutMillis: 1000,
      });
      try {
        await client.connect();
        await client.end();
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (!ready) {
      throw new Error(`Docker PostgreSQL not ready after 60 s — check that Docker is running and port ${pgPort} is free`);
    }
    log("[pg] Docker PostgreSQL ready");

    return { pgHost, pgPort: String(pgPort), pgUser, pgPass, pgDb };
  }

  // pgdata must always be on a local drive — never in a cloud-synced dataDir.
  const pgDataDir = path.join(app.getPath("userData"), "pgdata");
  const isFirstRun = !fs.existsSync(pgDataDir);

  if (isFirstRun && splashWin) {
    splashWin.webContents
      .executeJavaScript('document.querySelector(".status").textContent = "Preparing database…";')
      .catch(() => {});
  }

  const localPg = new LocalPgManager({
    databaseDir: pgDataDir,
    user: PG_USER,
    password: PG_PASS,
    port: PG_PORT,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });

  // In dev builds the embedded binaries don't exist — skip PG startup gracefully.
  if (!fs.existsSync(localPg.initdbBin)) {
    log("[pg] embedded-postgres binaries not found — skipping PG startup");
    return { pgDumpPath: "pg_dump" };
  }

  log(`[pg] initialising cluster at ${pgDataDir} (first run: ${isFirstRun})`);
  if (isFirstRun) await localPg.initialise();   // runs initdb only on first launch (~3 s)
  await localPg.start();                          // starts postmaster (~1 s)
  try { await localPg.createDatabase(PG_DB); } catch {}  // no-op if already exists

  pgInstance = localPg;
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

  // pg_dump lives alongside the other binaries — LocalPgManager already has the path.
  return { pgDumpPath: fs.existsSync(localPg.pgDumpBin) ? localPg.pgDumpBin : "pg_dump" };
}

// ── Server startup ────────────────────────────────────────────────────────────

async function startServers() {
  const apiPort = await findFreePort();
  const webPort = await findFreePort();

  if (isProd) {
    // ── Co-work bind address ──────────────────────────────────────────────────
    // Only the web server needs to listen on all interfaces so LAN/internet
    // guests can connect — the API server-wrapper.js proxies the collab
    // WebSocket through it too, so FastAPI itself never needs to be reachable
    // from outside this machine. The setting is read from config.json before
    // any process is spawned (changing it requires an app restart).
    const lwCfgForCowork = loadLwConfig();
    const coworkEnabled  = !!(lwCfgForCowork?.cowork?.enabled);
    const webBindHost    = coworkEnabled ? "0.0.0.0" : "127.0.0.1";
    if (coworkEnabled) log("[cowork] Co-Work enabled — binding web server to 0.0.0.0");

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
        LW_WEB_PORT: String(webPort),
        LW_DATA_DIR: dataDir,
        LW_RESOURCES_DIR: process.resourcesPath,
        FOLIANTICA_HOST_SECRET: hostSecret,
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
    // server-wrapper.js wraps the generated server.js to also proxy the
    // collab WebSocket upgrade through to FastAPI over loopback.
    const nextServer = path.join(process.resourcesPath, "web", "server-wrapper.js");
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
          HOSTNAME: webBindHost,
          LW_API_PORT: String(apiPort),
          NODE_ENV: "production",
          FOLIANTICA_HOST_SECRET: hostSecret,
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
