"""
Tests for sync behaviour focused on the crypto-key isolation invariants:
  - Encrypted columns are excluded from the SQL dump
  - Restore re-applies the machine-local keys that were present before the restore
"""
import json
import pytest
from pathlib import Path
from unittest.mock import patch
from sqlalchemy import text

from crypto import encrypt
from models import UserSettings


# ── Key exclusion from dump ───────────────────────────────────────────────────

class TestDumpKeyExclusion:
    def test_pg_dump_excludes_encrypted_columns(self, client, db, test_engine, tmp_path):
        """_do_pg_dump must omit the two encrypted columns from the dump output."""
        import database as db_module
        from routers.sync import _do_pg_dump

        encrypted = encrypt("sk-should-not-appear")
        db.add(UserSettings(
            id=1,
            openrouter_api_key=encrypted,
            ai_providers_cfg=json.dumps({"test": encrypted}),
        ))
        db.commit()

        mirror = tmp_path / "sync"
        mirror.mkdir()
        with patch.object(db_module, "engine", test_engine):
            _do_pg_dump(mirror)

        dump_sql = (mirror / "foliantica.sql").read_text()
        assert "sk-should-not-appear" not in dump_sql
        assert encrypted not in dump_sql

    def test_pg_dump_skips_encrypted_columns(self, tmp_path, db, test_engine):
        """Patching the module-level engine so _do_pg_dump uses our test DB."""
        import database as db_module
        from routers.sync import _do_pg_dump

        encrypted = encrypt("sk-secret-value")
        db.add(UserSettings(
            id=1,
            openrouter_api_key=encrypted,
            ai_providers_cfg=json.dumps({"ollama": {"api_key": encrypted}}),
        ))
        db.commit()

        mirror = tmp_path / "sync"
        mirror.mkdir()

        with patch.object(db_module, "engine", test_engine):
            _do_pg_dump(mirror)
            dump_sql = (mirror / "foliantica.sql").read_text()
            assert "sk-secret-value" not in dump_sql
            assert encrypted not in dump_sql


# ── Restore key preservation ──────────────────────────────────────────────────

class TestRestoreKeyPreservation:
    def test_restore_preserves_existing_keys(self, client, db, test_engine, tmp_path):
        """
        After restore_from_dump runs, the machine-local encrypted keys that
        were present before the restore should be re-applied.
        """
        from routers.sync import restore_from_dump

        encrypted_key = encrypt("my-api-key")
        encrypted_cfg = json.dumps({"ollama": {"base_url": "http://localhost:11434/v1"}})

        db.add(UserSettings(
            id=1,
            openrouter_api_key=encrypted_key,
            ai_providers_cfg=encrypted_cfg,
        ))
        db.commit()

        fixture = Path(__file__).parent / "fixtures" / "user_settings_no_keys.sql"
        dump = tmp_path / "foliantica.sql"
        dump.write_text(fixture.read_text())

        import database as db_module
        with (
            patch.object(db_module, "engine", test_engine),
            patch("pathlib.Path.cwd", return_value=tmp_path),
        ):
            restore_from_dump()

        row = db.execute(text(
            "SELECT openrouter_api_key, ai_providers_cfg FROM user_settings LIMIT 1"
        )).fetchone()

        if row:
            assert row[0] == encrypted_key, "openrouter_api_key should be preserved"
            assert row[1] == encrypted_cfg, "ai_providers_cfg should be preserved"

    def test_restore_endpoint_requires_dump_file(self, client, tmp_path):
        """Without a dump file present, restore must return 404."""
        with patch("pathlib.Path.cwd", return_value=tmp_path):
            r = client.post("/api/sync/restore")
        assert r.status_code == 404


# ── Settings key column round-trip ────────────────────────────────────────────

class TestApiKeyRoundTrip:
    def test_key_is_encrypted_at_rest(self, client, db):
        """API keys must never be stored as plaintext."""
        client.post("/api/settings/providers/openrouter",
                    json={"api_key": "sk-plaintext-value"})

        row = db.execute(text(
            "SELECT openrouter_api_key FROM user_settings LIMIT 1"
        )).fetchone()
        assert row is not None
        stored = row[0]
        assert stored != "sk-plaintext-value"
        from crypto import decrypt
        assert decrypt(stored) == "sk-plaintext-value"

    def test_graceful_decrypt_wrong_key(self, client, db):
        """
        If the stored ciphertext was produced on another machine (different
        Fernet key), decrypt() must return None rather than raising.
        """
        from crypto import decrypt
        bad_token = "gAAAAA" + "B" * 80
        result = decrypt(bad_token)
        assert result is None


# ── Dump endpoint (POST /api/sync/dump) ───────────────────────────────────────

class TestDumpEndpoint:
    def test_creates_sql_file(self, client, test_engine, tmp_path):
        import database as db_module
        with (
            patch.object(db_module, "engine", test_engine),
            patch("pathlib.Path.cwd", return_value=tmp_path),
        ):
            r = client.post("/api/sync/dump?force=true")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert "dump_time" in body
        assert (tmp_path / "foliantica.sql").exists()
        content = (tmp_path / "foliantica.sql").read_text()
        assert "Foliantica PostgreSQL backup" in content

    def test_returns_409_when_file_exists(self, client, tmp_path):
        (tmp_path / "foliantica.sql").write_text("-- existing dump\n")
        with patch("pathlib.Path.cwd", return_value=tmp_path):
            r = client.post("/api/sync/dump")   # force=False (default)
        assert r.status_code == 409
        detail = r.json()["detail"]
        assert detail["exists"] is True
        assert "dump_time" in detail
        assert "size" in detail

    def test_force_overwrites_existing_file(self, client, test_engine, tmp_path):
        (tmp_path / "foliantica.sql").write_text("-- old content\n")
        import database as db_module
        with (
            patch.object(db_module, "engine", test_engine),
            patch("pathlib.Path.cwd", return_value=tmp_path),
        ):
            r = client.post("/api/sync/dump?force=true")
        assert r.status_code == 200
        content = (tmp_path / "foliantica.sql").read_text()
        assert "Foliantica PostgreSQL backup" in content


# ── Restore endpoint (POST /api/sync/restore) ─────────────────────────────────

class TestRestoreEndpoint:
    def test_replays_statements_returns_ok(self, client, test_engine, tmp_path):
        dump = tmp_path / "foliantica.sql"
        dump.write_text(
            "SET session_replication_role = replica;\n"
            "SET session_replication_role = DEFAULT;\n"
        )
        import database as db_module
        with (
            patch.object(db_module, "engine", test_engine),
            patch("pathlib.Path.cwd", return_value=tmp_path),
        ):
            r = client.post("/api/sync/restore")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["statements"] >= 1

    def test_roundtrip_preserves_data(self, client, test_engine, tmp_path, project):
        """Dump the DB, delete the project, restore — project should be back."""
        import database as db_module
        with (
            patch.object(db_module, "engine", test_engine),
            patch("pathlib.Path.cwd", return_value=tmp_path),
        ):
            assert client.post("/api/sync/dump?force=true").status_code == 200
            client.delete(f"/api/projects/{project['id']}")
            assert client.post("/api/sync/restore").status_code == 200
        assert client.get(f"/api/projects/{project['id']}").status_code == 200


# ── _pg_literal unit tests ────────────────────────────────────────────────────

class TestPgLiteral:
    def setup_method(self):
        from routers.sync import _pg_literal
        self._pg_literal = _pg_literal

    def test_none_returns_null(self):
        assert self._pg_literal(None) == "NULL"

    def test_bool_true(self):
        assert self._pg_literal(True) == "TRUE"

    def test_bool_false(self):
        assert self._pg_literal(False) == "FALSE"

    def test_int(self):
        assert self._pg_literal(42) == "42"

    def test_float(self):
        result = self._pg_literal(3.14)
        assert "3.14" in result

    def test_string_simple(self):
        result = self._pg_literal("hello")
        assert result == "E'hello'"

    def test_string_with_newline(self):
        result = self._pg_literal("line1\nline2")
        assert "\\n" in result

    def test_string_with_single_quote(self):
        result = self._pg_literal("it's")
        assert "''" in result


# ── _iter_sql_statements unit tests ──────────────────────────────────────────

class TestIterSqlStatements:
    def setup_method(self):
        from routers.sync import _iter_sql_statements
        self._iter = _iter_sql_statements

    def test_empty_string(self):
        assert list(self._iter("")) == []

    def test_single_statement(self):
        stmts = list(self._iter("SELECT 1;"))
        assert stmts == ["SELECT 1"]

    def test_multiple_statements(self):
        sql = "DELETE FROM foo;\nINSERT INTO foo VALUES (1);\n"
        stmts = list(self._iter(sql))
        assert len(stmts) == 2

    def test_comment_skipped(self):
        sql = "-- This is a comment\nSELECT 1;\n"
        stmts = list(self._iter(sql))
        assert len(stmts) == 1
        assert "comment" not in stmts[0]

    def test_semicolon_in_string_not_split(self):
        sql = "INSERT INTO t VALUES (E'a;b');\n"
        stmts = list(self._iter(sql))
        assert len(stmts) == 1
        assert "a;b" in stmts[0]

    def test_escaped_quote_in_e_string(self):
        sql = "INSERT INTO t VALUES (E'it''s ok');\n"
        stmts = list(self._iter(sql))
        assert len(stmts) == 1
        assert "it''s ok" in stmts[0]

    def test_backslash_escape_in_e_string(self):
        sql = r"INSERT INTO t VALUES (E'line1\nline2');" + "\n"
        stmts = list(self._iter(sql))
        assert len(stmts) == 1

    def test_trailing_without_semicolon(self):
        sql = "SELECT 1;\nSELECT 2"  # no trailing semicolon
        stmts = list(self._iter(sql))
        assert len(stmts) == 2
        assert "SELECT 2" in stmts


# ── _sync_uploads unit tests ──────────────────────────────────────────────────

class TestSyncUploads:
    def test_nonexistent_src_is_noop(self, tmp_path):
        from routers.sync import _sync_uploads
        src = tmp_path / "no_such_dir"
        dst = tmp_path / "dst"
        _sync_uploads(src, dst)  # should not raise
        assert not dst.exists()

    def test_copies_new_files(self, tmp_path):
        from routers.sync import _sync_uploads
        src = tmp_path / "src"
        dst = tmp_path / "dst"
        src.mkdir()
        (src / "file.txt").write_text("hello")
        _sync_uploads(src, dst)
        assert (dst / "file.txt").read_text() == "hello"

    def test_skips_already_synced_files(self, tmp_path):
        from routers.sync import _sync_uploads
        src = tmp_path / "src"
        dst = tmp_path / "dst"
        src.mkdir()
        dst.mkdir()
        src_file = src / "file.txt"
        src_file.write_text("original")
        dst_file = dst / "file.txt"
        dst_file.write_text("original")
        # Make dst newer than src — should not be overwritten
        import os, time
        future = time.time() + 3600
        os.utime(dst_file, (future, future))
        _sync_uploads(src, dst)
        assert dst_file.read_text() == "original"


# ── GET /api/sync/status ──────────────────────────────────────────────────────

class TestSyncStatus:
    def test_status_returns_fields(self, client):
        r = client.get("/api/sync/status")
        assert r.status_code == 200
        body = r.json()
        assert "enabled" in body
        assert "mode" in body
        assert "mirror_dir" in body
        assert "last_sync_at" in body
        assert "error" in body


# ── POST /api/sync/trigger ────────────────────────────────────────────────────

class TestSyncTrigger:
    def test_trigger_returns_ok(self, client):
        r = client.post("/api/sync/trigger")
        assert r.status_code == 200
        assert r.json()["ok"] is True


# ── Restore exception path ────────────────────────────────────────────────────

class TestRestoreExceptionPath:
    def test_restore_returns_500_on_bad_sql(self, client, tmp_path):
        dump = tmp_path / "foliantica.sql"
        dump.write_text("THIS IS NOT VALID SQL;\n")
        import database as db_module
        from routers.sync import restore_from_dump
        with patch("pathlib.Path.cwd", return_value=tmp_path):
            r = client.post("/api/sync/restore")
        assert r.status_code == 500

    def test_restore_saves_and_reapplies_keys(self, client, db, test_engine, tmp_path):
        """Keys present before restore should survive after restore."""
        from routers.sync import restore_from_dump
        from crypto import encrypt
        import database as db_module

        encrypted_key = encrypt("preserved-key")
        db.add(UserSettings(id=1, openrouter_api_key=encrypted_key))
        db.commit()

        fixture = Path(__file__).parent / "fixtures" / "user_settings_no_keys.sql"
        dump = tmp_path / "foliantica.sql"
        dump.write_text(fixture.read_text())

        with (
            patch.object(db_module, "engine", test_engine),
            patch("pathlib.Path.cwd", return_value=tmp_path),
        ):
            r = client.post("/api/sync/restore")
        assert r.status_code == 200


# ── Dump endpoint exception path ──────────────────────────────────────────────

class TestDumpExceptionPath:
    def test_dump_returns_500_on_error(self, client, tmp_path):
        """If _do_pg_dump raises, /dump returns 500."""
        with (
            patch("routers.sync._do_pg_dump", side_effect=Exception("DB error")),
            patch("pathlib.Path.cwd", return_value=tmp_path),
        ):
            r = client.post("/api/sync/dump?force=true")
        assert r.status_code == 500
