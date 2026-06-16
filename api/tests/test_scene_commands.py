"""
Tests for api/routers/scene_commands.py.

  - TestCommandExtractor  — unit tests for _CommandExtractor HTML parser
  - TestSyncCommands      — POST /api/scenes/{id}/commands/sync
  - TestResync            — POST /api/projects/{id}/commands/resync
  - TestCommandHistory    — GET  /api/projects/{id}/command-history
  - TestItemLog           — GET  /api/scenes/{id}/item-log
  - TestCurrencyBalance   — GET  /api/scenes/{id}/currency-balance
  - TestCharacterCurrencies — GET /api/codex/{id}/currencies
  - TestInventorySummary  — GET /api/codex/{id}/inventory-summary
"""
import json
import pytest

from routers.scene_commands import _CommandExtractor


# ── Helpers ───────────────────────────────────────────────────────────────────

def _currency_div(char_id, name, delta, order=0):
    return (
        f'<div data-type="currency" data-char-id="{char_id}" '
        f'data-currency-name="{name}" data-delta="{delta}"></div>'
    )

def _item_div(char_id, item_id, qty=1, order=0):
    return (
        f'<div data-type="item" data-char-id="{char_id}" '
        f'data-item-id="{item_id}" data-qty="{qty}"></div>'
    )


def _sync(client, scene_id, commands):
    r = client.post(f"/api/scenes/{scene_id}/commands/sync", json={"commands": commands})
    assert r.status_code == 200
    return r.json()


# ── _CommandExtractor unit tests ──────────────────────────────────────────────

class TestCommandExtractor:
    def test_empty_html_yields_no_commands(self):
        ext = _CommandExtractor()
        ext.feed("<p>Plain text here.</p>")
        assert ext.commands == []

    def test_currency_div_parsed(self):
        ext = _CommandExtractor()
        ext.feed(_currency_div(1, "Gold", 50))
        assert len(ext.commands) == 1
        cmd = ext.commands[0]
        assert cmd["command_type"] == "currency"
        assert cmd["character_id"] == 1
        data = json.loads(cmd["data"])
        assert data["currencyName"] == "Gold"
        assert data["delta"] == 50

    def test_item_div_parsed(self):
        ext = _CommandExtractor()
        ext.feed(_item_div(2, 99, qty=3))
        assert len(ext.commands) == 1
        cmd = ext.commands[0]
        assert cmd["command_type"] == "item"
        assert cmd["character_id"] == 2
        assert cmd["item_id"] == 99
        data = json.loads(cmd["data"])
        assert data["qty"] == 3

    def test_multiple_commands_ordered(self):
        html = _currency_div(1, "Silver", 10) + _item_div(1, 5)
        ext = _CommandExtractor()
        ext.feed(html)
        assert len(ext.commands) == 2
        assert ext.commands[0]["order_index"] == 0
        assert ext.commands[1]["order_index"] == 1

    def test_item_div_with_zero_item_id_uses_none(self):
        # data-item-id="0" → item_id should be None (falsy → None)
        ext = _CommandExtractor()
        ext.feed('<div data-type="item" data-char-id="1" data-item-id="0" data-qty="1"></div>')
        assert ext.commands[0]["item_id"] is None

    def test_non_command_divs_ignored(self):
        ext = _CommandExtractor()
        ext.feed('<div class="paragraph">Normal paragraph.</div>')
        assert ext.commands == []


# ── POST /scenes/{id}/commands/sync ──────────────────────────────────────────

class TestSyncCommands:
    def test_sync_empty_clears_commands(self, client, scene):
        # First add a command, then sync with empty list
        _sync(client, scene["id"], [{
            "command_type": "currency",
            "character_id": 1,
            "order_index": 0,
        }])
        result = _sync(client, scene["id"], [])
        assert result == []

    def test_sync_creates_commands(self, client, scene):
        cmds = [
            {"command_type": "currency", "character_id": 1,
             "data": {"currencyName": "Gold", "delta": 10}, "order_index": 0},
        ]
        result = _sync(client, scene["id"], cmds)
        assert len(result) == 1
        assert result[0]["command_type"] == "currency"
        assert result[0]["character_id"] == 1

    def test_sync_replaces_existing(self, client, scene):
        _sync(client, scene["id"], [
            {"command_type": "currency", "character_id": 1, "order_index": 0},
            {"command_type": "currency", "character_id": 2, "order_index": 1},
        ])
        result = _sync(client, scene["id"], [
            {"command_type": "item", "character_id": 3, "item_id": 5, "order_index": 0},
        ])
        assert len(result) == 1
        assert result[0]["command_type"] == "item"
        assert result[0]["character_id"] == 3

    def test_sync_unknown_scene_returns_404(self, client):
        r = client.post("/api/scenes/99999/commands/sync", json={"commands": []})
        assert r.status_code == 404

    def test_sync_item_command(self, client, scene):
        cmds = [
            {"command_type": "item", "character_id": 1, "item_id": 42,
             "data": {"qty": 2}, "order_index": 0},
        ]
        result = _sync(client, scene["id"], cmds)
        assert result[0]["item_id"] == 42


# ── POST /projects/{id}/commands/resync ───────────────────────────────────────

class TestResync:
    def test_resync_empty_project_returns_ok(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/commands/resync")
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_resync_extracts_from_scene_html(self, client, db, scene, project):
        # Put command HTML directly into scene content
        from models import Scene
        html = f"<p>Some text.</p>{_currency_div(1, 'Gold', 100)}"
        db.query(Scene).filter(Scene.id == scene["id"]).update({"content": html})
        db.commit()

        r = client.post(f"/api/projects/{project['id']}/commands/resync")
        assert r.status_code == 200

        # Verify the command now appears in history
        hist = client.get(f"/api/projects/{project['id']}/command-history").json()
        assert len(hist) == 1
        assert hist[0]["commands"][0]["command_type"] == "currency"


# ── GET /projects/{id}/command-history ───────────────────────────────────────

class TestCommandHistory:
    def test_empty_history(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/command-history")
        assert r.status_code == 200
        assert r.json() == []

    def test_synced_commands_appear_in_history(self, client, scene, project):
        _sync(client, scene["id"], [
            {"command_type": "currency", "character_id": 1,
             "data": {"currencyName": "Gold", "delta": 5}, "order_index": 0},
        ])
        hist = client.get(f"/api/projects/{project['id']}/command-history").json()
        assert len(hist) == 1
        assert hist[0]["scene_id"] == scene["id"]
        assert hist[0]["commands"][0]["command_type"] == "currency"

    def test_filter_by_command_type(self, client, scene, project):
        _sync(client, scene["id"], [
            {"command_type": "currency", "character_id": 1, "order_index": 0},
            {"command_type": "item", "character_id": 1, "item_id": 5, "order_index": 1},
        ])
        hist = client.get(
            f"/api/projects/{project['id']}/command-history",
            params={"command_type": "item"},
        ).json()
        # Only item commands grouped
        all_types = [c["command_type"] for group in hist for c in group["commands"]]
        assert all(t == "item" for t in all_types)

    def test_filter_by_character_id(self, client, scene, project):
        _sync(client, scene["id"], [
            {"command_type": "currency", "character_id": 1, "order_index": 0},
            {"command_type": "currency", "character_id": 2, "order_index": 1},
        ])
        hist = client.get(
            f"/api/projects/{project['id']}/command-history",
            params={"character_id": 1},
        ).json()
        all_char_ids = [c["character_id"] for group in hist for c in group["commands"]]
        assert all(cid == 1 for cid in all_char_ids)


# ── GET /scenes/{id}/item-log ─────────────────────────────────────────────────

class TestItemLog:
    def test_empty_item_log(self, client, scene):
        r = client.get(f"/api/scenes/{scene['id']}/item-log",
                       params={"item_id": 5, "character_id": 1})
        assert r.status_code == 200
        assert r.json() == []

    def test_item_log_shows_synced_commands(self, client, scene):
        _sync(client, scene["id"], [
            {"command_type": "item", "character_id": 1, "item_id": 5,
             "data": {"qty": 2}, "order_index": 0},
        ])
        r = client.get(f"/api/scenes/{scene['id']}/item-log",
                       params={"item_id": 5, "character_id": 1})
        assert r.status_code == 200
        log = r.json()
        assert len(log) == 1
        assert log[0]["qty"] == 2
        assert log[0]["scene_id"] == scene["id"]
        assert log[0]["is_current_scene"] is True


# ── GET /scenes/{id}/currency-balance ────────────────────────────────────────

class TestCurrencyBalance:
    def test_zero_balance_when_no_commands(self, client, scene):
        r = client.get(f"/api/scenes/{scene['id']}/currency-balance",
                       params={"character_id": 1, "currency_name": "Gold"})
        assert r.status_code == 200
        assert r.json()["balance"] == 0

    def test_balance_excludes_current_scene(self, client, scene):
        # Commands IN the current scene don't count — only scenes BEFORE it
        _sync(client, scene["id"], [
            {"command_type": "currency", "character_id": 1,
             "data": {"currencyName": "Gold", "delta": 100}, "order_index": 0},
        ])
        r = client.get(f"/api/scenes/{scene['id']}/currency-balance",
                       params={"character_id": 1, "currency_name": "Gold"})
        # current scene is position 0, so no scenes before it → balance = 0
        assert r.json()["balance"] == 0


# ── GET /codex/{id}/currencies ────────────────────────────────────────────────

class TestCharacterCurrencies:
    def _make_codex_entry(self, client, project_id):
        r = client.post("/api/codex", json={
            "name": "Hero", "project_id": project_id, "entry_type": "character",
        })
        assert r.status_code == 201
        return r.json()

    def test_no_currencies_returns_empty(self, client, project):
        entry = self._make_codex_entry(client, project["id"])
        r = client.get(f"/api/codex/{entry['id']}/currencies")
        assert r.status_code == 200
        assert r.json() == []

    def test_command_detected_currency_appears(self, client, project, scene):
        entry = self._make_codex_entry(client, project["id"])
        _sync(client, scene["id"], [
            {"command_type": "currency", "character_id": entry["id"],
             "data": {"currencyName": "Silver", "delta": 10}, "order_index": 0},
        ])
        r = client.get(f"/api/codex/{entry['id']}/currencies")
        assert "Silver" in r.json()


# ── GET /codex/{id}/inventory-summary ────────────────────────────────────────

class TestInventorySummary:
    def _make_codex_entry(self, client, project_id):
        r = client.post("/api/codex", json={
            "name": "Warrior", "project_id": project_id, "entry_type": "character",
        })
        assert r.status_code == 201
        return r.json()

    def test_empty_inventory(self, client, project):
        entry = self._make_codex_entry(client, project["id"])
        r = client.get(f"/api/codex/{entry['id']}/inventory-summary")
        assert r.status_code == 200
        body = r.json()
        assert body["items"] == []
        assert body["currencies"] == []

    def test_command_adds_to_currency_balance(self, client, project, scene):
        entry = self._make_codex_entry(client, project["id"])
        _sync(client, scene["id"], [
            {"command_type": "currency", "character_id": entry["id"],
             "data": {"currencyName": "Gold", "delta": 50}, "order_index": 0},
        ])
        r = client.get(f"/api/codex/{entry['id']}/inventory-summary")
        currencies = r.json()["currencies"]
        gold = next((c for c in currencies if c["name"] == "Gold"), None)
        assert gold is not None
        assert gold["balance"] == 50

    def test_item_command_adds_to_items(self, client, project, scene):
        entry = self._make_codex_entry(client, project["id"])
        _sync(client, scene["id"], [
            {"command_type": "item", "character_id": entry["id"], "item_id": 7,
             "data": {"qty": 3}, "order_index": 0},
        ])
        r = client.get(f"/api/codex/{entry['id']}/inventory-summary")
        items = r.json()["items"]
        found = next((i for i in items if i["item_id"] == 7), None)
        assert found is not None
        assert found["qty"] == 3
