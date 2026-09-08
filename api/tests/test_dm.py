"""Tests for api/routers/dm.py — the parts that shape the DM system prompt
(narration length and point of view) plus session deletion.

Excludes the streaming /action endpoint and the extraction passes (live HTTP).
"""
import json
import pytest
from pydantic import ValidationError

from database import DEFAULT_AI_PROMPTS
import routers.dm as dm_mod
from models import AIPrompt, CodexEntry, CodexRelation, DmTurn, Project, UserSettings
from routers.dm import _apply_effects, _dm_system_prompt
from schemas import DmActionRequest


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


# ── /roll20 (roll-request mode) ───────────────────────────────────────────────

class TestRollRequestMode:
    """The directive is appended to the system prompt only for mode=roll_request;
    the streaming call itself is not exercised here."""

    def test_directive_overrides_the_beat_structure(self):
        assert "Do NOT narrate a beat" in dm_mod._ROLL_REQUEST_DIRECTIVE
        assert "d20" in dm_mod._ROLL_REQUEST_DIRECTIVE

    def test_schema_accepts_the_mode(self):
        assert DmActionRequest(content="", mode="roll_request").mode == "roll_request"
        assert DmActionRequest(content="I climb").mode is None

    def test_schema_rejects_an_unknown_mode(self):
        with pytest.raises(ValidationError):
            DmActionRequest(content="", mode="freeform")


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


# ── Codex descriptions grow with the story ────────────────────────────────────

class TestDescriptionAdd:
    def _entry(self, db, project, description=""):
        entry = CodexEntry(project_id=project.id, name="Vesna", entry_type="character",
                           description=description)
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return entry

    def test_appends_new_knowledge_to_the_description(self, db, project):
        entry = self._entry(db, project, "Salt-house foreman.")

        _apply_effects(project, {"codex_updates": [
            {"entry_id": entry.id, "description_add": "Owes the guild forty marks."},
        ]}, None, db)
        db.commit()

        assert db.get(CodexEntry, entry.id).description == "Salt-house foreman. Owes the guild forty marks."

    def test_fills_an_empty_description(self, db, project):
        entry = self._entry(db, project, "")

        _apply_effects(project, {"codex_updates": [
            {"entry_id": entry.id, "description_add": "Keeps a branding iron on the wall."},
        ]}, None, db)
        db.commit()

        assert db.get(CodexEntry, entry.id).description == "Keeps a branding iron on the wall."

    def test_does_not_repeat_what_the_description_already_says(self, db, project):
        entry = self._entry(db, project, "Owes the guild forty marks.")

        _apply_effects(project, {"codex_updates": [
            {"entry_id": entry.id, "description_add": "owes the guild forty marks."},
        ]}, None, db)
        db.commit()

        assert db.get(CodexEntry, entry.id).description == "Owes the guild forty marks."

    def test_undo_restores_the_previous_description(self, client, db, project):
        entry = self._entry(db, project, "Salt-house foreman.")
        session_id = client.post(f"/api/projects/{project.id}/dm/sessions", json={}).json()["id"]
        applied = _apply_effects(project, {"codex_updates": [
            {"entry_id": entry.id, "description_add": "Owes the guild forty marks."},
        ]}, None, db)
        turn = DmTurn(session_id=session_id, role="dm", content="...",
                      effects=json.dumps({"applied": applied, "undone": False}))
        db.add(turn)
        db.commit()

        assert client.post(f"/api/dm/turns/{turn.id}/undo-effects").status_code == 200
        db.expire_all()
        assert db.get(CodexEntry, entry.id).description == "Salt-house foreman."


# ── Relation suggestions ──────────────────────────────────────────────────────

class TestSuggestRelations:
    @pytest.fixture(autouse=True)
    def provider(self, db):
        """The pass needs a provider and the dm_relations prompt row; the test
        schema starts unseeded and post_provider itself is faked."""
        seed = next(p for p in DEFAULT_AI_PROMPTS if p["built_in_key"] == "dm_relations")
        db.add(UserSettings(active_provider="ollama", default_model="mock"))
        db.add(AIPrompt(**seed))
        db.commit()

    @pytest.fixture
    def cast(self, db, project):
        entries = [
            CodexEntry(project_id=project.id, name="Vesna Kolar", entry_type="character"),
            CodexEntry(project_id=project.id, name="Ilya Rusk", entry_type="character"),
        ]
        db.add_all(entries)
        db.commit()
        for e in entries:
            db.refresh(e)
        return entries

    def _reply(self, relations):
        return {"choices": [{"message": {"content": json.dumps({"relations": relations})}}]}

    def test_resolves_names_to_entry_ids(self, client, cast, project, monkeypatch):
        async def fake_post(*args, **kwargs):
            return self._reply([{"source": "Vesna Kolar", "target": "Ilya Rusk",
                                 "relation_type": "owes money to", "evidence": "She counted out his marks."}])
        monkeypatch.setattr(dm_mod, "post_provider", fake_post)

        rows = client.post(f"/api/projects/{project.id}/dm/suggest-relations").json()
        assert len(rows) == 1
        assert rows[0]["source_id"] == cast[0].id
        assert rows[0]["target_id"] == cast[1].id
        assert rows[0]["relation_type"] == "owes money to"
        assert rows[0]["existing_type"] is None

    def test_writes_nothing_on_its_own(self, client, cast, project, db, monkeypatch):
        async def fake_post(*args, **kwargs):
            return self._reply([{"source": "Vesna Kolar", "target": "Ilya Rusk", "relation_type": "hunts"}])
        monkeypatch.setattr(dm_mod, "post_provider", fake_post)

        client.post(f"/api/projects/{project.id}/dm/suggest-relations")
        assert db.query(CodexRelation).count() == 0

    def test_drops_unknown_names_and_self_relations(self, client, cast, project, monkeypatch):
        async def fake_post(*args, **kwargs):
            return self._reply([
                {"source": "Vesna Kolar", "target": "Nobody At All", "relation_type": "knows"},
                {"source": "Ilya Rusk", "target": "Ilya Rusk", "relation_type": "is"},
                {"source": "Vesna Kolar", "target": "Ilya Rusk", "relation_type": ""},
            ])
        monkeypatch.setattr(dm_mod, "post_provider", fake_post)

        assert client.post(f"/api/projects/{project.id}/dm/suggest-relations").json() == []

    def test_flags_a_replacement_and_hides_an_unchanged_relation(self, client, cast, project, db, monkeypatch):
        db.add(CodexRelation(source_id=cast[0].id, target_id=cast[1].id, relation_type="owes money to"))
        db.commit()

        async def fake_post(*args, **kwargs):
            return self._reply([{"source": "Vesna Kolar", "target": "Ilya Rusk", "relation_type": "owes money to"}])
        monkeypatch.setattr(dm_mod, "post_provider", fake_post)
        assert client.post(f"/api/projects/{project.id}/dm/suggest-relations").json() == []

        async def changed(*args, **kwargs):
            return self._reply([{"source": "Vesna Kolar", "target": "Ilya Rusk", "relation_type": "betrayed"}])
        monkeypatch.setattr(dm_mod, "post_provider", changed)
        rows = client.post(f"/api/projects/{project.id}/dm/suggest-relations").json()
        assert rows[0]["existing_type"] == "owes money to"

    def test_returns_empty_when_the_codex_is_too_small_to_relate(self, client, project, db):
        db.add(CodexEntry(project_id=project.id, name="Alone", entry_type="character"))
        db.commit()
        assert client.post(f"/api/projects/{project.id}/dm/suggest-relations").json() == []


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
