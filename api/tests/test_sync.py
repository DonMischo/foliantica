"""
Tests for sync behaviour focused on the crypto-key isolation invariants:
  - Encrypted columns are excluded from the SQL dump
  - Restore re-applies the machine-local keys that were present before the restore
"""
import json
import pytest
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

        dump = tmp_path / "foliantica.sql"
        dump.write_text(
            "DELETE FROM user_settings;\n"
            "INSERT INTO user_settings (id, default_model) VALUES (1, '');\n"
        )

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

    def test_restore_endpoint_requires_dump_file(self, client):
        """Without a dump file present, restore must return 404."""
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
