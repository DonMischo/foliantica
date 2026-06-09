"""
Tests for api/routers/ai.py.

Two categories:
  - Unit / error-path tests: run offline, no network, no API key required.
  - Live integration tests (@pytest.mark.live): make real calls to OpenRouter
    using the Gemma 4 31B free model.  They are skipped automatically when the
    key is not available (CI, fresh checkouts, etc.).

Key is loaded from api/.env.test (gitignored):
    OPENROUTER_TEST_KEY=sk-or-v1-...

Or from the environment variable OPENROUTER_TEST_KEY directly.
"""
import json
import os
from pathlib import Path

import pytest

from crypto import encrypt
from models import UserSettings
from routers.ai import _fill_placeholders, LANGUAGE_NAMES


# ── Key loading ───────────────────────────────────────────────────────────────

def _load_key_from_env_file() -> str | None:
    """Parse api/.env.test and return the OPENROUTER_TEST_KEY value, or None."""
    env_file = Path(__file__).parent.parent / ".env.test"
    if not env_file.exists():
        return None
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            if k.strip() == "OPENROUTER_TEST_KEY":
                return v.strip()
    return None


_OPENROUTER_KEY: str | None = (
    os.environ.get("OPENROUTER_TEST_KEY") or _load_key_from_env_file()
)

AI_MODEL = "google/gemma-4-31b-it:free"


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def openrouter_key() -> str:
    """Skip the test if no key is available."""
    if not _OPENROUTER_KEY:
        pytest.skip(
            "OPENROUTER_TEST_KEY not set — create api/.env.test or set the env var"
        )
    return _OPENROUTER_KEY


@pytest.fixture
def ai_client(client, db, openrouter_key):
    """
    FastAPI TestClient pre-seeded with a UserSettings row that points at
    OpenRouter + Gemma 4 31B free.  The key is stored encrypted in the DB,
    exactly as the production app would store it.
    """
    settings = UserSettings(
        active_provider="openrouter",
        openrouter_api_key=encrypt(openrouter_key),
        default_model=AI_MODEL,
    )
    db.add(settings)
    db.commit()
    return client


@pytest.fixture
def scene_with_content(ai_client, project, chapter):
    """Scene with real prose content for synopsis / generate tests."""
    r = ai_client.post(
        "/api/scenes",
        json={"title": "The Encounter", "chapter_id": chapter["id"], "order_index": 0},
    )
    assert r.status_code == 201
    scene_id = r.json()["id"]
    content = (
        "<p>Elara stepped into the moonlit clearing, her hand resting on the hilt "
        "of her blade. Across the glade, the hooded figure finally lowered its hood, "
        "revealing the face she had spent three years searching for — her brother, "
        "alive and unharmed. Relief flooded her chest, but the crossbow aimed at her "
        "heart told her this reunion would not be simple.</p>"
    )
    r2 = ai_client.patch(f"/api/scenes/{scene_id}", json={"content": content})
    assert r2.status_code == 200
    return r2.json()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _collect_sse_content(response) -> str:
    """
    Parse an SSE response body and concatenate all content tokens.
    Works because TestClient buffers the full StreamingResponse.
    """
    tokens: list[str] = []
    for line in response.text.splitlines():
        if not line.startswith("data: "):
            continue
        payload = line[6:]
        if payload == "[DONE]":
            break
        try:
            chunk = json.loads(payload)
            token = chunk["choices"][0]["delta"].get("content", "")
            if token:
                tokens.append(token)
        except (json.JSONDecodeError, KeyError, IndexError):
            pass
    return "".join(tokens)


# ── Unit tests: _fill_placeholders ───────────────────────────────────────────

class TestFillPlaceholders:
    def test_replaces_all_keys(self):
        result = _fill_placeholders("{{FOO}} and {{BAR}}", {"FOO": "hello", "BAR": "world"})
        assert result == "hello and world"

    def test_unknown_key_left_intact(self):
        result = _fill_placeholders("{{MISSING}}", {"OTHER": "x"})
        assert result == "{{MISSING}}"

    def test_empty_template(self):
        assert _fill_placeholders("", {"FOO": "bar"}) == ""

    def test_repeated_placeholder(self):
        result = _fill_placeholders("{{X}} {{X}}", {"X": "A"})
        assert result == "A A"

    def test_no_placeholders(self):
        assert _fill_placeholders("plain text", {"X": "y"}) == "plain text"


# ── Unit test: LANGUAGE_NAMES completeness ────────────────────────────────────

class TestLanguageNames:
    def test_common_codes_present(self):
        for code in ("en", "de", "fr", "es", "it", "pt", "ja", "zh"):
            assert code in LANGUAGE_NAMES, f"Missing language code: {code}"

    def test_values_are_non_empty_strings(self):
        for code, name in LANGUAGE_NAMES.items():
            assert isinstance(name, str) and name, f"Empty name for {code!r}"


# ── Error-path tests (no network, no API key) ─────────────────────────────────

class TestAIErrorPaths:
    def test_generate_scene_not_found(self, client):
        r = client.post("/api/ai/generate", json={
            "scene_id": 99999, "mode": "continue", "model": AI_MODEL,
        })
        assert r.status_code == 404

    def test_generate_no_settings(self, client, scene):
        r = client.post("/api/ai/generate", json={
            "scene_id": scene["id"], "mode": "continue", "model": AI_MODEL,
        })
        assert r.status_code == 400

    def test_ki_scene_not_found(self, client):
        r = client.post("/api/ai/ki", json={
            "scene_id": 99999, "model": AI_MODEL, "prompt": "Write something.",
        })
        assert r.status_code == 404

    def test_ki_no_settings(self, client, scene):
        r = client.post("/api/ai/ki", json={
            "scene_id": scene["id"], "model": AI_MODEL, "prompt": "Write.",
        })
        assert r.status_code == 400

    def test_translate_no_settings(self, client):
        r = client.post("/api/ai/translate", json={
            "text": "Hello", "target_language": "German", "model": AI_MODEL,
        })
        assert r.status_code == 400

    def test_structure_no_settings(self, client):
        r = client.post("/api/ai/structure", json={
            "text": "A character named Bob.", "entry_type": "character",
            "model": AI_MODEL,
        })
        assert r.status_code == 400

    def test_synopsis_scene_not_found(self, client):
        r = client.post("/api/ai/scenes/99999/synopsis")
        assert r.status_code == 404

    def test_synopsis_no_settings(self, client, scene):
        r = client.post(f"/api/ai/scenes/{scene['id']}/synopsis")
        assert r.status_code == 400

    def test_synopsis_empty_scene(self, client, db, project, chapter, openrouter_key):
        """Empty scene content must return 400 before hitting the provider."""
        settings = UserSettings(
            active_provider="openrouter",
            openrouter_api_key=encrypt(openrouter_key),
            default_model=AI_MODEL,
        )
        db.add(settings)
        db.commit()
        # Create a scene with no content
        r = client.post("/api/scenes", json={
            "title": "Empty", "chapter_id": chapter["id"], "order_index": 0,
        })
        assert r.status_code == 201
        scene_id = r.json()["id"]
        r2 = client.post(f"/api/ai/scenes/{scene_id}/synopsis")
        assert r2.status_code == 400

    def test_generate_no_api_key_returns_400(self, client, db, scene):
        """UserSettings exists but no key configured → 400 (not 500)."""
        settings = UserSettings(
            active_provider="openrouter",
            default_model=AI_MODEL,
        )
        db.add(settings)
        db.commit()
        r = client.post("/api/ai/generate", json={
            "scene_id": scene["id"], "mode": "continue", "model": AI_MODEL,
        })
        assert r.status_code == 400

    def test_chat_scene_not_found(self, client):
        r = client.post("/api/ai/chat", json={
            "scene_id": 99999, "messages": [{"role": "user", "content": "Hi"}],
            "model": AI_MODEL,
        })
        assert r.status_code == 404

    def test_chat_no_settings(self, client, scene):
        r = client.post("/api/ai/chat", json={
            "scene_id": scene["id"],
            "messages": [{"role": "user", "content": "Hi"}],
            "model": AI_MODEL,
        })
        assert r.status_code == 400


# ── Live integration tests (real OpenRouter calls) ────────────────────────────

@pytest.mark.live
class TestAITranslate:
    def test_translate_english_to_german(self, ai_client):
        r = ai_client.post("/api/ai/translate", json={
            "text": "The hero entered the dark forest.",
            "target_language": "German",
            "model": AI_MODEL,
        }, timeout=60)
        assert r.status_code == 200
        data = r.json()
        assert "text" in data
        assert len(data["text"]) > 5  # got something back
        # German typically contains umlauts or common German words
        text_lower = data["text"].lower()
        assert any(w in text_lower for w in ("der", "die", "das", "den", "held", "wald", "dunkl", "betrat"))

    def test_translate_returns_non_empty(self, ai_client):
        r = ai_client.post("/api/ai/translate", json={
            "text": "Once upon a time.",
            "target_language": "French",
            "model": AI_MODEL,
        }, timeout=60)
        assert r.status_code == 200
        assert r.json()["text"].strip() != ""


@pytest.mark.live
class TestAIStructure:
    def test_structure_character_returns_sections(self, ai_client):
        description = (
            "Mira is a 28-year-old sorceress with silver hair and violet eyes. "
            "She is clever and ruthless, trained in the arcane arts from childhood. "
            "She works as a spy for the royal court."
        )
        r = ai_client.post("/api/ai/structure", json={
            "text": description,
            "entry_type": "character",
            "model": AI_MODEL,
        }, timeout=90)
        assert r.status_code == 200
        data = r.json()
        assert "text" in data
        assert len(data["text"]) > 20
        assert isinstance(data["suggested_tags"], list)
        assert isinstance(data["suggested_groups"], list)

    def test_structure_parses_suggestions_delimiter(self, ai_client):
        """Verify the <<<SUGGESTIONS>>> JSON is parsed out of the raw response."""
        r = ai_client.post("/api/ai/structure", json={
            "text": "A magical sword forged in dragonfire, owned by the king.",
            "entry_type": "item",
            "model": AI_MODEL,
        }, timeout=90)
        assert r.status_code == 200
        data = r.json()
        # structured_text must NOT contain the delimiter marker
        assert "<<<SUGGESTIONS>>>" not in data["text"]
        assert "<<<TEXT>>>" not in data["text"]


@pytest.mark.live
class TestAISynopsis:
    def test_synopsis_returns_non_empty_string(self, ai_client, scene_with_content):
        r = ai_client.post(f"/api/ai/scenes/{scene_with_content['id']}/synopsis",
                           timeout=60)
        assert r.status_code == 200
        synopsis = r.json()["synopsis"]
        assert isinstance(synopsis, str)
        assert len(synopsis) > 10


@pytest.mark.live
class TestAIGenerateStreaming:
    def test_generate_continue_streams_content(self, ai_client, scene_with_content):
        r = ai_client.post("/api/ai/generate", json={
            "scene_id": scene_with_content["id"],
            "mode": "continue",
            "model": AI_MODEL,
        }, timeout=120)
        assert r.status_code == 200
        assert "text/event-stream" in r.headers.get("content-type", "")
        content = _collect_sse_content(r)
        assert len(content) > 0, "Expected at least some generated text in SSE stream"

    def test_generate_custom_mode_with_prompt(self, ai_client, scene_with_content):
        r = ai_client.post("/api/ai/generate", json={
            "scene_id": scene_with_content["id"],
            "mode": "custom",
            "custom_prompt": "Describe the setting in one sentence.",
            "model": AI_MODEL,
        }, timeout=120)
        assert r.status_code == 200
        content = _collect_sse_content(r)
        assert len(content) > 0


@pytest.mark.live
class TestAIChatStreaming:
    def test_chat_responds_to_question(self, ai_client, scene_with_content):
        r = ai_client.post("/api/ai/chat", json={
            "scene_id": scene_with_content["id"],
            "messages": [{"role": "user", "content": "Who are the characters in this scene?"}],
            "model": AI_MODEL,
        }, timeout=120)
        assert r.status_code == 200
        assert "text/event-stream" in r.headers.get("content-type", "")
        content = _collect_sse_content(r)
        assert len(content) > 0


@pytest.mark.live
class TestAIKiStreaming:
    def test_ki_generates_continuation(self, ai_client, scene_with_content):
        r = ai_client.post("/api/ai/ki", json={
            "scene_id": scene_with_content["id"],
            "prompt": "Write the next paragraph.",
            "model": AI_MODEL,
        }, timeout=120)
        assert r.status_code == 200
        content = _collect_sse_content(r)
        assert len(content) > 0

    def test_ki_with_codex_ids_empty_list(self, ai_client, scene_with_content):
        """Empty codex_ids / extra_scene_ids must be accepted (valid input)."""
        r = ai_client.post("/api/ai/ki", json={
            "scene_id": scene_with_content["id"],
            "prompt": "Continue the story.",
            "codex_ids": [],
            "extra_scene_ids": [],
            "model": AI_MODEL,
        }, timeout=120)
        # 200 + SSE content-type is the success contract; content may be empty
        # on free-tier rate limits — that is a network condition, not a code bug.
        assert r.status_code == 200
        assert "text/event-stream" in r.headers.get("content-type", "")
