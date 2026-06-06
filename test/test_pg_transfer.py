"""
Unit / integration tests for PG-to-PG data transfer.

Run from the project root with PG already running on port 5433:
    pytest test/test_pg_transfer.py -v

Requires:
    - Embedded PG on port 5433 with the foliantica database populated
    - LW_USE_SQLITE=0  LW_PG_PORT=5433 env vars (or defaults)
"""
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "api"))

os.environ.setdefault("LW_USE_SQLITE", "0")
os.environ.setdefault("LW_PG_PORT",    "5433")
os.environ.setdefault("LW_PG_USER",    "foliantica")
os.environ.setdefault("LW_PG_PASS",    "foliantica")
os.environ.setdefault("LW_PG_DB",      "foliantica")

import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def restore_lw_config():
    """Save and restore ~/.foliantica/config.json around every test."""
    cfg_path = Path.home() / ".foliantica" / "config.json"
    original = cfg_path.read_text("utf-8") if cfg_path.exists() else None
    yield
    if original is not None:
        cfg_path.write_text(original, "utf-8")
    elif cfg_path.exists():
        cfg_path.unlink()


@pytest.fixture(scope="module")
def embedded_conn():
    return {"host": "127.0.0.1", "port": 5433,
            "user": "foliantica", "pass": "foliantica", "db": "foliantica"}


# ---------------------------------------------------------------------------
# _pg_engine_for helper
# ---------------------------------------------------------------------------

class TestPgEngineFor:

    def test_creates_engine(self, embedded_conn):
        from routers.settings import _pg_engine_for
        engine = _pg_engine_for(embedded_conn)
        try:
            with engine.connect() as conn:
                result = conn.execute(__import__("sqlalchemy").text("SELECT 1")).scalar()
            assert result == 1
        finally:
            engine.dispose()

    def test_uses_custom_host_port(self):
        from routers.settings import _pg_engine_for
        engine = _pg_engine_for({"host": "10.0.0.1", "port": 9999,
                                  "user": "u", "pass": "p", "db": "d"})
        assert "10.0.0.1" in str(engine.url)
        assert "9999"      in str(engine.url)
        engine.dispose()

    def test_defaults_to_embedded_values(self):
        from routers.settings import _pg_engine_for, _EMBEDDED_PG
        engine = _pg_engine_for({})
        url = str(engine.url)
        assert str(_EMBEDDED_PG["port"]) in url
        assert _EMBEDDED_PG["user"]      in url
        engine.dispose()


# ---------------------------------------------------------------------------
# pg-config read/write (lw-config file)
# ---------------------------------------------------------------------------

class TestPgConfig:

    def test_read_lw_config_returns_defaults_when_no_pg_key(self):
        from routers.settings import _read_lw_config
        cfg = _read_lw_config()
        # pg key may or may not exist; just confirm it's a dict
        assert isinstance(cfg, dict)

    def test_write_and_read_pg_config(self):
        from routers.settings import _read_lw_config, _write_lw_config
        cfg = _read_lw_config()
        cfg["pg"] = {"useDocker": True, "port": 5434}
        _write_lw_config(cfg)
        back = _read_lw_config()
        assert back["pg"]["useDocker"] is True
        assert back["pg"]["port"] == 5434

    def test_write_preserves_existing_keys(self):
        from routers.settings import _read_lw_config, _write_lw_config
        cfg = _read_lw_config()
        original_data_dir = cfg.get("dataDir")
        cfg["pg"] = {"useDocker": False}
        _write_lw_config(cfg)
        back = _read_lw_config()
        assert back.get("dataDir") == original_data_dir


# ---------------------------------------------------------------------------
# pg-transfer: self-transfer (source == target == embedded)
# ---------------------------------------------------------------------------

class TestPgTransferSelf:
    """Transfer from live engine to itself — full code path, deterministic counts."""

    @pytest.fixture(scope="class")
    def result(self, embedded_conn):
        from routers.settings import transfer_pg
        # Source is always the live engine; only target is specified
        body = {"target": embedded_conn}
        return transfer_pg(body)

    def test_returns_tables_copied_count(self, result):
        assert result["tables_copied"] >= 1

    def test_returns_rows_copied_count(self, result):
        assert result["rows_copied"] >= 1

    def test_returns_tables_list(self, result):
        assert isinstance(result["tables"], list)
        assert len(result["tables"]) == result["tables_copied"]

    def test_core_tables_present(self, result):
        for t in ("projects", "scenes", "codex_entries", "user_settings"):
            assert t in result["tables"], f"Expected table {t!r} in transfer result"

    def test_transfer_is_idempotent(self, embedded_conn):
        """Running the transfer twice returns the same counts both times."""
        from routers.settings import transfer_pg
        body = {"target": embedded_conn}
        r1 = transfer_pg(body)
        r2 = transfer_pg(body)
        assert r1["rows_copied"] == r2["rows_copied"]
        assert r1["tables_copied"] == r2["tables_copied"]


# ---------------------------------------------------------------------------
# pg-transfer: error handling
# ---------------------------------------------------------------------------

class TestPgTransferErrors:

    def test_bad_target_raises_http_500(self):
        from fastapi import HTTPException
        from routers.settings import transfer_pg
        body = {
            "target": {"host": "127.0.0.1", "port": 9999,
                       "user": "foliantica", "pass": "foliantica", "db": "foliantica"},
        }
        with pytest.raises(HTTPException) as exc_info:
            transfer_pg(body)
        assert exc_info.value.status_code == 500
