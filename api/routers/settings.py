import json
import os
import platform
import shutil
import sys
import subprocess
import threading
import time
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import httpx

from ai_providers import PROVIDERS, PROVIDER_MAP, fetch_models
from crypto import encrypt, decrypt
from database import get_db, DEFAULT_AI_PROMPTS
from models import UserSettings, AIPrompt
from schemas import SettingsOut, SettingsUpdate, AIPromptOut, AIPromptCreate, AIPromptUpdate, DataDirUpdate

# ── Shared Foliantica config (~/.foliantica/config.json) ──────────────────────
# Both this API and the Electron main process read/write this file so the
# chosen data directory survives restarts in any run mode.

LW_CONFIG_FILE = Path.home() / ".foliantica" / "config.json"

def _read_lw_config() -> dict:
    try:
        return json.loads(LW_CONFIG_FILE.read_text("utf-8"))
    except Exception:
        return {}

def _write_lw_config(data: dict) -> None:
    LW_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    LW_CONFIG_FILE.write_text(json.dumps(data, indent=2), "utf-8")

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _get_or_create_settings(db: Session) -> UserSettings:
    settings = db.query(UserSettings).first()
    if not settings:
        settings = UserSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def _settings_out(s: UserSettings) -> SettingsOut:
    try:
        enabled = json.loads(s.enabled_models or "[]")
    except (json.JSONDecodeError, TypeError):
        enabled = []
    try:
        grammar_langs = json.loads(s.grammar_languages or '["en"]')
    except (json.JSONDecodeError, TypeError):
        grammar_langs = ["en"]
    return SettingsOut(
        id=s.id,
        has_api_key=bool(s.openrouter_api_key),
        default_model=s.default_model,
        default_chat_model=s.default_chat_model or None,
        default_synopsis_model=s.default_synopsis_model or None,
        default_codex_model=s.default_codex_model or None,
        theme=s.theme or "dark",
        enabled_models=enabled,
        language=s.language or "en",
        show_paragraph_numbers=bool(s.show_paragraph_numbers),
        typewriter_mode=bool(s.typewriter_mode),
        typewriter_offset=s.typewriter_offset if s.typewriter_offset is not None else 50,
        session_timer_enabled=bool(s.session_timer_enabled) if s.session_timer_enabled is not None else True,
        grammar_check_enabled=bool(s.grammar_check_enabled),
        grammar_check_url=s.grammar_check_url or "http://localhost:8081",
        grammar_languages=grammar_langs,
        pandoc_enabled=bool(s.pandoc_enabled),
        pandoc_url=s.pandoc_url or "http://localhost:8082",
        spacy_enabled=bool(s.spacy_enabled),
        spacy_url=s.spacy_url or "http://localhost:8083",
        calibre_mode=getattr(s, "calibre_mode", None) or "off",
        calibre_enabled=(getattr(s, "calibre_mode", None) or "off") != "off",
        calibre_url=s.calibre_url or "http://localhost:8084",
        ai_disabled=bool(s.ai_disabled) if s.ai_disabled is not None else False,
        sync_mirror_enabled=bool(s.sync_mirror_enabled) if s.sync_mirror_enabled is not None else False,
        sync_local_dir=s.sync_local_dir or None,
    )


@router.get("", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    return _settings_out(_get_or_create_settings(db))


@router.post("", response_model=SettingsOut)
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db)):
    s = _get_or_create_settings(db)
    if body.openrouter_api_key:  # non-empty string → update; empty/None → keep existing key
        s.openrouter_api_key = encrypt(body.openrouter_api_key)
    if body.default_model is not None:
        s.default_model = body.default_model
    if body.default_chat_model is not None:
        s.default_chat_model = body.default_chat_model or None
    if body.default_synopsis_model is not None:
        s.default_synopsis_model = body.default_synopsis_model or None
    if body.default_codex_model is not None:
        s.default_codex_model = body.default_codex_model or None
    if body.theme is not None:
        s.theme = body.theme
    if body.enabled_models is not None:
        s.enabled_models = json.dumps(body.enabled_models)
    if body.language is not None:
        s.language = body.language
    if body.show_paragraph_numbers is not None:
        s.show_paragraph_numbers = int(body.show_paragraph_numbers)
    if body.typewriter_mode is not None:
        s.typewriter_mode = int(body.typewriter_mode)
    if body.typewriter_offset is not None:
        s.typewriter_offset = body.typewriter_offset
    if body.session_timer_enabled is not None:
        s.session_timer_enabled = int(body.session_timer_enabled)
    if body.grammar_check_enabled is not None:
        s.grammar_check_enabled = int(body.grammar_check_enabled)
    if body.grammar_check_url is not None:
        s.grammar_check_url = body.grammar_check_url
    if body.grammar_languages is not None:
        s.grammar_languages = json.dumps(body.grammar_languages)
    if body.pandoc_enabled is not None:
        s.pandoc_enabled = int(body.pandoc_enabled)
    if body.pandoc_url is not None:
        s.pandoc_url = body.pandoc_url
    if body.spacy_enabled is not None:
        s.spacy_enabled = int(body.spacy_enabled)
    if body.spacy_url is not None:
        s.spacy_url = body.spacy_url
    if body.calibre_mode is not None:
        s.calibre_mode = body.calibre_mode
        s.calibre_enabled = int(body.calibre_mode != "off")
    if body.calibre_url is not None:
        s.calibre_url = body.calibre_url
    if body.ai_disabled is not None:
        s.ai_disabled = int(body.ai_disabled)
    sync_changed = False
    if body.sync_mirror_enabled is not None:
        s.sync_mirror_enabled = int(body.sync_mirror_enabled)
        sync_changed = True
    if body.sync_local_dir is not None:
        s.sync_local_dir = body.sync_local_dir or None
        sync_changed = True
    db.commit()
    db.refresh(s)
    if sync_changed:
        from routers import sync as _sync
        _sync.init(bool(s.sync_mirror_enabled), s.sync_local_dir)
    return _settings_out(s)


# ── Docker helpers ────────────────────────────────────────────────────────────

def _docker_responsive() -> bool:
    """Return True if the Docker daemon answers to `docker info`."""
    try:
        r = subprocess.run(
            ["docker", "info"],
            capture_output=True, timeout=6,
        )
        return r.returncode == 0
    except Exception:
        return False


def _ensure_docker_running() -> None:
    """If Docker is not running, try to start it; wait up to 90 s for it.

    Raises HTTPException(503) if Docker cannot be found or doesn't come up.
    """
    if _docker_responsive():
        return

    system = platform.system()

    if system == "Windows":
        # Common Docker Desktop install locations on Windows
        candidates = [
            Path(os.environ.get("PROGRAMFILES",  r"C:\Program Files"))
                / "Docker" / "Docker" / "Docker Desktop.exe",
            Path(os.environ.get("LOCALAPPDATA", ""))
                / "Programs" / "Docker" / "Docker" / "Docker Desktop.exe",
        ]
        exe = next((p for p in candidates if p.exists()), None)
        if exe is None:
            raise HTTPException(
                503,
                "Docker Desktop is not installed. "
                "Download it from https://www.docker.com/products/docker-desktop/",
            )
        subprocess.Popen([str(exe)], close_fds=True)

    elif system == "Linux":
        # Try systemctl first (systemd), then SysV service
        started = False
        for cmd in (["systemctl", "start", "docker"],
                    ["service",    "docker", "start"]):
            try:
                if subprocess.run(cmd, capture_output=True, timeout=30).returncode == 0:
                    started = True
                    break
            except Exception:
                pass
        if not started:
            raise HTTPException(
                503,
                "Could not start the Docker daemon. "
                "Run: sudo systemctl start docker",
            )

    elif system == "Darwin":
        subprocess.Popen(["open", "-a", "Docker"], close_fds=True)

    else:
        raise HTTPException(503, f"Unsupported platform: {system}")

    # Poll until Docker responds or we time out
    for _ in range(90):
        time.sleep(1)
        if _docker_responsive():
            return

    raise HTTPException(
        503,
        "Docker was launched but did not become ready within 90 seconds. "
        "Please wait for Docker Desktop to finish starting, then try again.",
    )


@router.post("/docker/up")
def docker_compose_up(db: Session = Depends(get_db)):
    """Run `docker compose up -d` for the bundled services.

    Starts Docker Desktop / daemon automatically if it is not running.

    Location strategy:
    - Packaged Electron app: LW_RESOURCES_DIR env var points to the Electron
      resources/ folder where electron-builder copies docker-compose.yml.
    - Development: fall back to the repo root (three levels up from this file).

    Writes a .env file alongside docker-compose.yml so the compose file can
    read LT_LANGS (which languages LanguageTool should download n-gram data for).
    Includes the 'postgres' Compose profile when Docker PG is configured.
    """
    # ── Ensure Docker is running ──────────────────────────────────────────────
    try:
        _ensure_docker_running()
    except FileNotFoundError:
        raise HTTPException(
            503,
            "Docker CLI not found. "
            "Please install Docker Desktop from https://www.docker.com/products/docker-desktop/",
        )

    # ── Locate docker-compose.yml ─────────────────────────────────────────────
    resources_env = os.environ.get("LW_RESOURCES_DIR")
    compose_dir = (Path(resources_env) if resources_env
                   else Path(__file__).resolve().parent.parent.parent)
    compose_file = compose_dir / "docker-compose.yml"
    if not compose_file.exists():
        raise HTTPException(
            404,
            "docker-compose.yml not found. Make sure the app was installed correctly.",
        )

    # ── Write .env (LanguageTool language selection) ──────────────────────────
    s = _get_or_create_settings(db)
    try:
        langs = json.loads(s.grammar_languages or '["en"]')
    except (json.JSONDecodeError, TypeError):
        langs = ["en"]
    lt_langs = ",".join(langs) if langs else "en"
    env_file = compose_dir / ".env"
    env_file.write_text(f"LT_LANGS={lt_langs}\n", encoding="utf-8")

    # ── Build compose command ─────────────────────────────────────────────────
    lw_cfg   = _read_lw_config()
    profiles = []
    if lw_cfg.get("pg", {}).get("useDocker"):
        profiles += ["--profile", "postgres"]
    if s.grammar_check_enabled:
        profiles += ["--profile", "languagetool"]
    if s.pandoc_enabled:
        profiles += ["--profile", "pandoc"]
    if s.spacy_enabled:
        profiles += ["--profile", "spacy"]
    if (getattr(s, "calibre_mode", None) or "off") == "docker":
        profiles += ["--profile", "calibre"]

    cmd = (["docker", "compose"]
           + profiles
           + ["up", "-d", "--pull", "missing"])

    try:
        result = subprocess.run(
            cmd,
            cwd=str(compose_dir),
            capture_output=True,
            text=True,
            timeout=300,
        )
        combined = (result.stdout + result.stderr).strip()
        if result.returncode != 0:
            raise HTTPException(500, combined[:600] or "docker compose failed")
        return {"status": "ok", "output": combined[:600]}
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "docker compose timed out after 5 minutes.")


@router.get("/service-status")
async def service_status(db: Session = Depends(get_db)):
    """Ping both external services and return their reachability."""
    s = _get_or_create_settings(db)
    lt_url = (s.grammar_check_url or "http://localhost:8081").rstrip("/")
    pandoc_url = (s.pandoc_url or "http://localhost:8082").rstrip("/")
    spacy_url = (s.spacy_url or "http://localhost:8083").rstrip("/")

    async def ping(url: str, path: str) -> str:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(f"{url}{path}")
                return "ok" if r.status_code < 400 else "error"
        except Exception:
            return "offline"

    import asyncio, shutil as _shutil
    calibre_mode = getattr(s, "calibre_mode", None) or "off"

    async def _calibre_system_status() -> str:
        return "ok" if _shutil.which("ebook-convert") else "offline"

    async def _calibre_offline() -> str:
        return "offline"

    if calibre_mode == "system":
        calibre_coro = _calibre_system_status()
    elif calibre_mode == "docker":
        calibre_url = (s.calibre_url or "http://localhost:8084").rstrip("/")
        calibre_coro = ping(calibre_url, "/health")
    else:
        calibre_coro = _calibre_offline()

    lt_status, pandoc_status, spacy_status, calibre_status = await asyncio.gather(
        ping(lt_url, "/v2/languages"),
        ping(pandoc_url, "/health"),
        ping(spacy_url, "/health"),
        calibre_coro,
    )
    return {"languagetool": lt_status, "pandoc": pandoc_status, "spacy": spacy_status, "calibre": calibre_status}


@router.get("/detect-calibre")
async def detect_calibre(db: Session = Depends(get_db)):
    """Check whether Calibre is available via system PATH and/or Docker service."""
    import shutil
    s = _get_or_create_settings(db)
    system_ok = shutil.which("ebook-convert") is not None
    calibre_url = (s.calibre_url or "http://localhost:8084").rstrip("/")
    docker_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{calibre_url}/health")
        docker_ok = r.status_code < 400
    except Exception:
        pass
    return {"system": system_ok, "docker": docker_ok}


# ── Folder-picker: polling pattern ───────────────────────────────────────────
# The picker dialog blocks until the user makes a selection.  Running it inside
# an HTTP handler that goes through the Next.js proxy causes ECONNRESET because
# the proxy times out.  Instead we start the dialog in a background thread and
# let the client poll for the result.

_pick_sessions: dict[str, dict] = {}


def _open_folder_dialog() -> str | None:
    """Open a native OS folder picker and return the chosen path (or None)."""
    if sys.platform == "win32":
        # -STA is required for COM/WinForms GUI.  Drop -NonInteractive — it
        # blocks GUI dialogs.  FolderBrowserDialog on .NET 6+ uses the modern
        # Explorer-style picker automatically.
        ps = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$d = New-Object System.Windows.Forms.FolderBrowserDialog; "
            "$d.Description = 'Choose Foliantica Data Folder'; "
            "$d.ShowNewFolderButton = $true; "
            "$d.UseDescriptionForTitle = $true; "
            "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }"
        )
        r = subprocess.run(
            ["powershell", "-STA", "-Command", ps],
            capture_output=True, text=True, timeout=300,
        )
        return r.stdout.strip() or None

    elif sys.platform == "darwin":
        # Native macOS Finder folder picker via AppleScript.
        r = subprocess.run(
            ["osascript", "-e",
             'tell app "Finder" to POSIX path of (choose folder with prompt "Choose Foliantica Data Folder")'],
            capture_output=True, text=True, timeout=300,
        )
        return r.stdout.strip().rstrip("/") or None

    else:
        # Linux: zenity first, tkinter subprocess as fallback.
        try:
            r = subprocess.run(
                ["zenity", "--file-selection", "--directory",
                 "--title=Choose Foliantica Data Folder"],
                capture_output=True, text=True, timeout=300,
            )
            return r.stdout.strip() or None
        except FileNotFoundError:
            r = subprocess.run(
                [sys.executable, "-c",
                 "import tkinter as tk; from tkinter import filedialog; "
                 "root=tk.Tk(); root.withdraw(); root.attributes('-topmost',True); "
                 "p=filedialog.askdirectory(title='Choose Foliantica Data Folder'); "
                 "root.destroy(); print(p or '')"],
                capture_output=True, text=True, timeout=300,
            )
            return r.stdout.strip() or None


@router.post("/data-dir/pick")
def start_pick_data_dir():
    """Start a native folder-picker in a background thread.

    Returns immediately with a ``session_id``.
    Poll ``GET /data-dir/pick/{session_id}`` (every ~1 s) until status is
    ``"done"`` or ``"error"``.
    """
    sid = str(uuid.uuid4())
    _pick_sessions[sid] = {"status": "pending"}

    def _run():
        try:
            path = _open_folder_dialog()
            _pick_sessions[sid] = {"status": "done", "path": path}
        except Exception as exc:
            _pick_sessions[sid] = {"status": "error", "error": str(exc)}

    threading.Thread(target=_run, daemon=True).start()
    return {"session_id": sid}


@router.get("/data-dir/pick/{session_id}")
def poll_pick_data_dir(session_id: str):
    """Poll the result of a folder-picker session.

    Returns ``{"status": "pending"}`` while the dialog is open, or
    ``{"status": "done", "path": "..."}`` / ``{"status": "error", ...}`` once closed.
    """
    result = _pick_sessions.get(session_id)
    if result is None:
        raise HTTPException(404, "Pick session not found or already consumed")
    if result["status"] != "pending":
        _pick_sessions.pop(session_id, None)   # clean up after reading
    return result


@router.post("/restart")
def restart_server():
    """Restart the API process so a new data directory takes effect.

    Production mode (no --dev):
        os.execv replaces the current process cleanly.

    Dev mode (--dev / uvicorn --reload):
        uvicorn runs a supervisor (the original run.py) + a server worker
        (subprocess that handles requests).  We are inside the worker, so
        os.execv would only replace the worker — the supervisor still owns
        the port.  Instead we:
          1. Spawn the replacement run.py (non-blocking).
          2. Kill the supervisor so it releases the port and doesn't spawn
             a competing new worker.
          3. Exit ourselves to free any socket we hold.
        The replacement process starts importing *before* we release the
        port, giving it time to be ready to bind the moment the port is free.
    """
    def do_restart():
        time.sleep(0.6)  # let the HTTP response flush first
        script = os.environ.get("LW_RUN_SCRIPT") or os.path.abspath(sys.argv[0])
        args   = [sys.executable, script] + sys.argv[1:]

        if "--dev" in sys.argv:
            # Start the replacement process first so module imports can
            # overlap with the teardown of the old process tree.
            subprocess.Popen(args)
            ppid = os.getppid()
            if sys.platform == "win32":
                # Kill only the supervisor (no /T so we don't kill ourselves).
                subprocess.run(
                    ["taskkill", "/F", "/PID", str(ppid)],
                    capture_output=True,
                )
            else:
                import signal as _signal
                try:
                    os.kill(ppid, _signal.SIGTERM)
                except ProcessLookupError:
                    pass
            # Exit this worker — releases the server socket so the new
            # process can bind to it.
            os._exit(0)
        else:
            os.execv(sys.executable, args)

    threading.Thread(target=do_restart, daemon=True).start()
    return {"status": "restarting"}


@router.get("/data-dir")
def get_data_dir():
    cfg = _read_lw_config()
    return {
        "current": os.getcwd(),
        "configured": cfg.get("dataDir"),
    }


@router.get("/data-dir/check")
def check_data_dir(path: str):
    """Check whether a previously used data directory contains a SQL dump."""
    try:
        return {"has_db": (Path(path) / "foliantica.sql").exists()}
    except Exception:
        return {"has_db": False}


@router.post("/data-dir")
def set_data_dir(body: DataDirUpdate):
    cfg = _read_lw_config()

    if body.path and body.migrate:
        try:
            src = Path(os.getcwd())
            dst = Path(body.path)
            dst.mkdir(parents=True, exist_ok=True)
            (dst / "uploads").mkdir(exist_ok=True)

            uploads_src = src / "uploads"
            if uploads_src.exists():
                for item in uploads_src.iterdir():
                    dest_item = dst / "uploads" / item.name
                    if item.is_dir():
                        shutil.copytree(item, dest_item, dirs_exist_ok=True)
                    else:
                        shutil.copy2(item, dest_item)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Migration failed: {exc}")

    if body.path:
        cfg["dataDir"] = body.path
    else:
        cfg.pop("dataDir", None)
    _write_lw_config(cfg)
    return {"current": os.getcwd(), "configured": body.path or None}


# ── PostgreSQL connection config (stored in ~/.foliantica/config.json) ────────
# Must live in the file config rather than the DB because it must be readable
# before the database engine is created.

@router.get("/pg-active")
def get_pg_active():
    """Return the PG connection the API is currently running on (from env vars)."""
    return {
        "mode": "pg",
        "host": os.getenv("LW_PG_HOST", "127.0.0.1"),
        "port": int(os.getenv("LW_PG_PORT", "5433")),
        "user": os.getenv("LW_PG_USER", "foliantica"),
        "db":   os.getenv("LW_PG_DB",   "foliantica"),
    }


@router.get("/pg-config")
def get_pg_config():
    """Return the current PG connection config from the shared lw-config file."""
    cfg = _read_lw_config()
    return cfg.get("pg", {
        "useDocker": False,
        "host":      "127.0.0.1",
        "port":      5434,
        "user":      "foliantica",
        "pass":      "foliantica",
        "db":        "foliantica",
    })


@router.post("/pg-config")
def set_pg_config(body: dict):
    """Persist PG connection config to ~/.foliantica/config.json.

    Takes effect after the backend restarts (connection is created at startup).
    Allowed keys: useDocker (bool), host, port (int), user, pass, db.
    """
    allowed = {"useDocker", "host", "port", "user", "pass", "db"}
    clean = {k: v for k, v in body.items() if k in allowed}
    cfg = _read_lw_config()
    cfg["pg"] = clean
    _write_lw_config(cfg)
    return clean


# ── Default connection values for the embedded cluster ────────────────────────
_EMBEDDED_PG = {"host": "127.0.0.1", "port": 5433,
                "user": "foliantica",  "pass": "foliantica", "db": "foliantica"}


def _pg_engine_for(conn: dict):
    """Create a throw-away SQLAlchemy engine for a PG connection dict."""
    from sqlalchemy import create_engine as _ce
    host = conn.get("host", "127.0.0.1")
    port = conn.get("port", 5433)
    user = conn.get("user", "foliantica")
    pw   = conn.get("pass", "foliantica")
    db   = conn.get("db",   "foliantica")
    url  = f"postgresql+psycopg2://{user}:{pw}@{host}:{port}/{db}"
    return _ce(url, connect_args={"options": "-c client_encoding=UTF8"})


@router.post("/pg-transfer")
def transfer_pg(body: dict):
    """Copy all data from the LIVE database to a target PostgreSQL instance.

    The source is always the engine the API is currently connected to — it is
    guaranteed to be reachable.  Only the target needs to be specified.

    Body: { "target": {host, port, user, pass, db} }

    For backward-compat a "source" key is accepted but silently ignored.

    The target schema is created from models if it doesn't exist.
    All existing rows in the target are replaced (DELETE then INSERT).
    SERIAL sequences are reset after the copy.
    Returns { tables_copied, rows_copied, tables }.
    """
    from sqlalchemy import text as _text
    from database import engine as _live_engine  # always the running DB
    from models import Base

    dst_cfg    = {**_EMBEDDED_PG, **body.get("target", {})}

    # This endpoint copies the entire datastore — including the encrypted
    # api-key columns — to the target. An unrestricted destination is a data
    # exfiltration primitive (e.g. via a same-origin XSS payload POSTing here).
    # Restrict the target to loopback unless an operator explicitly opts in via
    # an environment variable (trusted, not attacker-settable).
    dst_host = str(dst_cfg.get("host", "")).lower()
    if dst_host not in ("localhost", "127.0.0.1", "::1") and \
            os.getenv("LW_ALLOW_REMOTE_PG_TRANSFER") != "1":
        raise HTTPException(
            403,
            "pg-transfer target must be a loopback host. Set "
            "LW_ALLOW_REMOTE_PG_TRANSFER=1 to allow a remote destination.",
        )

    dst_engine = _pg_engine_for(dst_cfg)

    try:
        # Ensure target schema exists
        Base.metadata.create_all(bind=dst_engine)

        # Get table list from the live source
        with _live_engine.connect() as src_conn:
            tables = [r[0] for r in src_conn.execute(_text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' "
                "ORDER BY table_name"
            ))]

        tables_copied: list[str] = []
        rows_copied = 0

        with _live_engine.connect() as src_conn, dst_engine.begin() as dst_conn:
            dst_conn.execute(_text("SET session_replication_role = replica"))

            for table in tables:
                cols = [r[0] for r in src_conn.execute(_text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = :t "
                    "ORDER BY ordinal_position"
                ), {"t": table})]

                rows = src_conn.execute(_text(f'SELECT * FROM "{table}"')).fetchall()

                # Always replace target contents (this is an explicit transfer)
                dst_conn.execute(_text(f'DELETE FROM "{table}"'))
                if not rows:
                    continue

                col_sql   = ", ".join(f'"{c}"' for c in cols)
                ph_sql    = ", ".join(f":{c}" for c in cols)
                row_dicts = [dict(zip(cols, r)) for r in rows]
                dst_conn.execute(_text(
                    f'INSERT INTO "{table}" ({col_sql}) VALUES ({ph_sql})'
                ), row_dicts)

                tables_copied.append(table)
                rows_copied += len(rows)

            dst_conn.execute(_text("SET session_replication_role = DEFAULT"))

            # Reset SERIAL sequences so new inserts don't collide
            for table in tables_copied:
                try:
                    seq = dst_conn.execute(_text(
                        "SELECT pg_get_serial_sequence(:t, 'id')"
                    ), {"t": table}).scalar()
                    if seq:
                        dst_conn.execute(_text(
                            f"SELECT setval('{seq}', "
                            f"COALESCE((SELECT MAX(id) FROM \"{table}\"), 0) + 1, false)"
                        ))
                except Exception:
                    pass

        return {"tables_copied": len(tables_copied),
                "rows_copied":   rows_copied,
                "tables":        tables_copied}

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        dst_engine.dispose()


def _parse_providers_cfg(s: UserSettings) -> dict:
    try:
        return json.loads(s.ai_providers_cfg or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}


def _write_providers_cfg(s: UserSettings, cfg: dict) -> None:
    s.ai_providers_cfg = json.dumps(cfg)


@router.get("/providers")
def list_providers(db: Session = Depends(get_db)):
    """List all known providers with configured + active status."""
    s = _get_or_create_settings(db)
    cfg = _parse_providers_cfg(s)
    active_id = getattr(s, "active_provider", None) or "openrouter"
    result = []
    for p in PROVIDERS:
        prov_cfg = cfg.get(p.id, {})
        has_key = bool(prov_cfg.get("api_key"))
        # Backward compat: OpenRouter may still use the legacy column
        if p.id == "openrouter" and not has_key:
            has_key = bool(s.openrouter_api_key)
        result.append({
            "id":          p.id,
            "name":        p.name,
            "is_local":    p.is_local,
            "requires_key": p.requires_key,
            "default_base_url": p.default_base_url,
            "configured":  has_key or (not p.requires_key),
            "is_active":   p.id == active_id,
            "base_url":    prov_cfg.get("base_url") or p.default_base_url,
        })
    return result


@router.post("/providers/model-map")
def set_model_provider_map(body: dict, db: Session = Depends(get_db)):
    """Record which provider owns a model ID so cross-provider routing works.
    Body: {model_id: str, provider_id: str}
    """
    model_id    = (body.get("model_id") or "").strip()
    provider_id = (body.get("provider_id") or "").strip()
    if not model_id or not PROVIDER_MAP.get(provider_id):
        raise HTTPException(400, "model_id and a valid provider_id are required")

    s = _get_or_create_settings(db)
    cfg = _parse_providers_cfg(s)
    cfg.setdefault("_model_provider_map", {})[model_id] = provider_id
    _write_providers_cfg(s, cfg)
    db.commit()
    return {"ok": True}


@router.post("/providers/active")
def set_active_provider(body: dict, db: Session = Depends(get_db)):
    """Set the active provider. Body: {provider_id: str}"""
    provider_id = body.get("provider_id", "")
    if not PROVIDER_MAP.get(provider_id):
        raise HTTPException(400, f"Unknown provider: {provider_id}")
    s = _get_or_create_settings(db)
    s.active_provider = provider_id
    db.commit()
    return {"active_provider": provider_id}


def _validate_base_url(url: str, pdef) -> str:
    """Validate a user-supplied provider base URL.

    The base URL is the outbound target for AI calls, and for key-bearing
    providers the *decrypted* API key is attached as an Authorization header.
    An unvalidated value lets an attacker (e.g. via a same-origin XSS payload)
    point the request at their own host and exfiltrate the key, or reach
    internal services. We therefore:
      - allow only ``http`` / ``https`` schemes (blocks ``file:``/``gopher:`` etc.)
      - require a hostname
      - require ``https`` for non-loopback hosts when the provider sends a key
        (prevents plaintext credential exfiltration / cleartext SSRF)
    Local providers (e.g. ollama) may use ``http://localhost``.
    """
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(400, "base_url must be a valid http(s) URL")
    host = parsed.hostname.lower()
    is_loopback = host in ("localhost", "127.0.0.1", "::1")
    if pdef.requires_key and not is_loopback and parsed.scheme != "https":
        raise HTTPException(400, "base_url must use https for non-local providers")
    return url


@router.post("/providers/{provider_id}")
def save_provider_config(
    provider_id: str,
    body: dict,
    db: Session = Depends(get_db),
):
    """Save API key and/or base URL for a provider.
    Body: {api_key?: str, base_url?: str}
    Passing api_key="" removes the stored key.
    """
    pdef = PROVIDER_MAP.get(provider_id)
    if not pdef:
        raise HTTPException(404, f"Unknown provider: {provider_id}")

    s = _get_or_create_settings(db)
    cfg = _parse_providers_cfg(s)
    prov_cfg = cfg.setdefault(provider_id, {})

    if "api_key" in body:
        key_val = body["api_key"]
        if key_val:
            prov_cfg["api_key"] = encrypt(key_val)
            # Keep legacy column in sync for OpenRouter (backward compat)
            if provider_id == "openrouter":
                s.openrouter_api_key = encrypt(key_val)
        else:
            prov_cfg.pop("api_key", None)
            if provider_id == "openrouter":
                s.openrouter_api_key = None

    if "base_url" in body:
        url_val = (body["base_url"] or "").strip()
        prov_cfg["base_url"] = _validate_base_url(url_val, pdef) if url_val else None

    _write_providers_cfg(s, cfg)
    db.commit()
    return {"ok": True}


@router.get("/providers/{provider_id}/ping")
async def ping_provider(provider_id: str, db: Session = Depends(get_db)):
    """Check if a local provider is reachable at its configured base URL."""
    pdef = PROVIDER_MAP.get(provider_id)
    if not pdef:
        raise HTTPException(404, f"Unknown provider: {provider_id}")

    s = _get_or_create_settings(db)
    cfg = _parse_providers_cfg(s).get(provider_id, {})
    base_url = cfg.get("base_url") or pdef.default_base_url

    try:
        async with httpx.AsyncClient(timeout=3) as client:
            await client.get(f"{base_url}/models")
        return {"reachable": True}
    except Exception:
        return {"reachable": False}


@router.get("/providers/{provider_id}/models")
async def get_provider_models(provider_id: str, db: Session = Depends(get_db)):
    """Fetch available models for the given provider (key stays server-side)."""
    pdef = PROVIDER_MAP.get(provider_id)
    if not pdef:
        raise HTTPException(404, f"Unknown provider: {provider_id}")

    s = _get_or_create_settings(db)
    cfg = _parse_providers_cfg(s).get(provider_id, {})
    base_url = cfg.get("base_url") or pdef.default_base_url

    encrypted = cfg.get("api_key")
    api_key = decrypt(encrypted) if encrypted else None
    if provider_id == "openrouter" and not api_key and s.openrouter_api_key:
        api_key = decrypt(s.openrouter_api_key)

    try:
        return await fetch_models(pdef, base_url, api_key)
    except httpx.ConnectError:
        raise HTTPException(503, f"Cannot connect to {pdef.name} at {base_url}. Make sure the service is running and network discovery/API access is enabled.")
    except httpx.TimeoutException:
        raise HTTPException(503, f"{pdef.name} did not respond at {base_url}. Check that the service is reachable.")
    except Exception:
        return []


@router.get("/models")
async def get_available_models(db: Session = Depends(get_db)):
    """Return models for the currently active provider (legacy endpoint kept for compat)."""
    s = _get_or_create_settings(db)
    active_id = getattr(s, "active_provider", None) or "openrouter"
    pdef = PROVIDER_MAP.get(active_id)
    if not pdef:
        return []

    cfg = _parse_providers_cfg(s).get(active_id, {})
    base_url = cfg.get("base_url") or pdef.default_base_url
    encrypted = cfg.get("api_key")
    api_key = decrypt(encrypted) if encrypted else None
    if active_id == "openrouter" and not api_key and s.openrouter_api_key:
        api_key = decrypt(s.openrouter_api_key)

    try:
        return await fetch_models(pdef, base_url, api_key)
    except httpx.ConnectError:
        raise HTTPException(503, f"Cannot connect to {pdef.name} at {base_url}. Make sure the service is running and network discovery/API access is enabled.")
    except httpx.TimeoutException:
        raise HTTPException(503, f"{pdef.name} did not respond at {base_url}. Check that the service is reachable.")
    except Exception:
        return []


# ── AI Prompts ────────────────────────────────────────────────────────────────

def _prompt_out(p: AIPrompt) -> AIPromptOut:
    return AIPromptOut(
        id=p.id,
        name=p.name,
        description=p.description or "",
        system=p.system or "",
        user_template=p.user_template or "",
        is_built_in=bool(p.is_built_in),
        built_in_key=p.built_in_key,
        word_count=p.word_count if p.word_count is not None else 400,
    )


@router.get("/prompts", response_model=list[AIPromptOut])
def list_prompts(db: Session = Depends(get_db)):
    return [_prompt_out(p) for p in db.query(AIPrompt).all()]


@router.post("/prompts", response_model=AIPromptOut)
def create_prompt(body: AIPromptCreate, db: Session = Depends(get_db)):
    p = AIPrompt(
        name=body.name,
        description=body.description,
        system=body.system,
        user_template=body.user_template,
        is_built_in=0,
        built_in_key=None,
        word_count=body.word_count,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _prompt_out(p)


@router.put("/prompts/{prompt_id}", response_model=AIPromptOut)
def update_prompt(prompt_id: int, body: AIPromptUpdate, db: Session = Depends(get_db)):
    p = db.get(AIPrompt, prompt_id)
    if not p:
        raise HTTPException(404, "Prompt not found")
    if body.name is not None:
        p.name = body.name
    if body.description is not None:
        p.description = body.description
    if body.system is not None:
        p.system = body.system
    if body.user_template is not None:
        p.user_template = body.user_template
    if body.word_count is not None:
        p.word_count = body.word_count
    db.commit()
    db.refresh(p)
    return _prompt_out(p)


@router.delete("/prompts/{prompt_id}", status_code=204)
def delete_prompt(prompt_id: int, db: Session = Depends(get_db)):
    p = db.get(AIPrompt, prompt_id)
    if not p:
        raise HTTPException(404, "Prompt not found")
    if p.is_built_in:
        raise HTTPException(400, "Cannot delete built-in prompts")
    db.delete(p)
    db.commit()


@router.post("/prompts/{prompt_id}/revert", response_model=AIPromptOut)
def revert_prompt(prompt_id: int, db: Session = Depends(get_db)):
    p = db.get(AIPrompt, prompt_id)
    if not p or not p.built_in_key:
        raise HTTPException(404, "Prompt not found or not a built-in")
    default = next((d for d in DEFAULT_AI_PROMPTS if d["built_in_key"] == p.built_in_key), None)
    if not default:
        raise HTTPException(404, "No default found for this prompt")
    p.name = default["name"]
    p.description = default["description"]
    p.system = default["system"]
    p.user_template = default["user_template"]
    db.commit()
    db.refresh(p)
    return _prompt_out(p)
