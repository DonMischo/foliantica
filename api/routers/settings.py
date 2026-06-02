import json
import os
import shutil
import sqlite3
import sys
import subprocess
import threading
import time
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import httpx

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


@router.post("/docker/up")
def docker_compose_up(db: Session = Depends(get_db)):
    """Run `docker compose up -d` for the bundled services.

    Location strategy:
    - Packaged Electron app: LW_RESOURCES_DIR env var points to the Electron
      resources/ folder where electron-builder copies docker-compose.yml.
    - Development: fall back to the repo root (three levels up from this file).

    Writes a .env file alongside docker-compose.yml so the compose file can
    read LT_LANGS (which languages LanguageTool should download n-gram data for).
    """
    resources_env = os.environ.get("LW_RESOURCES_DIR")
    compose_dir = Path(resources_env) if resources_env else Path(__file__).resolve().parent.parent.parent
    compose_file = compose_dir / "docker-compose.yml"
    if not compose_file.exists():
        raise HTTPException(
            404,
            "docker-compose.yml not found. Make sure the app was installed correctly.",
        )

    # Write .env so docker compose picks up the selected languages
    s = _get_or_create_settings(db)
    try:
        langs = json.loads(s.grammar_languages or '["en"]')
    except (json.JSONDecodeError, TypeError):
        langs = ["en"]
    lt_langs = ",".join(langs) if langs else "en"
    env_file = compose_dir / ".env"
    env_file.write_text(f"LT_LANGS={lt_langs}\n", encoding="utf-8")

    try:
        result = subprocess.run(
            ["docker", "compose", "up", "-d", "--pull", "missing", "--force-recreate"],
            cwd=str(compose_dir),
            capture_output=True,
            text=True,
            timeout=300,   # pulling images can take a while
        )
        combined = (result.stdout + result.stderr).strip()
        if result.returncode != 0:
            raise HTTPException(500, combined[:600] or "docker compose failed")
        return {"status": "ok", "output": combined[:600]}
    except FileNotFoundError:
        raise HTTPException(
            503,
            "Docker not found. Please install Docker Desktop and make sure it is running.",
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "docker compose timed out after 5 minutes.")


@router.get("/service-status")
async def service_status(db: Session = Depends(get_db)):
    """Ping both external services and return their reachability."""
    s = _get_or_create_settings(db)
    lt_url = (s.grammar_check_url or "http://localhost:8081").rstrip("/")
    pandoc_url = (s.pandoc_url or "http://localhost:8082").rstrip("/")

    async def ping(url: str, path: str) -> str:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(f"{url}{path}")
                return "ok" if r.status_code < 400 else "error"
        except Exception:
            return "offline"

    import asyncio
    lt_status, pandoc_status = await asyncio.gather(
        ping(lt_url, "/v2/languages"),
        ping(pandoc_url, "/health"),
    )
    return {"languagetool": lt_status, "pandoc": pandoc_status}


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
    try:
        return {"has_db": (Path(path) / "foliantica.db").exists()}
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

            # Use SQLite's backup API so we can copy the live, open database safely.
            db_src = src / "foliantica.db"
            if db_src.exists():
                src_conn = sqlite3.connect(str(db_src))
                dst_conn = sqlite3.connect(str(dst / "foliantica.db"))
                try:
                    src_conn.backup(dst_conn)
                finally:
                    dst_conn.close()
                    src_conn.close()

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


@router.get("/models")
def get_available_models(db: Session = Depends(get_db)):
    """Proxy the OpenRouter model list so the API key stays server-side."""
    s = _get_or_create_settings(db)
    if not s.openrouter_api_key:
        return []
    try:
        api_key = decrypt(s.openrouter_api_key)
        resp = httpx.get(
            "https://openrouter.ai/api/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        if resp.status_code != 200:
            return []
        data = resp.json()
        models = [
            {"id": m["id"], "name": m.get("name") or m["id"]}
            for m in data.get("data", [])
            if m.get("id")
        ]
        return sorted(models, key=lambda m: m["name"].lower())
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
