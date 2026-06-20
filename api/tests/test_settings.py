"""
Tests for api/routers/settings.py — settings CRUD, AI prompts, providers,
data-dir helpers, and pg-config endpoints.

Excludes:
  - docker/up (needs real Docker)
  - service-status / detect-* / providers/*/ping / */models (live HTTP)
  - restart (kills the process)
  - pg-transfer (complex DB-to-DB copy)
"""
import json
import pytest
from pathlib import Path
from unittest.mock import patch

import routers.settings as settings_mod


# ── Fixture: redirect the shared lw-config file to a tmp dir ─────────────────

@pytest.fixture(autouse=True)
def _redirect_lw_config(tmp_path, monkeypatch):
    """Keep ~/.foliantica/config.json untouched during tests."""
    fake_cfg = tmp_path / "config.json"
    monkeypatch.setattr(settings_mod, "LW_CONFIG_FILE", fake_cfg)


# ── GET /api/settings ─────────────────────────────────────────────────────────

class TestGetSettings:
    def test_returns_200_and_defaults(self, client):
        r = client.get("/api/settings")
        assert r.status_code == 200
        d = r.json()
        assert d["theme"] == "dark"
        assert d["language"] == "en"
        assert d["has_api_key"] is False
        assert d["grammar_languages"] == ["en"]

    def test_returns_all_expected_fields(self, client):
        r = client.get("/api/settings")
        d = r.json()
        for field in (
            "id", "has_api_key", "default_model", "theme", "language",
            "enabled_models", "grammar_check_enabled", "pandoc_enabled",
            "spacy_enabled", "calibre_enabled", "vale_enabled",
        ):
            assert field in d, f"Missing field: {field}"

    def test_idempotent_get_creates_once(self, client):
        r1 = client.get("/api/settings")
        r2 = client.get("/api/settings")
        assert r1.json()["id"] == r2.json()["id"]


# ── POST /api/settings ────────────────────────────────────────────────────────

class TestUpdateSettings:
    def test_update_theme(self, client):
        r = client.post("/api/settings", json={"theme": "light"})
        assert r.status_code == 200
        assert r.json()["theme"] == "light"

    def test_update_language(self, client):
        r = client.post("/api/settings", json={"language": "de"})
        assert r.json()["language"] == "de"

    def test_update_default_model(self, client):
        r = client.post("/api/settings", json={"default_model": "gpt-4o"})
        assert r.json()["default_model"] == "gpt-4o"

    def test_update_enabled_models_list(self, client):
        r = client.post("/api/settings", json={"enabled_models": ["gpt-4o", "claude-3-opus"]})
        assert r.json()["enabled_models"] == ["gpt-4o", "claude-3-opus"]

    def test_set_api_key_marks_has_api_key(self, client):
        r = client.post("/api/settings", json={"openrouter_api_key": "sk-test-key"})
        assert r.json()["has_api_key"] is True

    def test_typewriter_mode_toggle(self, client):
        r = client.post("/api/settings", json={"typewriter_mode": True, "typewriter_offset": 40})
        d = r.json()
        assert d["typewriter_mode"] is True
        assert d["typewriter_offset"] == 40

    def test_grammar_settings(self, client):
        r = client.post("/api/settings", json={
            "grammar_check_enabled": True,
            "grammar_check_url": "http://localhost:9999",
            "grammar_languages": ["de", "fr"],
        })
        d = r.json()
        assert d["grammar_check_enabled"] is True
        assert d["grammar_check_url"] == "http://localhost:9999"
        assert d["grammar_languages"] == ["de", "fr"]

    def test_vale_mode(self, client):
        r = client.post("/api/settings", json={"vale_mode": "system"})
        d = r.json()
        assert d["vale_mode"] == "system"
        assert d["vale_enabled"] is True

    def test_calibre_mode(self, client):
        r = client.post("/api/settings", json={"calibre_mode": "docker"})
        d = r.json()
        assert d["calibre_mode"] == "docker"
        assert d["calibre_enabled"] is True

    def test_ai_disabled_flag(self, client):
        r = client.post("/api/settings", json={"ai_disabled": True})
        assert r.json()["ai_disabled"] is True

    def test_sync_settings(self, client):
        with patch("routers.sync.init", return_value=None):
            r = client.post("/api/settings", json={
                "sync_mirror_enabled": True,
                "sync_local_dir": "/tmp/sync",
            })
        d = r.json()
        assert d["sync_mirror_enabled"] is True
        assert d["sync_local_dir"] == "/tmp/sync"

    def test_update_preserves_unset_fields(self, client):
        client.post("/api/settings", json={"theme": "light"})
        client.post("/api/settings", json={"language": "fr"})
        r = client.get("/api/settings")
        assert r.json()["theme"] == "light"
        assert r.json()["language"] == "fr"


# ── AI Prompts ────────────────────────────────────────────────────────────────

class TestListPrompts:
    def test_returns_list(self, client):
        r = client.get("/api/settings/prompts")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_created_prompt_appears(self, client):
        client.post("/api/settings/prompts", json={"name": "My Prompt", "system": "You are helpful."})
        r = client.get("/api/settings/prompts")
        assert any(p["name"] == "My Prompt" for p in r.json())


class TestCreatePrompt:
    def test_create_returns_prompt(self, client):
        r = client.post("/api/settings/prompts", json={
            "name": "Summarize",
            "description": "Summarize text",
            "system": "Be brief.",
            "user_template": "Summarize: {text}",
            "word_count": 200,
        })
        assert r.status_code == 200
        d = r.json()
        assert d["name"] == "Summarize"
        assert d["word_count"] == 200
        assert d["is_built_in"] is False

    def test_default_word_count(self, client):
        r = client.post("/api/settings/prompts", json={"name": "Quick"})
        assert r.json()["word_count"] == 400


class TestUpdatePrompt:
    @pytest.fixture
    def prompt(self, client):
        return client.post("/api/settings/prompts", json={"name": "Original", "system": "Be helpful."}).json()

    def test_update_name(self, client, prompt):
        r = client.put(f"/api/settings/prompts/{prompt['id']}", json={"name": "Updated"})
        assert r.status_code == 200
        assert r.json()["name"] == "Updated"

    def test_update_system_text(self, client, prompt):
        r = client.put(f"/api/settings/prompts/{prompt['id']}", json={"system": "Be concise."})
        assert r.json()["system"] == "Be concise."

    def test_update_missing_prompt_returns_404(self, client):
        r = client.put("/api/settings/prompts/99999", json={"name": "x"})
        assert r.status_code == 404


class TestDeletePrompt:
    @pytest.fixture
    def prompt(self, client):
        return client.post("/api/settings/prompts", json={"name": "To Delete"}).json()

    def test_delete_custom_prompt_returns_204(self, client, prompt):
        r = client.delete(f"/api/settings/prompts/{prompt['id']}")
        assert r.status_code == 204

    def test_deleted_prompt_gone(self, client, prompt):
        client.delete(f"/api/settings/prompts/{prompt['id']}")
        ids = [p["id"] for p in client.get("/api/settings/prompts").json()]
        assert prompt["id"] not in ids

    def test_delete_missing_prompt_returns_404(self, client):
        r = client.delete("/api/settings/prompts/99999")
        assert r.status_code == 404

    def test_delete_builtin_prompt_returns_400(self, client, db):
        from models import AIPrompt
        builtin = AIPrompt(name="Built-in", is_built_in=1, built_in_key="synopsis")
        db.add(builtin)
        db.commit()
        db.refresh(builtin)
        r = client.delete(f"/api/settings/prompts/{builtin.id}")
        assert r.status_code == 400


class TestRevertPrompt:
    def test_revert_builtin_restores_defaults(self, client, db):
        from models import AIPrompt
        from database import DEFAULT_AI_PROMPTS
        default = DEFAULT_AI_PROMPTS[0]
        p = AIPrompt(
            name="Modified",
            description="wrong",
            system="wrong",
            user_template="wrong",
            is_built_in=1,
            built_in_key=default["built_in_key"],
        )
        db.add(p)
        db.commit()
        db.refresh(p)
        r = client.post(f"/api/settings/prompts/{p.id}/revert")
        assert r.status_code == 200
        assert r.json()["name"] == default["name"]

    def test_revert_non_builtin_returns_404(self, client):
        r = client.post("/api/settings/prompts/99999/revert")
        assert r.status_code == 404


# ── Providers ─────────────────────────────────────────────────────────────────

class TestListProviders:
    def test_returns_list_of_providers(self, client):
        r = client.get("/api/settings/providers")
        assert r.status_code == 200
        providers = r.json()
        assert isinstance(providers, list)
        assert len(providers) > 0

    def test_provider_has_expected_fields(self, client):
        providers = client.get("/api/settings/providers").json()
        p = providers[0]
        for field in ("id", "name", "is_local", "requires_key", "configured", "is_active"):
            assert field in p

    def test_openrouter_active_by_default(self, client):
        providers = client.get("/api/settings/providers").json()
        active = next(p for p in providers if p["is_active"])
        assert active["id"] == "openrouter"


class TestSetActiveProvider:
    def test_set_valid_provider(self, client):
        providers = client.get("/api/settings/providers").json()
        pid = providers[0]["id"]
        r = client.post("/api/settings/providers/active", json={"provider_id": pid})
        assert r.status_code == 200
        assert r.json()["active_provider"] == pid

    def test_set_invalid_provider_returns_400(self, client):
        r = client.post("/api/settings/providers/active", json={"provider_id": "nonexistent"})
        assert r.status_code == 400


class TestSetModelProviderMap:
    def test_set_valid_mapping(self, client):
        providers = client.get("/api/settings/providers").json()
        pid = providers[0]["id"]
        r = client.post("/api/settings/providers/model-map", json={
            "model_id": "gpt-4o",
            "provider_id": pid,
        })
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_missing_model_id_returns_400(self, client):
        providers = client.get("/api/settings/providers").json()
        pid = providers[0]["id"]
        r = client.post("/api/settings/providers/model-map", json={"model_id": "", "provider_id": pid})
        assert r.status_code == 400

    def test_invalid_provider_returns_400(self, client):
        r = client.post("/api/settings/providers/model-map", json={
            "model_id": "gpt-4o", "provider_id": "fake"
        })
        assert r.status_code == 400


class TestSaveProviderConfig:
    def test_save_api_key_for_unknown_provider_returns_404(self, client):
        r = client.post("/api/settings/providers/nonexistent", json={"api_key": "sk-test"})
        assert r.status_code == 404

    def test_save_api_key_for_known_provider(self, client):
        r = client.post("/api/settings/providers/openrouter", json={"api_key": "sk-test"})
        assert r.status_code == 200
        assert r.json()["ok"] is True
        assert client.get("/api/settings").json()["has_api_key"] is True

    def test_clear_api_key_with_empty_string(self, client):
        client.post("/api/settings/providers/openrouter", json={"api_key": "sk-test"})
        r = client.post("/api/settings/providers/openrouter", json={"api_key": ""})
        assert r.status_code == 200
        assert client.get("/api/settings").json()["has_api_key"] is False

    def test_invalid_base_url_rejected(self, client):
        r = client.post("/api/settings/providers/openrouter", json={"base_url": "not-a-url"})
        assert r.status_code == 400

    def test_http_for_non_local_key_provider_rejected(self, client):
        r = client.post("/api/settings/providers/openrouter", json={"base_url": "http://example.com/api"})
        assert r.status_code == 400

    def test_valid_local_http_url_accepted(self, client):
        providers = client.get("/api/settings/providers").json()
        local = next((p for p in providers if p["is_local"]), None)
        if local is None:
            pytest.skip("No local provider in this build")
        r = client.post(
            f"/api/settings/providers/{local['id']}",
            json={"base_url": "http://localhost:11434"},
        )
        assert r.status_code == 200


# ── Data-dir endpoints ────────────────────────────────────────────────────────

class TestDataDir:
    def test_get_data_dir_returns_current(self, client):
        r = client.get("/api/settings/data-dir")
        assert r.status_code == 200
        d = r.json()
        assert "current" in d
        assert "configured" in d
        assert d["configured"] is None

    def test_set_data_dir_persists_path(self, client, tmp_path):
        target = str(tmp_path / "my-data")
        r = client.post("/api/settings/data-dir", json={"path": target})
        assert r.status_code == 200
        assert r.json()["configured"] == target
        r2 = client.get("/api/settings/data-dir")
        assert r2.json()["configured"] == target

    def test_clear_data_dir(self, client, tmp_path):
        target = str(tmp_path / "data")
        client.post("/api/settings/data-dir", json={"path": target})
        r = client.post("/api/settings/data-dir", json={"path": None})
        assert r.json()["configured"] is None

    def test_check_data_dir_no_db(self, client, tmp_path):
        r = client.get(f"/api/settings/data-dir/check?path={tmp_path}")
        assert r.status_code == 200
        assert r.json()["has_db"] is False

    def test_check_data_dir_with_sql(self, client, tmp_path):
        (tmp_path / "foliantica.sql").write_text("-- sql")
        r = client.get(f"/api/settings/data-dir/check?path={tmp_path}")
        assert r.json()["has_db"] is True


# ── PG config endpoints ───────────────────────────────────────────────────────

class TestPgConfig:
    def test_pg_active_returns_env_values(self, client):
        r = client.get("/api/settings/pg-active")
        assert r.status_code == 200
        d = r.json()
        assert "host" in d and "port" in d and "db" in d

    def test_pg_config_defaults_when_unset(self, client):
        r = client.get("/api/settings/pg-config")
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_set_and_get_pg_config(self, client):
        cfg = {"host": "10.0.0.1", "port": 5432, "user": "admin", "db": "mydb", "useDocker": False}
        r = client.post("/api/settings/pg-config", json=cfg)
        assert r.status_code == 200
        r2 = client.get("/api/settings/pg-config")
        assert r2.json()["host"] == "10.0.0.1"

    def test_pg_config_ignores_unknown_keys(self, client):
        r = client.post("/api/settings/pg-config", json={"host": "127.0.0.1", "evil": "payload"})
        assert r.status_code == 200
        assert "evil" not in r.json()


# ── Folder-picker polling ─────────────────────────────────────────────────────

class TestPickDataDir:
    def test_poll_unknown_session_returns_404(self, client):
        r = client.get("/api/settings/data-dir/pick/nonexistent-session-id")
        assert r.status_code == 404

    def test_start_pick_returns_session_id(self, client):
        with patch.object(settings_mod, "_open_folder_dialog", return_value="/chosen/path"):
            r = client.post("/api/settings/data-dir/pick")
        assert r.status_code == 200
        assert "session_id" in r.json()
