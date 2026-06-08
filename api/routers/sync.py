"""
DB mirror sync — keeps a local copy of the database AND uploads in sync with
the primary dataDir (which may live on a sync drive / NAS / cloud folder).

Architecture:
  - Backend always runs from dataDir (unchanged).
  - This module maintains a mirror copy at sync_local_dir.
  - A background thread wakes every 5 minutes and:
      1. SQLite: copies foliantica.db via SQLite's online backup API.
         PostgreSQL: writes foliantica.sql via a pure-Python dump (no
         pg_dump binary required — embedded-postgres does not ship it).
      2. Mirrors uploads/ → sync_local_dir/uploads/, copying only files
         that are new or have a newer mtime (no unnecessary I/O).
  - When the drive becomes unavailable the copy is skipped; mode → "offline".
  - When the drive comes back online, mode → "online", drive_restored_at is
    set so the frontend can surface a notification.
"""
import os
import shutil
import sqlite3
import threading
from datetime import datetime, UTC
from pathlib import Path

from fastapi import APIRouter, HTTPException
from database import USE_SQLITE

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

_auto_dump_written: bool = False  # True once auto-sync or the Dump button has written a dump
                                  # this session; guards against silently overwriting a user-
                                  # placed dump that may represent a different data state.

_INTERVAL = 300          # fallback interval (seconds) — commit hook fires first
_hook_registered = False  # ensure we only register the SQLAlchemy hook once


# ── Helpers ───────────────────────────────────────────────────────────────────

def _db_path() -> Path:
    return (Path.cwd() / "foliantica.db").resolve()


def _uploads_path() -> Path:
    return (Path.cwd() / "uploads").resolve()


def _datadir_available() -> bool:
    if not USE_SQLITE:
        return True  # PostgreSQL runs locally — always reachable
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


def _pg_literal(v: object) -> str:
    """Render a Python value as a PostgreSQL SQL literal (for INSERT statements).

    Uses E'...' escape-string syntax so that newlines and other control chars
    can be escaped as \\n / \\r / \\t, keeping every INSERT on a single line.
    Single-line statements are safe to split on ';' during restore.
    """
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    s = str(v)
    s = s.replace("\\", "\\\\")   # must be first — escape existing backslashes
    s = s.replace("'",  "''")     # standard SQL quote escaping (valid in E'')
    s = s.replace("\n", "\\n")    # newline → \n  (E'' interprets this)
    s = s.replace("\r", "\\r")    # carriage return
    s = s.replace("\t", "\\t")    # tab
    return "E'" + s + "'"


def _do_pg_dump(mirror: Path) -> None:
    """Dump the PostgreSQL database to a plain-SQL file in the mirror directory.

    Uses pure Python / SQLAlchemy — no pg_dump binary required.
    The output file can be replayed with psql or the /api/sync/restore endpoint.
    """
    from sqlalchemy import text
    from database import engine

    mirror.mkdir(parents=True, exist_ok=True)
    dst = mirror / "foliantica.sql"

    with engine.connect() as conn, open(dst, "w", encoding="utf-8") as f:
        # Use information_schema directly — avoids SQLAlchemy reflection which
        # breaks on PG 17 domain introspection with some SQLAlchemy versions.
        tables = [
            row[0] for row in conn.execute(text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' "
                "ORDER BY table_name"
            ))
        ]

        # Columns that contain ciphertext encrypted with a machine-local key.
        # Excluding them from the dump means restored databases start with NULL
        # (no key configured) instead of undecryptable garbage from the source.
        _SKIP_COLS: dict[str, set[str]] = {
            "user_settings": {"openrouter_api_key", "ai_providers_cfg"},
        }

        f.write(f"-- Foliantica PostgreSQL backup {datetime.now(UTC).replace(tzinfo=None).isoformat()}\n")
        f.write("SET session_replication_role = replica;\n\n")

        for table in tables:
            all_cols = [
                row[0] for row in conn.execute(text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = :t "
                    "ORDER BY ordinal_position"
                ), {"t": table})
            ]
            skip    = _SKIP_COLS.get(table, set())
            cols    = [c for c in all_cols if c not in skip]
            col_sql = ", ".join(f'"{c}"' for c in cols)
            rows    = conn.execute(text(f'SELECT {col_sql} FROM "{table}"')).fetchall()

            f.write(f"-- {table}\n")
            f.write(f'DELETE FROM "{table}";\n')
            for row in rows:
                vals = ", ".join(_pg_literal(v) for v in row)
                f.write(f'INSERT INTO "{table}" ({col_sql}) VALUES ({vals});\n')

            # Reset SERIAL sequence so new inserts don't collide with restored IDs
            if rows and "id" in cols:
                f.write(
                    f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM \"{table}\"), 0) + 1, false);\n"
                )
            f.write("\n")

        f.write("SET session_replication_role = DEFAULT;\n")


def _sync_uploads(src_dir: Path, dst_dir: Path) -> None:
    """Mirror src_dir → dst_dir, copying only new or changed files (by mtime)."""
    if not src_dir.exists():
        return
    for src_file in src_dir.rglob("*"):
        if not src_file.is_file():
            continue
        dst_file = dst_dir / src_file.relative_to(src_dir)
        dst_file.parent.mkdir(parents=True, exist_ok=True)
        if not dst_file.exists() or src_file.stat().st_mtime > dst_file.stat().st_mtime:
            shutil.copy2(str(src_file), str(dst_file))


# ── Background thread ─────────────────────────────────────────────────────────

def _bg_loop() -> None:
    global _mode, _last_sync_at, _last_error, _prev_available, _drive_restored_at

    while not _stop.is_set():
        with _lock:
            enabled = _enabled
            mirror  = _mirror_dir

        if enabled and not USE_SQLITE:
            # ── PostgreSQL + Data Mirror enabled ─────────────────────────────
            # Dump to CWD (= dataDir) and optionally copy to the mirror dir.
            # Only runs when Data Mirror is explicitly enabled — avoids
            # overwriting an existing foliantica.sql the user placed there.
            global _auto_dump_written
            cwd = Path.cwd()
            dump_path = cwd / "foliantica.sql"
            if dump_path.exists() and not _auto_dump_written:
                # A dump exists that we did not write this session.  It may
                # represent a different or older data state — protect it the
                # same way the Dump button does (require explicit user action).
                with _lock:
                    _last_error = (
                        "Auto-sync skipped: a dump file already exists. "
                        "Use the Dump button in Settings to confirm overwrite."
                    )
            else:
                try:
                    _do_pg_dump(cwd)      # writes cwd/foliantica.sql
                    _auto_dump_written = True
                    if mirror:
                        mirror.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(str(cwd / "foliantica.sql"),
                                     str(mirror / "foliantica.sql"))
                        _sync_uploads(_uploads_path(), mirror / "uploads")
                    with _lock:
                        _last_sync_at = datetime.now(UTC).replace(tzinfo=None)
                        _last_error   = None
                        _mode         = "online"
                except Exception as exc:
                    with _lock:
                        _last_error = str(exc)

        elif enabled and mirror:
            # ── SQLite mode (legacy) ─────────────────────────────────────────
            available = _datadir_available()

            with _lock:
                prev      = _prev_available
                _prev_available = available

                if available and prev is False:
                    # Drive just came back online
                    _drive_restored_at = datetime.now(UTC).replace(tzinfo=None)

            if available:
                try:
                    _do_backup(_db_path(), mirror / "foliantica.db")
                    _sync_uploads(_uploads_path(), mirror / "uploads")
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
        # Active mirror path: only meaningful when enabled (or PG-mode always-dump).
        # Set to None when explicitly disabled so endpoints can't reference stale paths.
        _mirror_dir = (Path(local_dir) if local_dir else default) if enabled else None
        # Background sync only runs when Data Mirror is explicitly enabled.
        _mode = "online" if enabled else "disabled"

    # Run the background thread only when Data Mirror is enabled.
    # In PG mode without Data Mirror, dumps are purely on-demand (Dump button).
    should_run = enabled
    if should_run and (_thread is None or not _thread.is_alive()):
        _stop.clear()
        _thread = threading.Thread(target=_bg_loop, name="sync-mirror", daemon=True)
        _thread.start()
        # Trigger an immediate first sync
        _trigger.set()
        # Hook into every SQLAlchemy commit for near-real-time syncing
        _register_commit_hook()
    elif USE_SQLITE and not enabled:
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
        # Only trigger when Data Mirror is enabled — avoids surprise overwrites.
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

    try:
        if not USE_SQLITE:
            cwd = Path.cwd()
            # Only overwrite a dump that we wrote this session.
            if _auto_dump_written or not (cwd / "foliantica.sql").exists():
                _do_pg_dump(cwd)
            if enabled and mirror:
                mirror.mkdir(parents=True, exist_ok=True)
                shutil.copy2(str(cwd / "foliantica.sql"),
                             str(mirror / "foliantica.sql"))
                _sync_uploads(_uploads_path(), mirror / "uploads")
        elif enabled and mirror and _datadir_available():
            _do_backup(_db_path(), mirror / "foliantica.db")
            _sync_uploads(_uploads_path(), mirror / "uploads")
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


@router.post("/dump")
def dump_to_datadir(force: bool = False):
    """Dump the PostgreSQL database to foliantica.sql in the current dataDir immediately.

    Writes synchronously to the API's working directory (= the configured Sync Dir,
    typically a cloud folder). Does not require Data Mirror to be enabled.

    If an existing dump is found and force=false (default), returns HTTP 409 with
    the existing file's timestamp so the caller can ask the user to confirm before
    overwriting.  Pass force=true to overwrite unconditionally.
    """
    if USE_SQLITE:
        raise HTTPException(status_code=400,
                            detail="Explicit dump requires PostgreSQL mode")
    cwd = Path.cwd()
    dump_path = cwd / "foliantica.sql"

    if dump_path.exists() and not force:
        existing_mtime = datetime.fromtimestamp(
            dump_path.stat().st_mtime, UTC
        ).replace(tzinfo=None).isoformat()
        raise HTTPException(status_code=409, detail={
            "exists": True,
            "dump_time": existing_mtime,
            "size": dump_path.stat().st_size,
        })

    try:
        _do_pg_dump(cwd)
        # Mark that we've now written a dump this session so auto-sync may
        # overwrite it freely going forward.
        global _auto_dump_written
        _auto_dump_written = True
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    mtime = datetime.fromtimestamp(
        dump_path.stat().st_mtime, UTC
    ).replace(tzinfo=None).isoformat()
    return {"ok": True, "dump": str(dump_path), "dump_time": mtime}


def _iter_sql_statements(sql: str):
    """Yield individual SQL statements from a dump string.

    Handles both old-style dumps (literal newlines in strings) and new-style
    dumps (E'...' with \\n escapes).  Correctly ignores -- comments and ';'
    characters that appear inside single-quoted strings.
    """
    buf: list[str] = []
    in_str = False
    escape_next = False   # True after a backslash inside an E'' string
    i = 0
    n = len(sql)

    while i < n:
        ch = sql[i]

        if escape_next:
            buf.append(ch)
            escape_next = False
            i += 1
            continue

        if in_str:
            buf.append(ch)
            if ch == "\\":
                escape_next = True          # E'' escape sequence — consume next char
            elif ch == "'":
                if i + 1 < n and sql[i + 1] == "'":
                    buf.append("'")         # '' → escaped single quote
                    i += 2
                    continue
                else:
                    in_str = False          # end of quoted string
        else:
            if ch == "-" and i + 1 < n and sql[i + 1] == "-":
                # SQL line comment — skip to end of line
                while i < n and sql[i] != "\n":
                    i += 1
                continue
            elif ch == ";":
                stmt = "".join(buf).strip()
                if stmt:
                    yield stmt
                buf = []
                i += 1
                continue
            else:
                if ch == "'":
                    in_str = True
                buf.append(ch)
        i += 1

    # Any trailing content without a final semicolon
    stmt = "".join(buf).strip()
    if stmt:
        yield stmt


@router.post("/restore")
def restore_from_dump():
    """Restore the database from foliantica.sql in the configured mirror directory.

    Executes each statement from the dump against the live PostgreSQL engine.
    The dump is produced by _do_pg_dump() — pure SQL with one statement per line,
    so splitting on ';\\n' is safe for the format we generate.
    """
    if USE_SQLITE:
        raise HTTPException(status_code=400,
                            detail="Restore from dump requires PostgreSQL mode")

    # Restore from the sync dir (cwd) — same location the /dump endpoint writes to.
    # Data Mirror is a separate optional backup and is not required for restore.
    dump_path = Path.cwd() / "foliantica.sql"
    if not dump_path.exists():
        raise HTTPException(status_code=404,
                            detail=f"No dump found at {dump_path}. Trigger a sync first.")

    sql_text = dump_path.read_text("utf-8")

    from sqlalchemy import text
    from database import engine

    # Save machine-local encrypted values before the dump overwrites user_settings.
    # These columns are intentionally excluded from dumps (they hold ciphertext
    # encrypted with a machine-local key and are meaningless on other machines),
    # so restoring the dump would set them to NULL.  We preserve whatever this
    # machine already has so the user doesn't lose their configured API keys.
    _saved_keys: dict | None = None
    try:
        with engine.connect() as conn:
            row = conn.execute(text(
                "SELECT openrouter_api_key, ai_providers_cfg FROM user_settings LIMIT 1"
            )).fetchone()
            if row:
                _saved_keys = {"openrouter_api_key": row[0], "ai_providers_cfg": row[1]}
    except Exception:
        pass  # table may not exist yet on fresh install — restore will create it

    stmts = 0
    try:
        with engine.connect() as conn:
            for stmt in _iter_sql_statements(sql_text):
                conn.execute(text(stmt))
                stmts += 1
            conn.commit()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # Re-apply the machine-local keys that were saved above.
    if _saved_keys and (_saved_keys["openrouter_api_key"] or _saved_keys["ai_providers_cfg"]):
        try:
            with engine.begin() as conn:
                conn.execute(text(
                    "UPDATE user_settings "
                    "SET openrouter_api_key = :k, ai_providers_cfg = :c"
                ), {"k": _saved_keys["openrouter_api_key"], "c": _saved_keys["ai_providers_cfg"]})
        except Exception:
            pass  # best-effort; non-fatal if the restored row has a different schema

    mtime = datetime.fromtimestamp(
        dump_path.stat().st_mtime, UTC
    ).replace(tzinfo=None).isoformat()
    return {"ok": True, "dump": str(dump_path), "dump_time": mtime, "statements": stmts}
