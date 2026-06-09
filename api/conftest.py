# Root conftest for the api/ package.
# These env vars are read by database.py at module-import time, so they must
# be set here — before any test module (or main.py) is imported.
#
#   LW_USE_SQLITE=1   → use SQLite instead of PostgreSQL
#   LW_SQLITE_PATH=:memory: → in-memory DB with StaticPool; foliantica.db is
#                             never opened or modified during test runs
import os
os.environ.setdefault("LW_USE_SQLITE", "1")
os.environ.setdefault("LW_SQLITE_PATH", ":memory:")
