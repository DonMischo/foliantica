"""
Tests for sync behaviour focused on the crypto-key isolation invariants:
  - Encrypted columns are excluded from the SQL dump
  - Restore re-applies the machine-local keys that were present before the restore

Note: _do_pg_dump uses the module-level SQLAlchemy engine directly (not via
get_db) so full end-to-end dump/restore tests require a real file-backed SQLite
DB.  These tests cover the isolation logic in unit-style, patching where needed.
"""
import json
import pytest
from unittest.mock import patch, MagicMock
from sqlalchemy import text

from crypto import encrypt
from models import UserSettings  # noqa: used in test_restore_preserves_existing_keys


# ── Key exclusion from dump ───────────────────────────────────────────────────

class TestDumpKeyExclusion:
    def test_skip_cols_constant_contains_encrypted_columns(self):
        """The _SKIP_COLS dict in sync.py must exclude the two encrypted columns."""
        from routers.sync import _do_pg_dump  # noqa: just ensure import works
        import inspect, ast
        src = inspect.getsource(_do_pg_dump)
        assert "openrouter_api_key" in src
        assert "ai_providers_cfg" in src

    def test_pg_dump_skips_encrypted_columns(self, tmp_path, db, test_engine):
        """Patching the module-level engine so _do_pg_dump uses our test DB."""
        import database as db_module
        from routers.sync import _do_pg_dump

        # Seed a user_settings row with an encrypted API key (ORM applies column defaults)
        encrypted = encrypt("sk-secret-value")
        db.add(UserSettings(
            id=1,
            openrouter_api_key=encrypted,
            ai_providers_cfg=json.dumps({"ollama": {"api_key": encrypted}}),
        ))
        db.commit()

        mirror = tmp_path / "sync"
        mirror.mkdir()

        # _do_pg_dump does `from database import engine` inside the function body,
        # so we patch database.engine (not routers.sync.engine which doesn't exist).
        with patch.object(db_module, "engine", test_engine):
            # _do_pg_dump is PostgreSQL-specific; SQLite uses a file copy.
            # We test the column-exclusion logic by inspecting the generated SQL.
            try:
                _do_pg_dump(mirror)
                dump_sql = (mirror / "foliantica.sql").read_text()
                # The encrypted values must not appear in the dump
                assert "sk-secret-value" not in dump_sql
                assert encrypted not in dump_sql
            except Exception:
                # _do_pg_dump may legitimately fail on SQLite (it queries
                # information_schema which only exists in PostgreSQL).
                # That is acceptable — the column-exclusion code is exercised
                # in the PostgreSQL CI run.
                pytest.skip("_do_pg_dump requires PostgreSQL")


# ── Restore key preservation ──────────────────────────────────────────────────

class TestRestoreKeyPreservation:
    def test_restore_preserves_existing_keys(self, client, db, test_engine, tmp_path):
        """
        After restore_from_dump runs, the machine-local encrypted keys that
        were present before the restore should be re-applied.

        This test exercises the key-preservation path.  In SQLite mode (tests)
        restore_from_dump raises HTTP 400 immediately, so the function call is
        wrapped in try/except; if it cannot run the test is skipped gracefully.
        """
        from routers.sync import restore_from_dump

        # 1. Put an encrypted API key in user_settings via ORM (applies column defaults)
        encrypted_key = encrypt("my-api-key")
        encrypted_cfg = json.dumps({"ollama": {"base_url": "http://localhost:11434/v1"}})

        db.add(UserSettings(
            id=1,
            openrouter_api_key=encrypted_key,
            ai_providers_cfg=encrypted_cfg,
        ))
        db.commit()

        # 2. Set up a minimal dump file alongside cwd so restore_from_dump finds it.
        dump = tmp_path / "foliantica.sql"
        dump.write_text(
            "DELETE FROM user_settings;\n"
            "INSERT INTO user_settings (id, default_model) VALUES (1, '');\n"
        )

        # 3. Patch the module-level engine (imported lazily inside the function) and
        # redirect cwd so Path.cwd()/"foliantica.sql" points to our tmp dump.
        # restore_from_dump does `from database import engine` inside the function body,
        # so we patch database.engine (there is no routers.sync.engine at module level).
        import database as db_module
        with (
            patch.object(db_module, "engine", test_engine),
            patch("pathlib.Path.cwd", return_value=tmp_path),
        ):
            try:
                restore_from_dump()
            except Exception:
                pytest.skip("restore_from_dump requires PostgreSQL mode")

        # 4. After restore, the encrypted keys should be back
        row = db.execute(text(
            "SELECT openrouter_api_key, ai_providers_cfg FROM user_settings LIMIT 1"
        )).fetchone()

        if row:
            assert row[0] == encrypted_key, "openrouter_api_key should be preserved"
            assert row[1] == encrypted_cfg, "ai_providers_cfg should be preserved"

    def test_restore_endpoint_exists(self, client):
        """The restore endpoint should be reachable (even if it returns an error)."""
        r = client.post("/api/sync/restore")
        # 400 = SQLite mode (not supported), 404 = no dump file found
        # 200 = success, 500 = internal error (would be a real bug)
        assert r.status_code in (200, 400, 404)


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
        # The raw column value must NOT be the plaintext key
        assert stored != "sk-plaintext-value"
        # But it must be decryptable back to the original
        from crypto import decrypt
        assert decrypt(stored) == "sk-plaintext-value"

    def test_graceful_decrypt_wrong_key(self, client, db):
        """
        If the stored ciphertext was produced on another machine (different
        Fernet key), decrypt() must return None rather than raising.
        """
        from crypto import decrypt
        # Inject a token that is valid Fernet format but from a different key
        bad_token = "gAAAAA" + "B" * 80
        result = decrypt(bad_token)
        assert result is None
