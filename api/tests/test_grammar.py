"""
Tests for api/routers/grammar.py.

  - TestGrammarDisabled  — 503 when grammar is not enabled in settings
  - TestGrammarCheck     — POST /api/grammar/check (happy path + error paths)
  - TestGrammarLanguages — GET /api/grammar/languages
  - TestGrammarLive      — @pytest.mark.live: real LanguageTool container at localhost:8081
"""
import respx
import httpx
import pytest


LT_URL = "http://lt-test:8081"


def _enable_grammar(client, url=LT_URL):
    r = client.post("/api/settings", json={
        "grammar_check_enabled": True,
        "grammar_check_url": url,
    })
    assert r.status_code == 200


# ── Grammar disabled ──────────────────────────────────────────────────────────

class TestGrammarDisabled:
    def test_check_returns_503_when_disabled(self, client):
        # No settings seeded → grammar_check_enabled defaults to False
        r = client.post("/api/grammar/check", json={"text": "Hello", "language": "en-US"})
        assert r.status_code == 503

    def test_languages_returns_503_when_disabled(self, client):
        r = client.get("/api/grammar/languages")
        assert r.status_code == 503


# ── POST /api/grammar/check ───────────────────────────────────────────────────

class TestGrammarCheck:
    def test_happy_path_proxies_lt_response(self, client):
        _enable_grammar(client)
        mock_body = {"matches": [{"message": "Possible typo", "offset": 0, "length": 5}]}
        with respx.mock:
            respx.post(f"{LT_URL}/v2/check").mock(
                return_value=httpx.Response(200, json=mock_body)
            )
            r = client.post("/api/grammar/check", json={"text": "Helo world", "language": "en-US"})
        assert r.status_code == 200
        assert r.json()["matches"][0]["message"] == "Possible typo"

    def test_empty_matches_returned(self, client):
        _enable_grammar(client)
        with respx.mock:
            respx.post(f"{LT_URL}/v2/check").mock(
                return_value=httpx.Response(200, json={"matches": []})
            )
            r = client.post("/api/grammar/check", json={"text": "Perfect sentence.", "language": "en-US"})
        assert r.status_code == 200
        assert r.json()["matches"] == []

    def test_connect_error_returns_503(self, client):
        _enable_grammar(client)
        with respx.mock:
            respx.post(f"{LT_URL}/v2/check").mock(side_effect=httpx.ConnectError("refused"))
            r = client.post("/api/grammar/check", json={"text": "Test", "language": "auto"})
        assert r.status_code == 503

    def test_read_timeout_returns_503(self, client):
        _enable_grammar(client)
        with respx.mock:
            respx.post(f"{LT_URL}/v2/check").mock(side_effect=httpx.ReadTimeout("timed out"))
            r = client.post("/api/grammar/check", json={"text": "Test", "language": "auto"})
        assert r.status_code == 503

    def test_languagetool_5xx_returns_502(self, client):
        _enable_grammar(client)
        with respx.mock:
            # raise_for_status() on a 500 response → HTTPStatusError → 502
            respx.post(f"{LT_URL}/v2/check").mock(
                return_value=httpx.Response(500, text="Internal Server Error")
            )
            r = client.post("/api/grammar/check", json={"text": "Test", "language": "auto"})
        assert r.status_code == 502


# ── GET /api/grammar/languages ────────────────────────────────────────────────

class TestGrammarLanguages:
    def test_happy_path_proxies_language_list(self, client):
        _enable_grammar(client)
        lang_list = [{"name": "English", "code": "en-US"}, {"name": "German", "code": "de-DE"}]
        with respx.mock:
            respx.get(f"{LT_URL}/v2/languages").mock(
                return_value=httpx.Response(200, json=lang_list)
            )
            r = client.get("/api/grammar/languages")
        assert r.status_code == 200
        codes = [entry["code"] for entry in r.json()]
        assert "en-US" in codes
        assert "de-DE" in codes

    def test_connect_error_returns_503(self, client):
        _enable_grammar(client)
        with respx.mock:
            respx.get(f"{LT_URL}/v2/languages").mock(side_effect=httpx.ConnectError("refused"))
            r = client.get("/api/grammar/languages")
        assert r.status_code == 503


# ── Live tests: real LanguageTool container ───────────────────────────────────

LT_LIVE_URL = "http://localhost:8081"


@pytest.fixture
def languagetool_running():
    """Skip only if LanguageTool is not reachable at all.
    ReadTimeout means the container is up but still loading ngram models — proceed."""
    try:
        with httpx.Client(timeout=5.0) as c:
            c.get(f"{LT_LIVE_URL}/v2/languages")
    except (httpx.ConnectError, httpx.ConnectTimeout):
        pytest.skip("LanguageTool container not reachable at localhost:8081 — start it first")


@pytest.mark.live
class TestGrammarLive:
    def test_check_detects_grammar_error(self, client, languagetool_running):
        client.post("/api/settings", json={
            "grammar_check_enabled": True,
            "grammar_check_url": LT_LIVE_URL,
        })
        # "She don't like it." has a subject–verb agreement error
        r = client.post("/api/grammar/check", json={
            "text": "She don't like it.",
            "language": "en-US",
        })
        assert r.status_code == 200
        assert len(r.json()["matches"]) > 0

    def test_check_clean_text_has_no_matches(self, client, languagetool_running):
        client.post("/api/settings", json={
            "grammar_check_enabled": True,
            "grammar_check_url": LT_LIVE_URL,
        })
        r = client.post("/api/grammar/check", json={
            "text": "The quick brown fox jumps over the lazy dog.",
            "language": "en-US",
        })
        assert r.status_code == 200
        # A grammatically correct sentence must produce zero matches
        assert r.json()["matches"] == []

    def test_list_languages_returns_english(self, client, languagetool_running):
        client.post("/api/settings", json={
            "grammar_check_enabled": True,
            "grammar_check_url": LT_LIVE_URL,
        })
        r = client.get("/api/grammar/languages")
        assert r.status_code == 200
        langs = r.json()
        assert isinstance(langs, list)
        assert len(langs) > 0
        # At minimum English should be present
        assert any("en" in str(lang) for lang in langs)
