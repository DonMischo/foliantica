"""
Electron / PyInstaller entry point.

Sets the working directory to the configured data directory BEFORE any app
module is imported, so SQLite and uploads end up in the right place.

Priority:
  1. LW_DATA_DIR env var  (set by Electron in production)
  2. dataDir in ~/.foliantica/config.json  (set via the settings UI)
  3. Current working directory  (dev default)

Usage:
  python run.py          # production-style (no reload)
  python run.py --dev    # development (uvicorn --reload)
"""
import os
import sys
import json
from pathlib import Path

# Keep the api/ directory on sys.path so uvicorn can import main:app even
# after os.chdir() moves the working directory elsewhere.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

LW_CONFIG_FILE = Path.home() / ".foliantica" / "config.json"

def _read_config() -> dict:
    try:
        return json.loads(LW_CONFIG_FILE.read_text("utf-8"))
    except Exception:
        return {}

if __name__ == "__main__":
    # ── Stash absolute script path BEFORE any chdir ───────────────────────────
    # The restart endpoint uses this so os.execv can find run.py regardless of
    # where the working directory ends up after os.chdir(data_dir).
    os.environ.setdefault("LW_RUN_SCRIPT", os.path.abspath(__file__))

    # ── Resolve data directory ────────────────────────────────────────────────
    data_dir = os.environ.get("LW_DATA_DIR") or _read_config().get("dataDir")

    if data_dir:
        try:
            os.makedirs(data_dir, exist_ok=True)
            os.makedirs(os.path.join(data_dir, "uploads"), exist_ok=True)
            os.chdir(data_dir)
        except OSError as e:
            print(f"WARNING: configured data directory '{data_dir}' is not available ({e}).")
            print("         Starting in current directory. Check that the drive is mounted.")
            # data_dir stays set so config is preserved; we just don't chdir

    # ── Start server ──────────────────────────────────────────────────────────
    import uvicorn  # noqa: E402

    port = int(os.environ.get("LW_API_PORT", "8765"))
    host = os.environ.get("LW_API_HOST", "127.0.0.1")
    dev  = "--dev" in sys.argv

    if dev:
        src_dir = os.path.dirname(os.path.abspath(__file__))
        uvicorn.run("main:app", host=host, port=port, reload=True, reload_dirs=[src_dir],
                    reload_excludes=[os.path.join(src_dir, "tests")], log_level="info")
    else:
        from main import app  # noqa: E402  (import after chdir for correct DB path)
        uvicorn.run(app, host=host, port=port, workers=1, log_level="warning")
