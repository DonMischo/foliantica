# Root conftest for the api/ package.
# These env vars are read by database.py at module-import time, so they must
# be set here — before any test module (or main.py) is imported.
import os
os.environ.setdefault("LW_PG_HOST", "127.0.0.1")
os.environ.setdefault("LW_PG_PORT", "5433")
os.environ.setdefault("LW_PG_USER", "foliantica")
os.environ.setdefault("LW_PG_PASS", "foliantica")
os.environ.setdefault("LW_PG_DB",   "foliantica_test")
