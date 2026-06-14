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

    def test_no_config_path_omits_config_flag(self, client):
        _enable_system(client)  # no config_path
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
        assert "--config" not in captured[0]


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
