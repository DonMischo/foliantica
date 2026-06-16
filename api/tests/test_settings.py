"""
Tests for settings, AI provider configuration, and cross-provider model routing.
"""
import httpx
import pytest
from unittest.mock import patch, AsyncMock

from crypto import encrypt, decrypt
from models import UserSettings


# ── Crypto ────────────────────────────────────────────────────────────────────

class TestCrypto:
    def test_encrypt_decrypt_roundtrip(self):
        assert decrypt(encrypt("secret-key")) == "secret-key"

    def test_decrypt_wrong_key_returns_none(self):
        # Simulate ciphertext from a different machine by corrupting the token
        bad_ciphertext = "gAAAAA" + "x" * 80
        assert decrypt(bad_ciphertext) is None

    def test_decrypt_empty_string_returns_none(self):
        assert decrypt("") is None

    def test_decrypt_garbage_returns_none(self):
        assert decrypt("not-a-fernet-token") is None


# ── Settings CRUD ─────────────────────────────────────────────────────────────

class TestSettings:
    def test_get_settings_returns_defaults(self, client):
        r = client.get("/api/settings")
        assert r.status_code == 200
        data = r.json()
        assert "theme" in data
        # The app default theme is "dark" (UserSettings.theme has default="dark")
        assert data["theme"] == "dark"
        assert "enabled_models" in data

    def test_update_settings_theme(self, client):
        r = client.post("/api/settings", json={"theme": "light"})
        assert r.status_code == 200
        assert client.get("/api/settings").json()["theme"] == "light"

    def test_update_settings_default_model(self, client):
        client.post("/api/settings", json={"default_model": "gpt-4o"})
        assert client.get("/api/settings").json()["default_model"] == "gpt-4o"

    def test_update_enabled_models(self, client):
        client.post("/api/settings", json={"enabled_models": ["model-a", "model-b"]})
        assert set(client.get("/api/settings").json()["enabled_models"]) == {
            "model-a", "model-b"
        }


# ── Provider list ─────────────────────────────────────────────────────────────

class TestProviderList:
    def test_get_providers_returns_list(self, client):
        r = client.get("/api/settings/providers")
        assert r.status_code == 200
        providers = r.json()
        assert isinstance(providers, list)
        assert len(providers) > 0

    def test_providers_have_required_fields(self, client):
        for p in client.get("/api/settings/providers").json():
            assert "id" in p
            assert "name" in p
            assert "is_active" in p
            assert "configured" in p

    def test_openrouter_is_default_active(self, client):
        providers = client.get("/api/settings/providers").json()
        active = next((p for p in providers if p["is_active"]), None)
        assert active is not None
        assert active["id"] == "openrouter"

    def test_ollama_is_local(self, client):
        providers = client.get("/api/settings/providers").json()
        ollama = next((p for p in providers if p["id"] == "ollama"), None)
        assert ollama is not None
        assert ollama["is_local"] is True
        assert ollama["requires_key"] is False


# ── Set active provider ───────────────────────────────────────────────────────

class TestSetActiveProvider:
    def test_set_active_to_ollama(self, client):
        r = client.post("/api/settings/providers/active",
                        json={"provider_id": "ollama"})
        assert r.status_code == 200

        providers = client.get("/api/settings/providers").json()
        active = next(p for p in providers if p["is_active"])
        assert active["id"] == "ollama"

    def test_set_active_unknown_provider(self, client):
        r = client.post("/api/settings/providers/active",
                        json={"provider_id": "does_not_exist"})
        assert r.status_code == 400

    def test_set_active_persists(self, client):
        client.post("/api/settings/providers/active",
                    json={"provider_id": "ollama"})
        providers = client.get("/api/settings/providers").json()
        assert next(p for p in providers if p["id"] == "ollama")["is_active"] is True
        assert next(p for p in providers if p["id"] == "openrouter")["is_active"] is False


# ── Save provider config ──────────────────────────────────────────────────────

class TestSaveProviderConfig:
    def test_save_api_key_shows_has_key(self, client):
        r = client.post("/api/settings/providers/openrouter",
                        json={"api_key": "sk-test-123"})
        assert r.status_code == 200

        providers = client.get("/api/settings/providers").json()
        openrouter = next(p for p in providers if p["id"] == "openrouter")
        assert openrouter["configured"] is True

    def test_save_custom_base_url(self, client):
        client.post("/api/settings/providers/ollama",
                    json={"base_url": "http://192.168.1.10:11434/v1"})

        providers = client.get("/api/settings/providers").json()
        ollama = next(p for p in providers if p["id"] == "ollama")
        assert ollama["base_url"] == "http://192.168.1.10:11434/v1"

    def test_clear_api_key(self, client):
        client.post("/api/settings/providers/openrouter",
                    json={"api_key": "sk-test-123"})
        client.post("/api/settings/providers/openrouter",
                    json={"api_key": ""})

        # After clearing, settings should report no key
        data = client.get("/api/settings").json()
        assert data["has_api_key"] is False

    def test_save_unknown_provider_returns_404(self, client):
        r = client.post("/api/settings/providers/nonexistent",
                        json={"api_key": "x"})
        assert r.status_code == 404


# ── Model-provider map ────────────────────────────────────────────────────────

class TestModelProviderMap:
    def test_set_model_provider(self, client):
        r = client.post("/api/settings/providers/model-map",
                        json={"model_id": "qwen3:2b", "provider_id": "ollama"})
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_set_model_provider_unknown_provider(self, client):
        r = client.post("/api/settings/providers/model-map",
                        json={"model_id": "qwen3:2b", "provider_id": "fake"})
        assert r.status_code == 400

    def test_set_model_provider_empty_model(self, client):
        r = client.post("/api/settings/providers/model-map",
                        json={"model_id": "", "provider_id": "ollama"})
        assert r.status_code == 400

    def test_model_map_persists_multiple_entries(self, client, db):
        import json
        from sqlalchemy import text

        client.post("/api/settings/providers/model-map",
                    json={"model_id": "qwen3:2b", "provider_id": "ollama"})
        client.post("/api/settings/providers/model-map",
                    json={"model_id": "llama3:8b", "provider_id": "ollama"})

        # Both entries must be present in the persisted _model_provider_map JSON blob
        row = db.execute(
            text("SELECT ai_providers_cfg FROM user_settings LIMIT 1")
        ).fetchone()
        assert row is not None
        cfg = json.loads(row[0])
        model_map = cfg.get("_model_provider_map", {})
        assert model_map.get("qwen3:2b") == "ollama"
        assert model_map.get("llama3:8b") == "ollama"


# ── Ping endpoint ─────────────────────────────────────────────────────────────

class TestPingProvider:
    def test_ping_unknown_provider_returns_404(self, client):
        r = client.get("/api/settings/providers/does_not_exist/ping")
        assert r.status_code == 404

    def test_ping_unreachable_returns_false(self, client):
        # Mock httpx to simulate a connection failure — asserting against a
        # real network call would pass/fail depending on whether Ollama
        # happens to be running on the machine executing the test.
        async def mock_get(*args, **kwargs):
            raise httpx.ConnectError("connection refused")

        with patch("routers.settings.httpx.AsyncClient") as mock_cls:
            mock_instance = AsyncMock()
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            mock_instance.get = mock_get
            mock_cls.return_value = mock_instance

            r = client.get("/api/settings/providers/ollama/ping")
        assert r.status_code == 200
        assert r.json()["reachable"] is False

    def test_ping_reachable_returns_true(self, client):
        # Mock httpx so we don't need a real provider running
        async def mock_get(*args, **kwargs):
            class FakeResp:
                status_code = 200
            return FakeResp()

        with patch("routers.settings.httpx.AsyncClient") as mock_cls:
            mock_instance = AsyncMock()
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            mock_instance.get = mock_get
            mock_cls.return_value = mock_instance

            r = client.get("/api/settings/providers/ollama/ping")
        assert r.status_code == 200
        assert r.json()["reachable"] is True


# ── Provider base_url validation (security) ───────────────────────────────────
# An unvalidated base_url lets an attacker redirect AI calls (which carry the
# decrypted API key) to their own host. Validate scheme/host on save.

class TestBaseUrlValidation:
    def test_rejects_non_http_scheme(self, client):
        r = client.post("/api/settings/providers/openrouter",
                        json={"base_url": "file:///etc/passwd"})
        assert r.status_code == 400

    def test_rejects_plain_http_for_key_bearing_provider(self, client):
        # openrouter sends an API key — plaintext http to a remote host would
        # exfiltrate it, so it must be rejected.
        r = client.post("/api/settings/providers/openrouter",
                        json={"base_url": "http://attacker.example.com"})
        assert r.status_code == 400

    def test_accepts_https_for_key_bearing_provider(self, client):
        r = client.post("/api/settings/providers/openrouter",
                        json={"base_url": "https://my-proxy.example.com/v1"})
        assert r.status_code == 200

    def test_accepts_localhost_http_for_local_provider(self, client):
        # ollama is local and sends no key — http://localhost is legitimate.
        r = client.post("/api/settings/providers/ollama",
                        json={"base_url": "http://localhost:11434/v1"})
        assert r.status_code == 200


# ── pg-transfer destination guard (security) ──────────────────────────────────

class TestPgTransferGuard:
    def test_remote_target_rejected_without_optin(self, client):
        # Copying the whole datastore (incl. encrypted key columns) to an
        # arbitrary host is an exfiltration primitive — reject non-loopback
        # targets unless explicitly opted in via env var.
        r = client.post("/api/settings/pg-transfer",
                        json={"target": {"host": "attacker.example.com", "port": 5432}})
        assert r.status_code == 403
        assert "loopback" in r.json()["detail"].lower()
