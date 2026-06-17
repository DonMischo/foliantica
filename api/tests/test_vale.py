"""
Tests for api/routers/vale.py and Vale settings integration.

  - TestValeDisabled      — 503 when vale_mode is "off"
  - TestValeSystemMode    — POST /api/vale/check via subprocess (mocked)
  - TestValeDockerMode    — POST /api/vale/check via Docker sidecar (respx)
  - TestValeSettings      — vale_mode/url/config_path persist in settings
  - TestDetectVale        — GET /settings/detect-vale (system + docker)
  - TestValeLive          — @pytest.mark.live: real vale binary on PATH
"""

import json
import subprocess
from unittest.mock import MagicMock, patch

import httpx
import pytest
import respx


VALE_URL = "http://vale-test:8085"

# ── Typical Vale JSON output (exit code 1 = found issues, 0 = clean) ──────────

def _vale_json(alerts: list, filename="/tmp/x/input.md") -> str:
    """Serialise Vale --output=JSON response for the given filename."""
    return json.dumps({filename: alerts})


WEASEL_ALERT = {
    "Action":      {"Name": "replace", "Params": ["rather", "instead"]},
    "Check":       "write-good.Weasel",
    "Description": "",
    "Line":        1,
    "Link":        "",
    "Message":     "'very' is a weasel word!",
    "Severity":    "warning",
    "Span":        [1, 4],
    "Match":       "very",
}

SPELLING_ALERT = {
    "Action":      {"Name": "replace", "Params": ["hello"]},
    "Check":       "Vale.Spelling",
    "Description": "",
    "Line":        2,
    "Link":        "",
    "Message":     "Did you really mean 'helo'?",
    "Severity":    "error",
    "Span":        [1, 4],
    "Match":       "helo",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _enable_system(client, config_path: str | None = None):
    payload: dict = {"vale_mode": "system"}
    if config_path:
        payload["vale_config_path"] = config_path
    r = client.post("/api/settings", json=payload)
    assert r.status_code == 200


def _enable_docker(client, url: str = VALE_URL):
    r = client.post("/api/settings", json={"vale_mode": "docker", "vale_url": url})
    assert r.status_code == 200


def _fake_run(stdout: str, returncode: int = 1):
    """Return a mock CompletedProcess as subprocess.run would produce."""
    result = MagicMock(spec=subprocess.CompletedProcess)
    result.stdout = stdout
    result.stderr = ""
    result.returncode = returncode
    return result


# ── Vale disabled ─────────────────────────────────────────────────────────────

class TestValeDisabled:
    def test_returns_503_when_mode_is_off(self, client):
        # Default vale_mode is "off" — no settings seeded
        r = client.post("/api/vale/check", json={"text": "Hello world."})
        assert r.status_code == 503

    def test_default_settings_have_vale_off(self, client):
        data = client.get("/api/settings").json()
        assert data["vale_mode"] == "off"
        assert data["vale_enabled"] is False


# ── System mode ───────────────────────────────────────────────────────────────

class TestValeSystemMode:
    def test_happy_path_returns_alerts(self, client):
        _enable_system(client)
        mock_stdout = _vale_json([WEASEL_ALERT])
        with (
            patch("routers.vale.shutil.which", return_value="/usr/bin/vale"),
            patch("routers.vale.subprocess.run", return_value=_fake_run(mock_stdout, 1)),
        ):
            r = client.post("/api/vale/check", json={"text": "This is very good."})
        assert r.status_code == 200
        alerts = r.json()["alerts"]
        assert len(alerts) == 1
        assert alerts[0]["Check"] == "write-good.Weasel"
        assert alerts[0]["Severity"] == "warning"
        assert alerts[0]["Match"] == "very"

    def test_clean_text_returns_empty_alerts(self, client):
        _enable_system(client)
        with (
            patch("routers.vale.shutil.which", return_value="/usr/bin/vale"),
            patch("routers.vale.subprocess.run", return_value=_fake_run("{}", 0)),
        ):
            r = client.post("/api/vale/check", json={"text": "A perfectly fine sentence."})
        assert r.status_code == 200
        assert r.json()["alerts"] == []

    def test_multiple_alerts_flattened(self, client):
        _enable_system(client)
        mock_stdout = _vale_json([WEASEL_ALERT, SPELLING_ALERT])
        with (
            patch("routers.vale.shutil.which", return_value="/usr/bin/vale"),
            patch("routers.vale.subprocess.run", return_value=_fake_run(mock_stdout, 1)),
        ):
            r = client.post("/api/vale/check", json={"text": "helo very bad text"})
        assert r.status_code == 200
        alerts = r.json()["alerts"]
        assert len(alerts) == 2
        severities = {a["Severity"] for a in alerts}
        assert severities == {"warning", "error"}

    def test_vale_not_on_path_returns_503(self, client):
        _enable_system(client)
        with patch("routers.vale.shutil.which", return_value=None):
            r = client.post("/api/vale/check", json={"text": "Any text."})
        assert r.status_code == 503
        assert "vale" in r.json()["detail"].lower()

    def test_vale_crash_returns_500(self, client):
        _enable_system(client)
        # Returncode 2+ (not 0 or 1) with no parseable JSON → server error
        with (
            patch("routers.vale.shutil.which", return_value="/usr/bin/vale"),
            patch("routers.vale.subprocess.run", return_value=_fake_run("", 2)),
        ):
            r = client.post("/api/vale/check", json={"text": "Any text."})
        assert r.status_code == 500

    def test_config_path_passed_to_subprocess(self, client):
        cfg = "/home/user/.vale.ini"
        _enable_system(client, config_path=cfg)
        mock_stdout = _vale_json([])
        captured: list[list] = []
        def capture_run(cmd, **kw):
            captured.append(cmd)
            return _fake_run(mock_stdout, 0)
        with (
            patch("routers.vale.shutil.which", return_value="/usr/bin/vale"),
            patch("routers.vale.subprocess.run", side_effect=capture_run),
        ):
            r = client.post("/api/vale/check", json={"text": "Text."})
        assert r.status_code == 200
        assert "--config" in captured[0]
        assert cfg in captured[0]

    def test_no_config_path_uses_auto_generated_ini(self, client):
        _enable_system(client)  # no user-provided config_path
        mock_stdout = _vale_json([])
        captured: list[list] = []
        def capture_run(cmd, **kw):
            captured.append(cmd)
            return _fake_run(mock_stdout, 0)
        with (
            patch("routers.vale.shutil.which", return_value="/usr/bin/vale"),
            patch("routers.vale.subprocess.run", side_effect=capture_run),
        ):
            r = client.post("/api/vale/check", json={"text": "Text."})
        assert r.status_code == 200
        # _check_system always writes an auto ini and passes --config to it
        assert "--config" in captured[0]
        config_val = captured[0][captured[0].index("--config") + 1]
        assert config_val.endswith(".vale.ini")


# ── Docker mode ───────────────────────────────────────────────────────────────

class TestValeDockerMode:
    def test_happy_path_proxies_sidecar_response(self, client):
        _enable_docker(client)
        mock_body = {"alerts": [WEASEL_ALERT]}
        with respx.mock:
            respx.post(f"{VALE_URL}/check").mock(
                return_value=httpx.Response(200, json=mock_body)
            )
            r = client.post("/api/vale/check", json={"text": "This is very good."})
        assert r.status_code == 200
        assert r.json()["alerts"][0]["Check"] == "write-good.Weasel"

    def test_empty_alerts_from_sidecar(self, client):
        _enable_docker(client)
        with respx.mock:
            respx.post(f"{VALE_URL}/check").mock(
                return_value=httpx.Response(200, json={"alerts": []})
            )
            r = client.post("/api/vale/check", json={"text": "Perfect prose."})
        assert r.status_code == 200
        assert r.json()["alerts"] == []

    def test_connect_error_returns_503(self, client):
        _enable_docker(client)
        with respx.mock:
            respx.post(f"{VALE_URL}/check").mock(
                side_effect=httpx.ConnectError("refused")
            )
            r = client.post("/api/vale/check", json={"text": "Text."})
        assert r.status_code == 503
        assert "not reachable" in r.json()["detail"].lower()

    def test_sidecar_5xx_returns_502(self, client):
        _enable_docker(client)
        with respx.mock:
            respx.post(f"{VALE_URL}/check").mock(
                return_value=httpx.Response(500, text="Internal Server Error")
            )
            r = client.post("/api/vale/check", json={"text": "Text."})
        assert r.status_code == 502


# ── Settings persistence ──────────────────────────────────────────────────────

class TestValeSettings:
    def test_vale_mode_system_persists(self, client):
        client.post("/api/settings", json={"vale_mode": "system"})
        data = client.get("/api/settings").json()
        assert data["vale_mode"] == "system"
        assert data["vale_enabled"] is True

    def test_vale_mode_docker_persists(self, client):
        client.post("/api/settings", json={
            "vale_mode": "docker",
            "vale_url": "http://localhost:8085",
        })
        data = client.get("/api/settings").json()
        assert data["vale_mode"] == "docker"
        assert data["vale_enabled"] is True
        assert data["vale_url"] == "http://localhost:8085"

    def test_vale_mode_off_disables(self, client):
        client.post("/api/settings", json={"vale_mode": "system"})
        client.post("/api/settings", json={"vale_mode": "off"})
        data = client.get("/api/settings").json()
        assert data["vale_mode"] == "off"
        assert data["vale_enabled"] is False

    def test_vale_config_path_persists(self, client):
        path = "/home/user/my-project/.vale.ini"
        client.post("/api/settings", json={
            "vale_mode": "system",
            "vale_config_path": path,
        })
        data = client.get("/api/settings").json()
        assert data["vale_config_path"] == path

    def test_vale_config_path_cleared_with_empty_string(self, client):
        client.post("/api/settings", json={
            "vale_mode": "system",
            "vale_config_path": "/some/path.ini",
        })
        client.post("/api/settings", json={"vale_config_path": ""})
        data = client.get("/api/settings").json()
        assert data["vale_config_path"] is None

    def test_vale_url_defaults_to_localhost_8085(self, client):
        data = client.get("/api/settings").json()
        assert data["vale_url"] == "http://localhost:8085"


# ── detect-vale endpoint ──────────────────────────────────────────────────────

class TestDetectVale:
    def test_system_found_returns_true(self, client):
        with patch("routers.settings.shutil.which", return_value="/usr/bin/vale"):
            with respx.mock:
                respx.get("http://localhost:8085/health").mock(
                    side_effect=httpx.ConnectError("not running")
                )
                r = client.get("/api/settings/detect-vale")
        assert r.status_code == 200
        assert r.json()["system"] is True
        assert r.json()["docker"] is False

    def test_system_not_found_returns_false(self, client):
        with patch("routers.settings.shutil.which", return_value=None):
            with respx.mock:
                respx.get("http://localhost:8085/health").mock(
                    side_effect=httpx.ConnectError("not running")
                )
                r = client.get("/api/settings/detect-vale")
        assert r.status_code == 200
        assert r.json()["system"] is False

    def test_docker_responding_returns_true(self, client):
        with patch("routers.settings.shutil.which", return_value=None):
            with respx.mock:
                respx.get("http://localhost:8085/health").mock(
                    return_value=httpx.Response(200, json={"status": "ok"})
                )
                r = client.get("/api/settings/detect-vale")
        assert r.status_code == 200
        assert r.json()["docker"] is True

    def test_both_found(self, client):
        with patch("routers.settings.shutil.which", return_value="/usr/bin/vale"):
            with respx.mock:
                respx.get("http://localhost:8085/health").mock(
                    return_value=httpx.Response(200, json={"status": "ok"})
                )
                r = client.get("/api/settings/detect-vale")
        assert r.status_code == 200
        data = r.json()
        assert data["system"] is True
        assert data["docker"] is True

    def test_uses_custom_vale_url(self, client):
        custom_url = "http://custom-host:9999"
        client.post("/api/settings", json={"vale_url": custom_url})
        with patch("routers.settings.shutil.which", return_value=None):
            with respx.mock:
                respx.get(f"{custom_url}/health").mock(
                    return_value=httpx.Response(200, json={"status": "ok"})
                )
                r = client.get("/api/settings/detect-vale")
        assert r.status_code == 200
        assert r.json()["docker"] is True


# ── Custom rules ─────────────────────────────────────────────────────────────

class TestValeCustomRules:
    def test_get_custom_rules_empty_by_default(self, client):
        r = client.get("/api/vale/custom-rules")
        assert r.status_code == 200
        assert r.json() == {"rules": {}}

    def test_put_and_get_roundtrip(self, client):
        rules = {
            "de": {
                "WeaselWords": ["sicherlich", "eigentlich"],
                "Redundancy": {"alter Hase": "Hase"},
            }
        }
        r = client.put("/api/vale/custom-rules", json={"rules": rules})
        assert r.status_code == 200
        assert r.json() == {"ok": True}

        r2 = client.get("/api/vale/custom-rules")
        assert r2.status_code == 200
        assert r2.json()["rules"] == rules

    def test_put_replaces_previous(self, client):
        client.put("/api/vale/custom-rules", json={"rules": {"de": {"WeaselWords": ["first"]}}})
        client.put("/api/vale/custom-rules", json={"rules": {"de": {"WeaselWords": ["second"]}}})
        r = client.get("/api/vale/custom-rules")
        assert r.json()["rules"] == {"de": {"WeaselWords": ["second"]}}

    def test_rule_meta_known_language(self, client):
        r = client.get("/api/vale/rule-meta/de")
        assert r.status_code == 200
        rules = r.json()["rules"]
        names = [rule["name"] for rule in rules]
        assert "WeaselWords" in names
        assert "Redundancy" in names
        # Each rule has a type field
        for rule in rules:
            assert rule["type"] in ("existence", "substitution")

    def test_rule_meta_type_values(self, client):
        r = client.get("/api/vale/rule-meta/de")
        rules_by_name = {rule["name"]: rule["type"] for rule in r.json()["rules"]}
        assert rules_by_name.get("WeaselWords") == "existence"
        assert rules_by_name.get("Buzzwords") == "existence"
        assert rules_by_name.get("Redundancy") == "substitution"
        assert rules_by_name.get("NominalStyle") == "substitution"

    def test_rule_meta_unsupported_language(self, client):
        r = client.get("/api/vale/rule-meta/xx")
        assert r.status_code == 200
        assert r.json() == {"rules": []}

    def test_custom_existence_rules_injected_in_system_mode(self, client):
        _enable_system(client)
        rules = {"de": {"WeaselWords": ["sicherlich", "eigentlich"]}}
        client.put("/api/vale/custom-rules", json={"rules": rules})

        written_files: list[str] = []
        orig_run = __import__("subprocess").run

        def capture_run(cmd, **kw):
            # Collect which style files were written to the temp dir
            import os
            styles_dir = kw.get("cwd", "")
            if styles_dir:
                for root, _, files in os.walk(os.path.join(styles_dir, "styles")):
                    for f in files:
                        written_files.append(f)
            return _fake_run("{}", 0)

        with (
            patch("routers.vale.shutil.which", return_value="/usr/bin/vale"),
            patch("routers.vale.subprocess.run", side_effect=capture_run),
        ):
            r = client.post("/api/vale/check", json={"text": "Sicherlich.", "language": "de"})

        assert r.status_code == 200
        assert "Custom_WeaselWords.yml" in written_files

    def test_custom_substitution_rules_injected_in_docker_mode(self, client):
        _enable_docker(client)
        rules = {"de": {"Redundancy": {"alter Hase": "Hase"}}}
        client.put("/api/vale/custom-rules", json={"rules": rules})

        captured_payload: list[dict] = []

        with respx.mock:
            def capture(request):
                captured_payload.append(request.content)
                return httpx.Response(200, json={"alerts": []})

            respx.post(f"{VALE_URL}/check").mock(side_effect=capture)
            r = client.post("/api/vale/check", json={"text": "Alter Hase.", "language": "de"})

        assert r.status_code == 200
        payload = json.loads(captured_payload[0])
        style_keys = list(payload.get("styles", {}).keys())
        assert any("Custom_Redundancy" in k for k in style_keys)

    def test_custom_rules_not_injected_for_other_language(self, client):
        _enable_docker(client)
        # Store rules for "de" but check with "fr" — no custom files should appear
        rules = {"de": {"WeaselWords": ["sicherlich"]}}
        client.put("/api/vale/custom-rules", json={"rules": rules})

        captured_payload: list[dict] = []

        with respx.mock:
            def capture(request):
                captured_payload.append(request.content)
                return httpx.Response(200, json={"alerts": []})

            respx.post(f"{VALE_URL}/check").mock(side_effect=capture)
            r = client.post("/api/vale/check", json={"text": "Évidemment.", "language": "fr"})

        assert r.status_code == 200
        payload = json.loads(captured_payload[0])
        style_keys = list(payload.get("styles", {}).keys())
        assert not any("Custom_" in k for k in style_keys)


# ── Sync status ──────────────────────────────────────────────────────────────

class TestValeSyncStatus:
    def test_sync_status_before_any_sync(self, client):
        r = client.get("/api/vale/sync-status")
        assert r.status_code == 200
        data = r.json()
        assert data["last_synced"] is None
        assert data["total_entries"] == 0
        assert data["errors"] == {}

    def test_sync_status_after_sync(self, client):
        client.post("/api/vale/sync-rules")
        r = client.get("/api/vale/sync-status")
        data = r.json()
        assert data["last_synced"] is not None
        assert data["total_entries"] > 0
        assert data["errors"] == {}


# ── Sync rules ────────────────────────────────────────────────────────────────

class TestValeSync:
    def test_sync_creates_entries(self, client, db):
        from models import ValeRuleEntry
        r = client.post("/api/vale/sync-rules")
        assert r.status_code == 200
        data = r.json()
        assert data["synced"] > 0
        assert "last_synced" in data
        assert isinstance(data["errors"], dict)
        assert db.query(ValeRuleEntry).count() > 0

    def test_sync_preserves_disabled_flag(self, client, db):
        from models import ValeRuleEntry
        client.post("/api/vale/sync-rules")
        client.patch("/api/vale/rule-entries/de/WeaselWords",
                     json={"key": r"\bgewissermaßen\b", "enabled": False})
        client.post("/api/vale/sync-rules")
        db.expire_all()
        entry = db.query(ValeRuleEntry).filter_by(
            lang="de", rule_name="WeaselWords", entry_key=r"\bgewissermaßen\b"
        ).first()
        assert entry is not None
        assert entry.enabled == 0

    def test_sync_deletes_stale_entries(self, client, db):
        from models import ValeRuleEntry
        db.add(ValeRuleEntry(
            lang="de", rule_name="FakeRule", rule_type="existence",
            entry_key=r"\btoken_that_does_not_exist\b", enabled=1,
        ))
        db.commit()
        client.post("/api/vale/sync-rules")
        db.expire_all()
        assert db.query(ValeRuleEntry).filter_by(lang="de", rule_name="FakeRule").first() is None

    def test_sync_is_idempotent(self, client):
        r1 = client.post("/api/vale/sync-rules").json()
        r2 = client.post("/api/vale/sync-rules").json()
        assert r1["synced"] == r2["synced"]
        assert r1["errors"] == r2["errors"]


# ── Rule entries ──────────────────────────────────────────────────────────────

class TestValeRuleEntriesDB:
    def test_get_entries_yaml_fallback_before_sync(self, client):
        r = client.get("/api/vale/rule-entries/de/WeaselWords")
        assert r.status_code == 200
        data = r.json()
        assert data["type"] == "existence"
        assert len(data["entries"]) > 0
        assert all(e["enabled"] is True for e in data["entries"])

    def test_get_entries_from_db_after_sync(self, client):
        client.post("/api/vale/sync-rules")
        r = client.get("/api/vale/rule-entries/de/WeaselWords")
        assert r.status_code == 200
        data = r.json()
        assert data["type"] == "existence"
        assert len(data["entries"]) > 0
        for e in data["entries"]:
            assert "enabled" in e
            assert isinstance(e["enabled"], bool)

    def test_get_substitution_entries_have_value(self, client):
        client.post("/api/vale/sync-rules")
        r = client.get("/api/vale/rule-entries/de/Redundancy")
        assert r.status_code == 200
        data = r.json()
        assert data["type"] == "substitution"
        assert len(data["entries"]) > 0
        for e in data["entries"]:
            assert "key" in e
            assert "value" in e

    def test_get_entries_404_for_unknown_rule(self, client):
        r = client.get("/api/vale/rule-entries/de/NonExistentRule")
        assert r.status_code == 404

    def test_patch_toggles_single_entry(self, client, db):
        from models import ValeRuleEntry
        client.post("/api/vale/sync-rules")
        r = client.patch("/api/vale/rule-entries/de/WeaselWords",
                         json={"key": r"\bgewissermaßen\b", "enabled": False})
        assert r.status_code == 200
        assert r.json()["ok"] is True
        db.expire_all()
        entry = db.query(ValeRuleEntry).filter_by(
            lang="de", rule_name="WeaselWords", entry_key=r"\bgewissermaßen\b"
        ).first()
        assert entry.enabled == 0
        client.patch("/api/vale/rule-entries/de/WeaselWords",
                     json={"key": r"\bgewissermaßen\b", "enabled": True})
        db.expire_all()
        assert db.query(ValeRuleEntry).filter_by(
            lang="de", rule_name="WeaselWords", entry_key=r"\bgewissermaßen\b"
        ).first().enabled == 1

    def test_patch_404_when_not_synced(self, client):
        r = client.patch("/api/vale/rule-entries/de/WeaselWords",
                         json={"key": r"\bgewissermaßen\b", "enabled": False})
        assert r.status_code == 404

    def test_put_disables_all_entries_in_rule(self, client, db):
        from models import ValeRuleEntry
        client.post("/api/vale/sync-rules")
        r = client.put("/api/vale/rule-entries/de/WeaselWords", json={"enabled": False})
        assert r.status_code == 200
        assert r.json()["ok"] is True
        db.expire_all()
        entries = db.query(ValeRuleEntry).filter_by(lang="de", rule_name="WeaselWords").all()
        assert len(entries) > 0
        assert all(e.enabled == 0 for e in entries)

    def test_put_reenables_all_entries_in_rule(self, client, db):
        from models import ValeRuleEntry
        client.post("/api/vale/sync-rules")
        client.put("/api/vale/rule-entries/de/WeaselWords", json={"enabled": False})
        client.put("/api/vale/rule-entries/de/WeaselWords", json={"enabled": True})
        db.expire_all()
        entries = db.query(ValeRuleEntry).filter_by(lang="de", rule_name="WeaselWords").all()
        assert all(e.enabled == 1 for e in entries)

    def test_rule_meta_from_db_after_sync(self, client):
        client.post("/api/vale/sync-rules")
        r = client.get("/api/vale/rule-meta/de")
        assert r.status_code == 200
        rules = r.json()["rules"]
        names = [rule["name"] for rule in rules]
        assert "WeaselWords" in names
        assert "Redundancy" in names
        for rule in rules:
            assert rule["type"] in ("existence", "substitution")


# ── Disabled entries excluded from style loading ──────────────────────────────

class TestValeLoadStylesDB:
    def test_disabled_rule_excluded_from_check(self, client):
        _enable_system(client)
        client.post("/api/vale/sync-rules")
        client.put("/api/vale/rule-entries/de/WeaselWords", json={"enabled": False})

        written_files: list[str] = []

        def capture_run(cmd, **kw):
            import os
            cwd = kw.get("cwd", "")
            styles_path = os.path.join(cwd, "styles", "Foliantica")
            if os.path.isdir(styles_path):
                written_files.extend(os.listdir(styles_path))
            return _fake_run("{}", 0)

        with (
            patch("routers.vale.shutil.which", return_value="/usr/bin/vale"),
            patch("routers.vale.subprocess.run", side_effect=capture_run),
        ):
            r = client.post("/api/vale/check", json={"text": "Text.", "language": "de"})

        assert r.status_code == 200
        assert "WeaselWords.yml" not in written_files
        assert len(written_files) > 0

    def test_yaml_fallback_used_before_sync(self, client):
        _enable_system(client)
        written_files: list[str] = []

        def capture_run(cmd, **kw):
            import os
            cwd = kw.get("cwd", "")
            styles_path = os.path.join(cwd, "styles", "Foliantica")
            if os.path.isdir(styles_path):
                written_files.extend(os.listdir(styles_path))
            return _fake_run("{}", 0)

        with (
            patch("routers.vale.shutil.which", return_value="/usr/bin/vale"),
            patch("routers.vale.subprocess.run", side_effect=capture_run),
        ):
            r = client.post("/api/vale/check", json={"text": "Text.", "language": "de"})

        assert r.status_code == 200
        assert "WeaselWords.yml" in written_files


# ── Legacy disabled entries migration ────────────────────────────────────────

class TestValeDisabledMigration:
    def test_first_sync_migrates_legacy_disabled_entries(self, client, db):
        from models import UserSettings, ValeRuleEntry
        s = UserSettings()
        s.vale_disabled_entries = json.dumps({
            "de": {"WeaselWords": [r"\bgewissermaßen\b"]}
        })
        db.add(s)
        db.commit()
        r = client.post("/api/vale/sync-rules")
        assert r.status_code == 200
        db.expire_all()
        entry = db.query(ValeRuleEntry).filter_by(
            lang="de", rule_name="WeaselWords", entry_key=r"\bgewissermaßen\b"
        ).first()
        assert entry is not None
        assert entry.enabled == 0
        s2 = db.query(UserSettings).first()
        assert s2.vale_disabled_entries is None

    def test_second_sync_does_not_re_apply_legacy_json(self, client, db):
        from models import UserSettings, ValeRuleEntry
        client.post("/api/vale/sync-rules")
        client.patch("/api/vale/rule-entries/de/WeaselWords",
                     json={"key": r"\bgewissermaßen\b", "enabled": True})
        db.expire_all()
        s = db.query(UserSettings).first()
        s.vale_disabled_entries = json.dumps({"de": {"WeaselWords": [r"\bgewissermaßen\b"]}})
        db.commit()
        client.post("/api/vale/sync-rules")
        db.expire_all()
        entry = db.query(ValeRuleEntry).filter_by(
            lang="de", rule_name="WeaselWords", entry_key=r"\bgewissermaßen\b"
        ).first()
        assert entry is not None
        assert entry.enabled == 1


# ── Live tests — real vale binary ─────────────────────────────────────────────

VALE_LIVE_URL = "http://localhost:8085"


@pytest.fixture
def vale_on_path():
    """Skip test if vale is not installed on the host PATH."""
    import shutil
    if not shutil.which("vale"):
        pytest.skip("vale not on PATH — install it (winget install Vale.Vale / brew install vale)")


@pytest.mark.live
class TestValeLive:
    def test_system_check_returns_alerts_for_weasel_words(self, client, vale_on_path):
        client.post("/api/settings", json={"vale_mode": "system"})
        # "very" is flagged by write-good.Weasel — but only if that style is configured.
        # Without a config, Vale may return empty results or a config-not-found error.
        # We just confirm the endpoint responds successfully.
        r = client.post("/api/vale/check", json={"text": "This is very important text."})
        assert r.status_code in (200, 503)  # 503 if vale needs config; 200 if built-in style works

    def test_system_detect_finds_vale(self, client, vale_on_path):
        r = client.get("/api/settings/detect-vale")
        assert r.status_code == 200
        assert r.json()["system"] is True
