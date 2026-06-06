"""
Unit / integration tests for the PostgreSQL sync dump.

Run from the project root with PG already running:
    pytest test/test_sync_dump.py -v

Requires:
    - Embedded PG running on port 5433 with the foliantica database
    - Environment: LW_USE_SQLITE=0  LW_PG_PORT=5433  (etc.)
    - pip install pytest  (or: uv pip install pytest inside api/.venv)
"""
import os
import sys
import tempfile
from pathlib import Path

# Make the api/ package importable
sys.path.insert(0, str(Path(__file__).parent.parent / "api"))

# Point at the test PG instance
os.environ.setdefault("LW_USE_SQLITE",  "0")
os.environ.setdefault("LW_PG_PORT",     "5433")
os.environ.setdefault("LW_PG_USER",     "foliantica")
os.environ.setdefault("LW_PG_PASS",     "foliantica")
os.environ.setdefault("LW_PG_DB",       "foliantica")

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _dump_to_tmp() -> tuple[Path, str]:
    """Run _do_pg_dump into a fresh temp dir; return (mirror_dir, sql_text)."""
    from routers.sync import _do_pg_dump
    mirror = Path(tempfile.mkdtemp(prefix="fol-dump-test-"))
    _do_pg_dump(mirror)
    sql_file = mirror / "foliantica.sql"
    return mirror, sql_file.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestPgLiteral:
    """_pg_literal() — value-to-SQL-literal conversion."""

    def setup_method(self):
        from routers.sync import _pg_literal
        self.lit = _pg_literal

    def test_none_is_null(self):
        assert self.lit(None) == "NULL"

    def test_bool_true(self):
        assert self.lit(True) == "TRUE"

    def test_bool_false(self):
        assert self.lit(False) == "FALSE"

    def test_int(self):
        assert self.lit(42) == "42"

    def test_float(self):
        assert self.lit(3.14) == "3.14"

    def test_string_plain(self):
        assert self.lit("hello") == "'hello'"

    def test_string_escapes_single_quote(self):
        assert self.lit("it's") == "'it''s'"

    def test_string_escapes_backslash(self):
        assert self.lit("a\\b") == "'a\\\\b'"


class TestDumpOutput:
    """_do_pg_dump() — output file structure and content."""

    @pytest.fixture(scope="class")
    def sql(self):
        _mirror, text = _dump_to_tmp()
        return text

    def test_file_created(self):
        mirror, _ = _dump_to_tmp()
        assert (mirror / "foliantica.sql").exists()

    def test_header_comment(self, sql):
        assert "-- Foliantica PostgreSQL backup" in sql

    def test_replication_role_guards(self, sql):
        assert "session_replication_role = replica" in sql
        assert "session_replication_role = DEFAULT" in sql

    def test_contains_delete_statements(self, sql):
        assert "DELETE FROM" in sql

    def test_contains_insert_statements(self, sql):
        assert "INSERT INTO" in sql

    def test_core_tables_present(self, sql):
        for table in ("projects", "acts", "chapters", "scenes",
                      "codex_entries", "user_settings"):
            assert f'"{table}"' in sql, f"Table {table!r} missing from dump"

    def test_sequence_reset_present(self, sql):
        assert "pg_get_serial_sequence" in sql

    def test_no_pg_dump_binary_used(self):
        """Ensure _do_pg_dump never calls subprocess.run (no pg_dump binary)."""
        import subprocess as _sp
        from unittest.mock import patch
        from routers.sync import _do_pg_dump
        with patch.object(_sp, "run", side_effect=AssertionError("subprocess.run was called")), \
             tempfile.TemporaryDirectory() as tmp:
            _do_pg_dump(Path(tmp))   # must complete without touching subprocess


class TestDumpIdempotent:
    """Running the dump twice overwrites the file without error."""

    def test_overwrite(self):
        from routers.sync import _do_pg_dump
        mirror = Path(tempfile.mkdtemp(prefix="fol-dump-idem-"))
        _do_pg_dump(mirror)
        size1 = (mirror / "foliantica.sql").stat().st_size
        _do_pg_dump(mirror)
        size2 = (mirror / "foliantica.sql").stat().st_size
        assert size2 > 0
        # Second dump should be same size (deterministic)
        assert size1 == size2
