"""
Tests for api/crypto.py — secret key loading, migration, and encryption.

Run from the project root with the api venv active:
    pytest test/test_crypto.py -v

These tests never touch ~/.foliantica/.secret_key — every path is
redirected to a pytest tmp_path directory via monkeypatching.
"""
import base64
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "api"))

import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def isolate_key_paths(tmp_path, monkeypatch):
    """Redirect _KEY_DIR / _KEY_FILE to tmp_path and chdir there so that
    the legacy Path('.secret_key') inside _load_or_create_key also resolves
    into the temp directory."""
    import crypto
    key_dir  = tmp_path / "dot_foliantica"
    key_file = key_dir / ".secret_key"
    monkeypatch.setattr(crypto, "_KEY_DIR",  key_dir)
    monkeypatch.setattr(crypto, "_KEY_FILE", key_file)
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("FOLIANTICA_SECRET_KEY", raising=False)
    yield key_dir, key_file


# ---------------------------------------------------------------------------
# _load_or_create_key — path resolution and migration logic
# ---------------------------------------------------------------------------

class TestLoadOrCreateKey:

    def test_generates_key_on_first_run(self):
        import crypto
        key = crypto._load_or_create_key()
        assert isinstance(key, bytes) and len(key) > 0

    def test_creates_local_dir_on_first_run(self):
        import crypto
        assert not crypto._KEY_DIR.exists()
        crypto._load_or_create_key()
        assert crypto._KEY_DIR.exists()

    def test_writes_key_to_local_file(self):
        import crypto
        key = crypto._load_or_create_key()
        assert crypto._KEY_FILE.exists()
        assert crypto._KEY_FILE.read_bytes().strip() == key

    def test_same_key_returned_on_second_call(self):
        import crypto
        assert crypto._load_or_create_key() == crypto._load_or_create_key()

    def test_reads_existing_local_key(self):
        from cryptography.fernet import Fernet
        import crypto
        preset = Fernet.generate_key()
        crypto._KEY_DIR.mkdir(parents=True, exist_ok=True)
        crypto._KEY_FILE.write_bytes(preset)
        assert crypto._load_or_create_key() == preset

    def test_env_var_overrides_file(self, monkeypatch):
        from cryptography.fernet import Fernet
        import crypto
        env_key = Fernet.generate_key()
        monkeypatch.setenv(
            "FOLIANTICA_SECRET_KEY",
            base64.urlsafe_b64encode(env_key).decode(),
        )
        # Even if a local file has a different key, env should win.
        crypto._KEY_DIR.mkdir(parents=True, exist_ok=True)
        crypto._KEY_FILE.write_bytes(Fernet.generate_key())
        assert crypto._load_or_create_key() == env_key

    def test_env_var_no_file_needed(self, monkeypatch):
        from cryptography.fernet import Fernet
        import crypto
        env_key = Fernet.generate_key()
        monkeypatch.setenv(
            "FOLIANTICA_SECRET_KEY",
            base64.urlsafe_b64encode(env_key).decode(),
        )
        assert not crypto._KEY_FILE.exists()
        assert crypto._load_or_create_key() == env_key

    # ── Migration from legacy CWD location ──────────────────────────────────

    def test_migrates_legacy_key_to_local_path(self, tmp_path):
        from cryptography.fernet import Fernet
        import crypto
        legacy_key = Fernet.generate_key()
        (tmp_path / ".secret_key").write_bytes(legacy_key)

        result = crypto._load_or_create_key()

        assert result == legacy_key, "Migrated key must equal the legacy key"
        assert crypto._KEY_FILE.exists(), "Key must now exist at local path"
        assert crypto._KEY_FILE.read_bytes().strip() == legacy_key

    def test_migration_removes_legacy_file(self, tmp_path):
        from cryptography.fernet import Fernet
        import crypto
        (tmp_path / ".secret_key").write_bytes(Fernet.generate_key())

        crypto._load_or_create_key()

        assert not (tmp_path / ".secret_key").exists(), \
            "Legacy .secret_key must be removed from dataDir after migration"

    def test_local_key_wins_over_legacy(self, tmp_path):
        from cryptography.fernet import Fernet
        import crypto
        local_key  = Fernet.generate_key()
        legacy_key = Fernet.generate_key()
        crypto._KEY_DIR.mkdir(parents=True, exist_ok=True)
        crypto._KEY_FILE.write_bytes(local_key)
        (tmp_path / ".secret_key").write_bytes(legacy_key)

        assert crypto._load_or_create_key() == local_key

    def test_local_priority_leaves_legacy_untouched(self, tmp_path):
        """When the local key is used, the legacy file is not deleted
        (we only remove it as part of a migration copy)."""
        from cryptography.fernet import Fernet
        import crypto
        crypto._KEY_DIR.mkdir(parents=True, exist_ok=True)
        crypto._KEY_FILE.write_bytes(Fernet.generate_key())
        (tmp_path / ".secret_key").write_bytes(Fernet.generate_key())

        crypto._load_or_create_key()

        assert (tmp_path / ".secret_key").exists()


# ---------------------------------------------------------------------------
# encrypt / decrypt round-trip
# ---------------------------------------------------------------------------

class TestEncryptDecrypt:
    """These tests exercise the module-level _fernet instance."""

    def test_roundtrip(self):
        import crypto
        original = "my-secret-openrouter-api-key"
        assert crypto.decrypt(crypto.encrypt(original)) == original

    def test_ciphertext_differs_from_plaintext(self):
        import crypto
        ct = crypto.encrypt("hello")
        assert ct != "hello"

    def test_empty_string_roundtrip(self):
        import crypto
        assert crypto.decrypt(crypto.encrypt("")) == ""

    def test_unicode_roundtrip(self):
        import crypto
        text = "seküret-schlüssel"   # "sekúret-schlüssel"
        assert crypto.decrypt(crypto.encrypt(text)) == text
