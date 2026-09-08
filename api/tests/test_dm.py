"""Tests for api/routers/dm.py — the parts that shape the DM system prompt
(narration length and point of view) plus session deletion.

Excludes the streaming /action endpoint and the extraction passes (live HTTP).
"""
import json
import pytest

from database import DEFAULT_AI_PROMPTS
from models import AIPrompt, CodexEntry, DmTurn, Project
from routers.dm import _dm_system_prompt


@pytest.fixture
def project(db):
    p = Project(title="Ashfall", kind="rpg")
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@pytest.fixture
def persona(db):
    """The built-in DM persona row — the test schema starts unseeded."""
    seed = next(p for p in DEFAULT_AI_PROMPTS if p["built_in_key"] == "dm_persona")
    row = AIPrompt(**seed)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# ── Narration length ──────────────────────────────────────────────────────────

class TestWordCount:
    def test_prompt_word_count_reaches_the_system_prompt(self, db, project, persona):
        persona.word_count = 120
        db.commit()

        prompt = _dm_system_prompt(project, db)
        assert "120 words" in prompt
        assert "{{WORD_COUNT}}" not in prompt

    def test_custom_persona_without_the_placeholder_still_gets_a_length_rule(self, db, project, persona):
        persona.system = "You are a game master. Narrate in {{LANGUAGE}}."
        persona.word_count = 90
        db.commit()

        prompt = _dm_system_prompt(project, db)
        assert "about 90 words per beat" in prompt
        assert "never exceed 135" in prompt


# ── Point of view ─────────────────────────────────────────────────────────────

class TestPov:
    def test_defaults_to_second_person(self, db, project):
        prompt = _dm_system_prompt(project, db)
        assert "second person" in prompt

    @pytest.mark.parametrize("pov,expected", [
        ("first", "first person"),
        ("third", "third person limited"),
        ("second", "second person"),
    ])
    def test_pref_selects_the_pov_directive(self, db, project, pov, expected):
        project.dm_prefs = json.dumps({"pov": pov})
        db.commit()

        prompt = _dm_system_prompt(project, db)
        assert expected in prompt
        assert "{{POV}}" not in prompt

    def test_unknown_pov_falls_back_to_second_person(self, db, project):
        project.dm_prefs = json.dumps({"pov": "omniscient"})
        db.commit()

        assert "second person" in _dm_system_prompt(project, db)

    def test_custom_persona_without_the_placeholder_gets_the_pov_appended(self, db, project, persona):
        persona.system = "You are a game master. Narrate in {{LANGUAGE}}."
        db.commit()
        project.dm_prefs = json.dumps({"pov": "third"})
        db.commit()

        prompt = _dm_system_prompt(project, db)
        assert "Narration settings" in prompt
        assert "third person limited" in prompt


# ── Prefs endpoint ────────────────────────────────────────────────────────────

class TestPrefs:
    def test_patch_persists_pov(self, client, project):
        r = client.patch(f"/api/projects/{project.id}/dm/prefs", json={"pov": "third"})
        assert r.status_code == 200
        assert r.json()["pov"] == "third"

        assert client.get(f"/api/projects/{project.id}/dm/prefs").json()["pov"] == "third"

    def test_rejects_an_unknown_pov(self, client, project):
        r = client.patch(f"/api/projects/{project.id}/dm/prefs", json={"pov": "omniscient"})
        assert r.status_code == 422


# ── Turn deletion ─────────────────────────────────────────────────────────────

class TestDeleteTurn:
    @pytest.fixture
    def session_id(self, client, project):
        return client.post(f"/api/projects/{project.id}/dm/sessions", json={}).json()["id"]

    def _turn(self, db, session_id, role, content, effects=None):
        turn = DmTurn(session_id=session_id, role=role, content=content, effects=effects)
        db.add(turn)
        db.commit()
        db.refresh(turn)
        return turn

    def test_deletes_a_player_prompt(self, client, db, session_id):
        turn = self._turn(db, session_id, "player", "I kick the door.")

        assert client.delete(f"/api/dm/turns/{turn.id}").status_code == 204
        assert client.get(f"/api/dm/sessions/{session_id}/turns").json() == []

    def test_deletes_a_dm_answer_mid_history(self, client, db, session_id):
        """The old endpoint only allowed the session's last turn; a player
        clearing a bad exchange needs to reach earlier ones too."""
        first = self._turn(db, session_id, "dm", "The door holds.")
        self._turn(db, session_id, "player", "I kick it again.")

        assert client.delete(f"/api/dm/turns/{first.id}").status_code == 204
        remaining = client.get(f"/api/dm/sessions/{session_id}/turns").json()
        assert [t["content"] for t in remaining] == ["I kick it again."]

    def test_rolls_back_the_world_changes_the_turn_applied(self, client, db, project, session_id):
        entry = CodexEntry(project_id=project.id, name="Ilya", entry_type="character",
                           rpg_sheet=json.dumps({"hp": {"current": 4, "max": 10}}))
        db.add(entry)
        db.commit()
        db.refresh(entry)
        before = entry.rpg_sheet

        entry.rpg_sheet = json.dumps({"hp": {"current": 1, "max": 10}})
        turn = self._turn(db, session_id, "dm", "The blade bites.", effects=json.dumps({
            "applied": {
                "created_entries": [],
                "updated_entries": [{"id": entry.id, "prev_rpg_sheet": before}],
                "scene": None,
            }
        }))
        db.commit()

        assert client.delete(f"/api/dm/turns/{turn.id}").status_code == 204
        db.expire_all()
        assert json.loads(db.get(CodexEntry, entry.id).rpg_sheet)["hp"]["current"] == 4

    def test_unknown_turn_404s(self, client):
        assert client.delete("/api/dm/turns/999999").status_code == 404


# ── Session deletion ──────────────────────────────────────────────────────────

class TestDeleteSession:
    def test_deletes_the_session(self, client, project):
        session_id = client.post(f"/api/projects/{project.id}/dm/sessions", json={}).json()["id"]

        assert client.delete(f"/api/dm/sessions/{session_id}").status_code == 204
        assert client.get(f"/api/projects/{project.id}/dm/sessions").json() == []

    def test_unknown_session_404s(self, client):
        assert client.delete("/api/dm/sessions/999999").status_code == 404
