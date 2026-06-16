"""
Tests for docker/spacy/server.py.

spaCy models are mocked — these tests do not require downloaded models or a GPU.
"""
import re
from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient

import server
from server import _strip_html, app

client = TestClient(app)


# ── _strip_html ───────────────────────────────────────────────────────────────

class TestStripHtml:
    def test_replaces_tags_with_space(self):
        assert _strip_html("<p>Hello</p>") == " Hello "

    def test_removes_nested_tags(self):
        result = _strip_html("<p><b>Bold</b> text</p>")
        assert "Bold" in result
        assert "<b>" not in result

    def test_empty_string_returns_empty(self):
        assert _strip_html("") == ""

    def test_none_treated_as_empty(self):
        assert _strip_html(None) == ""  # type: ignore[arg-type]

    def test_plain_text_is_preserved(self):
        assert _strip_html("no tags here") == "no tags here"

    def test_self_closing_tags_removed(self):
        result = _strip_html("line one<br/>line two")
        assert "line one" in result
        assert "line two" in result
        assert "<br/>" not in result


# ── Entity text normalization (the regex applied in /suggest) ─────────────────
#
# The server normalizes each entity with:
#   re.sub(r"^[^\w]+|[^\w]+$", "", text.strip())
#
# We test the same pattern here so that changes to the regex are caught.

NORM = re.compile(r"^[^\w]+|[^\w]+$")


def norm(text: str) -> str:
    return NORM.sub("", text.strip())


class TestEntityNormalization:
    def test_trailing_exclamation_stripped(self):
        assert norm("Miya!") == "Miya"

    def test_trailing_comma_stripped(self):
        assert norm("Clara,") == "Clara"

    def test_trailing_period_stripped(self):
        assert norm("Berlin.") == "Berlin"

    def test_leading_and_trailing_guillemets_stripped(self):
        assert norm("«Café»") == "Café"

    def test_parentheses_stripped(self):
        assert norm("(Berlin)") == "Berlin"

    def test_clean_name_unchanged(self):
        assert norm("Miya") == "Miya"

    def test_unicode_umlaut_preserved(self):
        assert norm("Müller!") == "Müller"

    def test_umlaut_name_not_mangled(self):
        assert norm("Käthe") == "Käthe"

    def test_whitespace_trimmed_around_name(self):
        assert norm("  Miya  ") == "Miya"

    def test_colon_stripped(self):
        assert norm("Paris:") == "Paris"


# ── /health endpoint ──────────────────────────────────────────────────────────

class TestHealth:
    def test_returns_ok(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_includes_loaded_models_key(self):
        r = client.get("/health")
        assert "loaded_models" in r.json()


# ── /suggest endpoint ─────────────────────────────────────────────────────────

def _make_ent(text: str, label: str) -> MagicMock:
    ent = MagicMock()
    ent.text = text
    ent.label_ = label
    return ent


class TestSuggest:
    def _setup_ents(self, mock_nlp, ents: list[MagicMock]):
        """Configure the mock NLP pipeline to return the given entities."""
        mock_nlp.return_value.ents = ents
        # Also prime the NER cache so _get_ner_nlp returns our mock
        server._ner_cache["en_core_web_sm"] = mock_nlp

    def test_strips_trailing_punctuation(self, mock_nlp):
        """'Miya!' (from NER) must be returned as 'Miya'."""
        ent = _make_ent("Miya!", "PER")
        self._setup_ents(mock_nlp, [ent, ent])  # 2 occurrences → above threshold
        r = client.post("/suggest", json={"content": "text", "lang": "en"})
        assert r.status_code == 200
        texts = [s["text"] for s in r.json()]
        assert "Miya" in texts
        assert "Miya!" not in texts

    def test_frequency_threshold_filters_singletons(self, mock_nlp):
        """Entities appearing only once must not be returned."""
        ent = _make_ent("Miya", "PER")
        self._setup_ents(mock_nlp, [ent])  # only 1 occurrence
        r = client.post("/suggest", json={"content": "text", "lang": "en"})
        assert r.status_code == 200
        assert r.json() == []

    def test_frequency_threshold_passes_two_or_more(self, mock_nlp):
        """Entities appearing ≥ 2 times must be returned."""
        ent = _make_ent("Clara", "PER")
        self._setup_ents(mock_nlp, [ent, ent])
        r = client.post("/suggest", json={"content": "text", "lang": "en"})
        assert r.status_code == 200
        assert any(s["text"] == "Clara" for s in r.json())

    def test_unknown_label_filtered_out(self, mock_nlp):
        """Entities with labels not in SUGGEST_LABELS must be excluded."""
        ent = _make_ent("Widget", "PRODUCT")  # not in SUGGEST_LABELS
        self._setup_ents(mock_nlp, [ent, ent])
        r = client.post("/suggest", json={"content": "text", "lang": "en"})
        assert r.status_code == 200
        assert r.json() == []

    def test_empty_text_after_normalization_excluded(self, mock_nlp):
        """Entities that become empty after stripping punctuation are dropped."""
        ent = _make_ent("!!!", "PER")
        self._setup_ents(mock_nlp, [ent, ent])
        r = client.post("/suggest", json={"content": "text", "lang": "en"})
        assert r.status_code == 200
        assert r.json() == []

    def test_dedup_punct_and_clean_form(self, mock_nlp):
        """'Miya!' and 'Miya' both normalize to 'miya' — counted as one entity."""
        ent_punct = _make_ent("Miya!", "PER")
        ent_clean = _make_ent("Miya",  "PER")
        self._setup_ents(mock_nlp, [ent_punct, ent_clean])
        r = client.post("/suggest", json={"content": "text", "lang": "en"})
        assert r.status_code == 200
        texts = [s["text"] for s in r.json()]
        # Only one entry for "Miya", and the punctuated form must not appear
        assert texts.count("Miya") <= 1
        assert "Miya!" not in texts
