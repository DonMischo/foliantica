"""
DB mirror sync — keeps a local copy of the database in sync with the primary
dataDir (which may live on a sync drive / NAS / cloud folder).

Architecture:
  - Backend always runs from dataDir (unchanged).
  - This module maintains a mirror copy at sync_local_dir.
  - A background thread wakes every 5 minutes and copies dataDir/app.db
    → sync_local_dir/app.db using SQLite's online backup API (safe while
    the DB is open by SQLAlchemy).
  - When the drive becomes unavailable the copy is skipped; mode → "offline".
  - When the drive comes back online, mode → "online", drive_restored_at is
    set so the frontend can surface a notification.
"""
import sqlite3
import threading
from datetime import datetime, UTC
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/api/sync", tags=["sync"])

# ── Module-level state (updated by init() and the background thread) ──────────

_lock = threading.Lock()

_enabled:          bool            = False
_mirror_dir:       Path | None     = None
_mode:             str             = "disabled"   # "online" | "offline" | "disabled"
_last_sync_at:     datetime | None = None
_drive_restored_at: datetime | None = None
_last_error:       str | None      = None
_prev_available:   bool | None     = None

_trigger = threading.Event()   # set to wake the sleeping thread early
_stop    = threading.Event()   # set to shut the thread down
_thread: threading.Thread | None = None

_INTERVAL = 300          # fallback interval (seconds) — commit hook fires first
_hook_registered = False  # ensure we only register the SQLAlchemy hook once


# ── Helpers ───────────────────────────────────────────────────────────────────

def _db_path() -> Path:
    return (Path.cwd() / "app.db").resolve()


def _datadir_available() -> bool:
    try:
        _db_path().stat()
        return True
    except OSError:
        return False


def _do_backup(src: Path, dst: Path) -> None:
    """SQLite online backup — safe while SQLAlchemy has the source file open."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    src_conn = sqlite3.connect(str(src))
    dst_conn = sqlite3.connect(str(dst))
    try:
        src_conn.backup(dst_conn)
    finally:
        src_conn.close()
        dst_conn.close()


# ── Background thread ─────────────────────────────────────────────────────────

def _bg_loop() -> None:
    global _mode, _last_sync_at, _last_error, _prev_available, _drive_restored_at

    while not _stop.is_set():
        with _lock:
            enabled = _enabled
            mirror  = _mirror_dir

        if enabled and mirror:
            available = _datadir_available()

            with _lock:
                prev      = _prev_available
                _prev_available = available

                if available and prev is False:
                    # Drive just came back online
                    _drive_restored_at = datetime.now(UTC).replace(tzinfo=None)

            if available:
                try:
                    _do_backup(_db_path(), mirror / "app.db")
                    with _lock:
                        _last_sync_at = datetime.now(UTC).replace(tzinfo=None)
                        _last_error   = None
                        _mode         = "online"
                except Exception as exc:
                    with _lock:
                        _last_error = str(exc)
            else:
                with _lock:
                    _mode = "offline"

        # Sleep until triggered or interval expires
        _trigger.wait(timeout=_INTERVAL)
        _trigger.clear()


# ── Public API ────────────────────────────────────────────────────────────────

def init(enabled: bool, local_dir: str | None) -> None:
    """Called on startup and whenever sync settings change."""
    global _enabled, _mirror_dir, _mode, _thread

    default = Path.home() / ".foliantica" / "mirror"
    with _lock:
        _enabled    = enabled
        _mirror_dir = Path(local_dir) if local_dir else (default if enabled else None)
        _mode       = "online" if enabled else "disabled"

    if enabled and (_thread is None or not _thread.is_alive()):
        _stop.clear()
        _thread = threading.Thread(target=_bg_loop, name="sync-mirror", daemon=True)
        _thread.start()
        # Trigger an immediate first sync
        _trigger.set()
        # Hook into every SQLAlchemy commit for near-real-time mirroring
        _register_commit_hook()
    elif not enabled:
        _stop.set()
        _trigger.set()


def _register_commit_hook() -> None:
    """Register a SQLAlchemy after_commit hook so every DB write triggers a sync.

    This gives near-real-time mirroring (milliseconds after each commit) rather
    than waiting for the 5-minute poll interval. Safe to call multiple times —
    the hook is only registered once.
    """
    global _hook_registered
    if _hook_registered:
        return
    from sqlalchemy import event as _sa_event
    from sqlalchemy.orm import Session as _SASession

    @_sa_event.listens_for(_SASession, "after_commit")
    def _after_commit(session):          # noqa: F811
        if _enabled and _mirror_dir:
            _trigger.set()               # wake background thread immediately

    _hook_registered = True


def trigger_now() -> None:
    """Wake the background thread to sync immediately."""
    _trigger.set()


def shutdown_backup() -> None:
    """Final sync on shutdown (called from FastAPI lifespan)."""
    with _lock:
        enabled = _enabled
        mirror  = _mirror_dir

    if enabled and mirror and _datadir_available():
        try:
            _do_backup(_db_path(), mirror / "app.db")
        except Exception:
            pass

    _stop.set()
    _trigger.set()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/status")
def get_status():
    with _lock:
        return {
            "enabled":           _enabled,
            "mode":              _mode,
            "mirror_dir":        str(_mirror_dir) if _mirror_dir else None,
            "datadir_available": _datadir_available() if _enabled else None,
            "last_sync_at":      _last_sync_at.isoformat()      if _last_sync_at      else None,
            "drive_restored_at": _drive_restored_at.isoformat() if _drive_restored_at else None,
            "error":             _last_error,
        }


@router.post("/trigger")
def trigger_sync():
    trigger_now()
    return {"ok": True}
