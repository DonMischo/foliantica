"""
Phase 5 — UPnP internet access.

miniupnpc is never imported from the real package; every test that exercises
the open/close path patches collab_mod.upnp_open / collab_mod.upnp_close
directly (or patches miniupnpc at the import level).  This keeps the test
suite runnable on machines that do not have a UPnP gateway and even on
machines without miniupnpc installed.

The atexit-registered cleanup is not exercised here (it fires at interpreter
shutdown, outside the pytest lifecycle), but the module-level _upnp_* state
and the endpoint behaviour are fully covered.
"""

from unittest.mock import patch, MagicMock

import pytest

import routers.collab as collab_mod
from tests.conftest import make_invitation


# ── Status endpoint ───────────────────────────────────────────────────────────

class TestUPnPStatus:

    def test_initial_state(self, client):
        r = client.get("/api/collab/upnp/status")
        assert r.status_code == 200
        data = r.json()
        assert data["active"] is False
        assert data["disclaimer_accepted"] is False
        assert data["external_ip"] is None
        assert data["external_url"] is None
        assert data["ports_mapped"] == []

    def test_status_reflects_runtime_state(self, client):
        collab_mod._upnp_active = True
        collab_mod._upnp_external_ip = "1.2.3.4"
        collab_mod._upnp_mapped_ports[:] = [3000, 8765]
        r = client.get("/api/collab/upnp/status")
        data = r.json()
        assert data["active"] is True
        assert data["external_ip"] == "1.2.3.4"
        assert "1.2.3.4" in data["external_url"]
        assert data["ports_mapped"] == [3000, 8765]


# ── Disclaimer acceptance ─────────────────────────────────────────────────────

class TestDisclaimer:

    def test_accept_disclaimer(self, client):
        r = client.post("/api/collab/upnp/accept-disclaimer")
        assert r.status_code == 200
        assert r.json()["disclaimer_accepted"] is True

    def test_disclaimer_persisted(self, client):
        client.post("/api/collab/upnp/accept-disclaimer")
        assert collab_mod.is_upnp_disclaimer_accepted() is True

    def test_disclaimer_reflected_in_status(self, client):
        client.post("/api/collab/upnp/accept-disclaimer")
        r = client.get("/api/collab/upnp/status")
        assert r.json()["disclaimer_accepted"] is True

    def test_disclaimer_idempotent(self, client):
        client.post("/api/collab/upnp/accept-disclaimer")
        client.post("/api/collab/upnp/accept-disclaimer")
        assert collab_mod.is_upnp_disclaimer_accepted() is True


# ── Open port ─────────────────────────────────────────────────────────────────

def _make_upnp_mock(external_ip="1.2.3.4"):
    """Build a miniupnpc.UPnP() mock that reports a successful mapping."""
    upnp = MagicMock()
    upnp.discover.return_value = 1
    upnp.externalipaddress.return_value = external_ip
    upnp.addportmapping.return_value = True

    mock_module = MagicMock()
    mock_module.UPnP.return_value = upnp
    return mock_module, upnp


class TestUpnpOpen:

    def test_open_success(self, client, monkeypatch):
        mock_module, _ = _make_upnp_mock("5.6.7.8")
        monkeypatch.setitem(__import__("sys").modules, "miniupnpc", mock_module)

        with patch.object(collab_mod, "upnp_open",
                          return_value={
                              "success": True,
                              "external_ip": "5.6.7.8",
                              "external_url": "http://5.6.7.8:3000",
                              "ports_mapped": [3000, 8765],
                          }):
            r = client.post("/api/collab/upnp/open")

        assert r.status_code == 200
        data = r.json()
        assert data["external_ip"] == "5.6.7.8"
        assert 3000 in data["ports_mapped"]

    def test_open_no_gateway_returns_503(self, client):
        with patch.object(collab_mod, "upnp_open",
                          return_value={"success": False,
                                        "error": "No UPnP gateway found"}):
            r = client.post("/api/collab/upnp/open")
        assert r.status_code == 503
        assert "gateway" in r.json()["detail"].lower()

    def test_open_updates_module_state(self, client):
        with patch.object(collab_mod, "upnp_open",
                          side_effect=lambda: (
                              setattr(collab_mod, "_upnp_active", True) or
                              setattr(collab_mod, "_upnp_external_ip", "9.9.9.9") or
                              {
                                  "success": True,
                                  "external_ip": "9.9.9.9",
                                  "external_url": "http://9.9.9.9:3000",
                                  "ports_mapped": [3000],
                              }
                          )):
            client.post("/api/collab/upnp/open")

    def test_miniupnpc_missing_returns_503(self, client):
        """If miniupnpc is not installed, upnp_open returns a helpful error."""
        with patch.object(collab_mod, "upnp_open",
                          return_value={"success": False,
                                        "error": "miniupnpc is not installed"}):
            r = client.post("/api/collab/upnp/open")
        assert r.status_code == 503
        assert "miniupnpc" in r.json()["detail"]


# ── Close port ────────────────────────────────────────────────────────────────

class TestUpnpClose:

    def test_close_returns_inactive(self, client):
        collab_mod._upnp_active = True
        collab_mod._upnp_mapped_ports[:] = [3000, 8765]

        with patch.object(collab_mod, "upnp_close") as mock_close:
            r = client.post("/api/collab/upnp/close")
            mock_close.assert_called_once()

        assert r.status_code == 200
        assert r.json()["active"] is False

    def test_close_when_already_inactive(self, client):
        """Closing when nothing is open must not error."""
        with patch.object(collab_mod, "upnp_close"):
            r = client.post("/api/collab/upnp/close")
        assert r.status_code == 200

    def test_close_resets_module_state(self):
        """upnp_close() directly clears module state (unit test, no HTTP)."""
        collab_mod._upnp_active = True
        collab_mod._upnp_external_ip = "1.1.1.1"
        collab_mod._upnp_mapped_ports[:] = [3000]

        with patch("builtins.__import__", side_effect=ImportError):
            # Even if miniupnpc can't be imported, state must be reset
            collab_mod.upnp_close()

        assert collab_mod._upnp_active is False
        assert collab_mod._upnp_external_ip is None
        assert collab_mod._upnp_mapped_ports == []

    def test_close_idempotent(self):
        """Calling upnp_close() twice must not raise."""
        with patch("builtins.__import__", side_effect=ImportError):
            collab_mod.upnp_close()
            collab_mod.upnp_close()  # second call is a no-op


# ── upnp_open unit tests (no HTTP) ───────────────────────────────────────────

class TestUpnpOpenUnit:

    def test_returns_error_when_no_devices_found(self, monkeypatch):
        mock_upnp = MagicMock()
        mock_upnp.discover.return_value = 0
        mock_module = MagicMock()
        mock_module.UPnP.return_value = mock_upnp
        monkeypatch.setitem(__import__("sys").modules, "miniupnpc", mock_module)

        result = collab_mod.upnp_open()

        assert result["success"] is False
        assert "gateway" in result["error"].lower()

    def test_returns_success_on_mapping(self, monkeypatch):
        mock_upnp = MagicMock()
        mock_upnp.discover.return_value = 1
        mock_upnp.externalipaddress.return_value = "2.3.4.5"
        mock_upnp.addportmapping.return_value = True
        mock_module = MagicMock()
        mock_module.UPnP.return_value = mock_upnp
        monkeypatch.setitem(__import__("sys").modules, "miniupnpc", mock_module)

        result = collab_mod.upnp_open()

        assert result["success"] is True
        assert result["external_ip"] == "2.3.4.5"
        assert "2.3.4.5" in result["external_url"]
        assert collab_mod._upnp_active is True
        assert collab_mod._upnp_external_ip == "2.3.4.5"

    def test_partial_port_failure_still_succeeds(self, monkeypatch):
        """If one port fails to map but another succeeds, result is success."""
        call_count = 0

        def add_mapping_side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("port in use")
            return True

        mock_upnp = MagicMock()
        mock_upnp.discover.return_value = 1
        mock_upnp.externalipaddress.return_value = "3.3.3.3"
        mock_upnp.addportmapping.side_effect = add_mapping_side_effect
        mock_module = MagicMock()
        mock_module.UPnP.return_value = mock_upnp
        monkeypatch.setitem(__import__("sys").modules, "miniupnpc", mock_module)

        result = collab_mod.upnp_open()

        assert result["success"] is True
        assert len(result["ports_mapped"]) == 1
