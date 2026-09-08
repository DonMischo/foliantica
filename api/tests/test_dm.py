"""Tests for api/routers/dm.py — the parts that shape the DM system prompt
(narration length and point of view) plus session deletion.

Excludes the streaming /action endpoint and the extraction passes (live HTTP).
"""
import json
import pytest

from database import DEFAULT_AI_PROMPTS
from models import AIPrompt, Project
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


# ── Session deletion ──────────────────────────────────────────────────────────

class TestDeleteSession:
    def test_deletes_the_session(self, client, project):
        session_id = client.post(f"/api/projects/{project.id}/dm/sessions", json={}).json()["id"]

        assert client.delete(f"/api/dm/sessions/{session_id}").status_code == 204
        assert client.get(f"/api/projects/{project.id}/dm/sessions").json() == []

    def test_unknown_session_404s(self, client):
        assert client.delete("/api/dm/sessions/999999").status_code == 404
