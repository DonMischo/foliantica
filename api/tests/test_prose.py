"""
Tests for api/routers/prose.py — prose style analysis.

Focus: _strip_html preserves line structure, _dialog_ratio detects dialog,
and the full /api/prose/check endpoint returns sane metrics.
"""

import pytest

from routers.prose import _strip_html, _dialog_ratio, _adverb_density, _sentence_variety


# ── _strip_html ───────────────────────────────────────────────────────────────

class TestStripHtml:
    def test_plain_text_unchanged(self):
        assert _strip_html("Hello world") == "Hello world"

    def test_inline_tags_removed(self):
        assert _strip_html("<strong>bold</strong>") == "bold"

    def test_paragraph_tags_become_newlines(self):
        html = "<p>First paragraph.</p><p>Second paragraph.</p>"
        result = _strip_html(html)
        lines = [l for l in result.split("\n") if l.strip()]
        assert len(lines) == 2
        assert "First paragraph." in lines[0]
        assert "Second paragraph." in lines[1]

    def test_br_becomes_newline(self):
        result = _strip_html("Line one<br>Line two")
        assert "\n" in result

    def test_empty_returns_empty(self):
        assert _strip_html("") == ""
        assert _strip_html(None) == ""  # type: ignore

    def test_tiptap_dialog_html(self):
        """Simulate TipTap output: each paragraph in its own <p> tag."""
        html = (
            '<p>Clara sammelte die Funde.</p>'
            '<p>"Morgen gehe ich zu einem anderen Ankaeufer," erklaerte sie stolz.</p>'
            '<p>"Na klar," sagte Miya.</p>'
        )
        result = _strip_html(html)
        lines = [l for l in result.split("\n") if l.strip()]
        assert len(lines) == 3
        assert lines[1].startswith('"')
        assert lines[2].startswith('"')


# ── _dialog_ratio ─────────────────────────────────────────────────────────────

class TestDialogRatio:
    def test_no_dialog(self):
        text = "Clara sammelte die Funde.\nSie sortierte alles sorgfaeltig."
        r = _dialog_ratio(text)
        assert r["ratio"] == 0.0
        assert r["dialog_lines"] == 0

    def test_straight_double_quote(self):
        text = 'Clara ging.\n"Morgen komme ich wieder," sagte sie.'
        r = _dialog_ratio(text)
        assert r["dialog_lines"] == 1
        assert r["ratio"] > 0

    def test_german_low9_open_quote(self):
        # U+201E „ is the standard German opening double quote
        text = "Clara ging.\n„Morgen komme ich wieder,“ sagte sie."
        r = _dialog_ratio(text)
        assert r["dialog_lines"] == 1, f"Expected 1 dialog line, got {r}"

    def test_left_double_quotation_mark(self):
        # U+201C " — common in copy-pasted English text
        text = "Narration.\n“Hello,” she said."
        r = _dialog_ratio(text)
        assert r["dialog_lines"] == 1

    def test_french_guillemets(self):
        text = "Narration.\n«Bonjour,» dit-elle."
        r = _dialog_ratio(text)
        assert r["dialog_lines"] == 1

    def test_em_dash_dialog(self):
        text = "Narration.\n—Hallo, sagte er."
        r = _dialog_ratio(text)
        assert r["dialog_lines"] == 1

    def test_multiple_dialog_lines(self):
        text = (
            'Clara sammelte die Funde.\n'
            '"Morgen gehe ich zu einem anderen Ankaeufer," erklaerte sie.\n'
            '"Na klar," sagte Miya.\n'
            'Die Nacht war ruhig.\n'
            '"Gute Nacht," flisterte Lena.'
        )
        r = _dialog_ratio(text)
        assert r["dialog_lines"] == 3
        assert r["total_lines"] == 5
        assert abs(r["ratio"] - 0.6) < 0.01

    def test_html_input_via_strip(self):
        """End-to-end: HTML as sent by TipTap should yield correct dialog count."""
        html = (
            '<p>Clara sammelte die Funde.</p>'
            '<p>"Morgen gehe ich zu einem anderen Ankaeufer," erklaerte sie stolz.</p>'
            '<p>"Na klar," sagte Miya.</p>'
            '<p>Die Nacht war ruhig.</p>'
        )
        from routers.prose import _strip_html
        plain = _strip_html(html)
        r = _dialog_ratio(plain)
        assert r["dialog_lines"] == 2, f"Got {r}"
        assert r["total_lines"] == 4


# ── /api/prose/check endpoint ─────────────────────────────────────────────────

SAMPLE_HTML = (
    "<p>Clara sammelte die Funde der Kinder ein.</p>"
    "<p>\"Morgen gehe ich zu einem anderen Ankaeufer,\" erklaerte sie stolz.</p>"
    "<p>\"Na klar,\" sagte Miya.</p>"
    "<p>Die Nacht umhuellte Kazmireth.</p>"
)


class TestProseEndpoint:
    def test_basic_response_shape(self, client):
        r = client.post("/api/prose/check", json={"text": SAMPLE_HTML, "language": "de"})
        assert r.status_code == 200
        data = r.json()
        assert "word_count" in data
        assert "sentence_variety" in data
        assert "auxiliary_density" in data
        assert "adverb_density" in data
        assert "dialog" in data

    def test_dialog_detected_in_html(self, client):
        r = client.post("/api/prose/check", json={"text": SAMPLE_HTML, "language": "de"})
        assert r.status_code == 200
        dialog = r.json()["dialog"]
        assert dialog["dialog_lines"] == 2, f"Expected 2 dialog lines, got {dialog}"
        assert dialog["total_lines"] == 4

    def test_empty_text(self, client):
        r = client.post("/api/prose/check", json={"text": "", "language": "en"})
        assert r.status_code == 200
        data = r.json()
        assert data["word_count"] == 0
        assert data["dialog"]["ratio"] == 0.0

    def test_language_defaults_to_en(self, client):
        r = client.post("/api/prose/check", json={"text": "<p>Hello world.</p>"})
        assert r.status_code == 200
        assert r.json()["language"] == "en"

    def test_word_count_ignores_tags(self, client):
        r = client.post("/api/prose/check", json={"text": "<p>one two three</p>", "language": "en"})
        assert r.json()["word_count"] == 3
