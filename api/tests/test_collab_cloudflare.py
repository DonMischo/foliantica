"""
Phase 6 — Cloudflare Tunnel.

cloudflared is never actually invoked.  Endpoint tests patch
collab_mod.cloudflare_open / collab_mod.cloudflare_close directly.
Unit tests for the open function patch subprocess.Popen so the
reader thread works against a pre-populated iterator — it completes
in microseconds with no real process involved.
"""

import subprocess
from unittest.mock import MagicMock, patch

import routers.collab as collab_mod


# ── Status endpoint ───────────────────────────────────────────────────────────

class TestCloudflareStatus:

    def test_initial_state(self, client):
        r = client.get("/api/collab/cloudflare/status")
        assert r.status_code == 200
        data = r.json()
        assert data["active"] is False
        assert data["url"] is None

    def test_status_reflects_active_state(self, client):
        collab_mod._cf_active = True
        collab_mod._cf_url = "https://hello-world.trycloudflare.com"
        r = client.get("/api/collab/cloudflare/status")
        data = r.json()
        assert data["active"] is True
        assert data["url"] == "https://hello-world.trycloudflare.com"


# ── Open endpoint ─────────────────────────────────────────────────────────────

class TestCloudflareOpenEndpoint:

    def test_open_success(self, client):
        with patch.object(collab_mod, "cloudflare_open",
                          return_value={"success": True, "url": "https://abc.trycloudflare.com"}):
            r = client.post("/api/collab/cloudflare/open")
        assert r.status_code == 200
        assert r.json()["url"] == "https://abc.trycloudflare.com"

    def test_open_cloudflared_missing_returns_503(self, client):
        with patch.object(collab_mod, "cloudflare_open",
                          return_value={"success": False, "error": "cloudflared is not installed."}):
            r = client.post("/api/collab/cloudflare/open")
        assert r.status_code == 503
        assert "cloudflared" in r.json()["detail"]

    def test_open_timeout_returns_503(self, client):
        with patch.object(collab_mod, "cloudflare_open",
                          return_value={"success": False, "error": "Timed out waiting for tunnel URL (30 s)."}):
            r = client.post("/api/collab/cloudflare/open")
        assert r.status_code == 503
        assert "timed out" in r.json()["detail"].lower()

    def test_open_no_url_returns_503(self, client):
        with patch.object(collab_mod, "cloudflare_open",
                          return_value={"success": False,
                                        "error": "cloudflared exited without providing a tunnel URL."}):
            r = client.post("/api/collab/cloudflare/open")
        assert r.status_code == 503


# ── Close endpoint ────────────────────────────────────────────────────────────

class TestCloudflareCloseEndpoint:

    def test_close_calls_cloudflare_close(self, client):
        collab_mod._cf_active = True
        with patch.object(collab_mod, "cloudflare_close") as mock_close:
            r = client.post("/api/collab/cloudflare/close")
            mock_close.assert_called_once()
        assert r.status_code == 200
        assert r.json()["active"] is False

    def test_close_when_inactive_does_not_error(self, client):
        with patch.object(collab_mod, "cloudflare_close"):
            r = client.post("/api/collab/cloudflare/close")
        assert r.status_code == 200


# ── cloudflare_close() unit tests ─────────────────────────────────────────────

class TestCloudflareCloseUnit:

    def test_resets_all_state(self):
        mock_proc = MagicMock()
        collab_mod._cf_process = mock_proc
        collab_mod._cf_active  = True
        collab_mod._cf_url     = "https://x.trycloudflare.com"

        collab_mod.cloudflare_close()

        assert collab_mod._cf_active is False
        assert collab_mod._cf_url is None
        assert collab_mod._cf_process is None

    def test_terminates_process(self):
        mock_proc = MagicMock()
        collab_mod._cf_process = mock_proc
        collab_mod._cf_active  = True

        collab_mod.cloudflare_close()

        mock_proc.terminate.assert_called_once()
        mock_proc.wait.assert_called_once()

    def test_idempotent(self):
        """Calling cloudflare_close() twice must not raise."""
        collab_mod.cloudflare_close()
        collab_mod.cloudflare_close()

    def test_kills_on_wait_timeout(self):
        """If process.wait() times out, kill() is called as fallback."""
        mock_proc = MagicMock()
        mock_proc.wait.side_effect = subprocess.TimeoutExpired(cmd="cloudflared", timeout=5)
        collab_mod._cf_process = mock_proc
        collab_mod._cf_active  = True

        collab_mod.cloudflare_close()  # must not raise

        mock_proc.kill.assert_called_once()

    def test_no_process_is_noop(self):
        """If no process is running, close() returns silently."""
        collab_mod._cf_process = None
        collab_mod.cloudflare_close()  # must not raise


# ── cloudflare_open() unit tests ──────────────────────────────────────────────

class TestCloudflareOpenUnit:

    def _mock_popen(self, lines: list[str]) -> MagicMock:
        """Return a Popen mock whose stdout yields the given lines."""
        mock_proc = MagicMock()
        mock_proc.stdout = iter(lines)
        return mock_proc

    def test_not_installed_returns_error(self):
        with patch("subprocess.Popen", side_effect=FileNotFoundError):
            result = collab_mod.cloudflare_open()
        assert result["success"] is False
        assert "cloudflared" in result["error"]

    def test_url_extracted_from_log_line(self):
        lines = [
            "2024-01-01T00:00:00Z INF Requesting new quick Tunnel...\n",
            "2024-01-01T00:00:00Z INF +--------------------+\n",
            "2024-01-01T00:00:00Z INF |  https://hello-world.trycloudflare.com  |\n",
            "2024-01-01T00:00:00Z INF +--------------------+\n",
        ]
        mock_proc = self._mock_popen(lines)
        with patch("subprocess.Popen", return_value=mock_proc):
            result = collab_mod.cloudflare_open()
        assert result["success"] is True
        assert result["url"] == "https://hello-world.trycloudflare.com"
        assert collab_mod._cf_active is True
        assert collab_mod._cf_url == "https://hello-world.trycloudflare.com"
        assert collab_mod._cf_process is mock_proc

    def test_url_on_first_line(self):
        lines = ["INF  https://quick-test.trycloudflare.com\n"]
        mock_proc = self._mock_popen(lines)
        with patch("subprocess.Popen", return_value=mock_proc):
            result = collab_mod.cloudflare_open()
        assert result["success"] is True
        assert result["url"] == "https://quick-test.trycloudflare.com"

    def test_process_exits_without_url(self):
        mock_proc = self._mock_popen([])  # no output — process ends immediately
        with patch("subprocess.Popen", return_value=mock_proc):
            result = collab_mod.cloudflare_open()
        assert result["success"] is False
        assert "exited" in result["error"].lower()
        assert collab_mod._cf_active is False
        assert collab_mod._cf_process is None

    def test_state_clean_after_failed_open(self):
        """On failure the module state must stay inactive."""
        with patch("subprocess.Popen", side_effect=FileNotFoundError):
            collab_mod.cloudflare_open()
        assert collab_mod._cf_active is False
        assert collab_mod._cf_url is None


# ── _CF_URL_RE regex ──────────────────────────────────────────────────────────

class TestCfUrlRegex:

    def test_matches_valid_url_inline(self):
        line = "INF |  https://random-name.trycloudflare.com  |"
        m = collab_mod._CF_URL_RE.search(line)
        assert m is not None
        assert m.group(0) == "https://random-name.trycloudflare.com"

    def test_matches_url_alone(self):
        line = "https://abc123.trycloudflare.com"
        assert collab_mod._CF_URL_RE.search(line) is not None

    def test_rejects_http(self):
        assert collab_mod._CF_URL_RE.search("http://x.trycloudflare.com") is None

    def test_rejects_other_domain(self):
        assert collab_mod._CF_URL_RE.search("https://x.ngrok.io") is None

    def test_rejects_bare_hostname(self):
        assert collab_mod._CF_URL_RE.search("x.trycloudflare.com") is None
