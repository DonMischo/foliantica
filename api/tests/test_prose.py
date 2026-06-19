"""
Tests for api/routers/prose.py — prose style analysis.

Covers every step in the pipeline:
  1. _strip_html — HTML → plain text with preserved line structure
  2. _dialog_ratio — counting dialog lines in plain text
  3. Frontend stripping bug — scene page was collapsing <p> to spaces
  4. /api/prose/check endpoint — full round-trip with real HTTP client
"""

import pytest
import re

from routers.prose import _strip_html, _dialog_ratio, _adverb_density, _sentence_variety


# ── helpers ────────────────────────────────────────────────────────────────────

def frontend_strip(html: str) -> str:
    """Reproduce the original scene-page stripping that caused the bug.

    The page used:
        content.replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim()

    This collapses ALL tags (including <p>) to spaces, losing every
    paragraph boundary and producing one long single line.
    """
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def fixed_frontend_strip(html: str) -> str:
    """The corrected stripping used by the scene page after the fix.

    Block-level tags become \\n so paragraph boundaries are preserved,
    then inline tags are removed.
    """
    text = re.sub(r"</?(p|div|br|li|h[1-6]|blockquote|hr)[^>]*>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


# ── realistic scene fixture ───────────────────────────────────────────────────

# Mirrors the actual TipTap HTML for the scene the user tested with.
SCENE_HTML = (
    "<p>Clara sammelte die Funde der Kinder ein. "
    "Sie sortierte alles sorgfaeltig in eine abgenutzte Ledertasche.</p>"
    '<p>"Morgen gehe ich zu einem anderen Ankaeufer," erklaerte sie stolz. '
    '"Thomas kennt einen Laden, der faire Preise zahlt."</p>'
    '<p>"Na klar. Und falls der auch ein Lustmolch ist..." '
    "Liess sie im Raum stehen.</p>"
    "<p>Miss Halwick hatte in der Zwischenzeit das Abendessen vorbereitet.</p>"
    "<p>Nach dem Essen huschten die Juengeren die knarrende Treppe hinauf.</p>"
    '<p>"So," sagte Miya und zog die duenne Decke ueber Lenas Schultern.</p>'
    '<p>"Musst du nochmal weg?" fragte Lena.</p>'
    '<p>"Ja." Miya strich eine verirrte Haarstraehne aus Lenas Gesicht.</p>'
    "<p>Der Weg zum Glockenturm fuehrte Miya durch enge Gassen.</p>"
    '<p>"So?" Seine Augen fixierten sie erwartungsvoll.</p>'
)

# How many of the above paragraphs start with a dialog opener
SCENE_DIALOG_LINES = 6   # paragraphs starting with ": indices 1,2,5,6,7,9
SCENE_TOTAL_LINES  = 10


# ── Step 1: _strip_html preserves line structure ──────────────────────────────

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

    def test_div_becomes_newline(self):
        result = _strip_html("<div>A</div><div>B</div>")
        lines = [l for l in result.split("\n") if l.strip()]
        assert len(lines) == 2

    def test_empty_input(self):
        assert _strip_html("") == ""
        assert _strip_html(None) == ""  # type: ignore

    def test_scene_html_produces_correct_line_count(self):
        plain = _strip_html(SCENE_HTML)
        lines = [l for l in plain.split("\n") if l.strip()]
        assert len(lines) == SCENE_TOTAL_LINES, (
            f"Expected {SCENE_TOTAL_LINES} lines, got {len(lines)}: {lines}"
        )

    def test_scene_html_dialog_lines_start_with_quote(self):
        plain = _strip_html(SCENE_HTML)
        lines = [l for l in plain.split("\n") if l.strip()]
        dialog = [l for l in lines if l[0] == '"']
        assert len(dialog) == SCENE_DIALOG_LINES, (
            f"Expected {SCENE_DIALOG_LINES} dialog lines, got {len(dialog)}"
        )


# ── Step 2: frontend stripping — old vs new ───────────────────────────────────

class TestFrontendStripping:
    """Document the exact bug: old stripping collapses all paragraphs to one line."""

    def test_old_stripping_collapses_to_one_line(self):
        """BUG: original scene-page regex replaces <p> with space → single line."""
        stripped = frontend_strip(SCENE_HTML)
        lines = [l for l in stripped.split("\n") if l.strip()]
        assert len(lines) == 1, (
            f"Old stripping should produce 1 line (all collapsed), got {len(lines)}"
        )

    def test_old_stripping_loses_dialog_structure(self):
        """BUG: single-line text means _dialog_ratio sees no dialog."""
        stripped = frontend_strip(SCENE_HTML)
        r = _dialog_ratio(stripped)
        assert r["dialog_lines"] == 0, (
            f"Old stripping should yield 0 dialog lines (all on one line), got {r}"
        )

    def test_fixed_stripping_preserves_lines(self):
        """FIX: block-level tags become newlines, paragraph structure survives."""
        stripped = fixed_frontend_strip(SCENE_HTML)
        lines = [l for l in stripped.split("\n") if l.strip()]
        assert len(lines) == SCENE_TOTAL_LINES, (
            f"Fixed stripping should produce {SCENE_TOTAL_LINES} lines, got {len(lines)}"
        )

    def test_fixed_stripping_dialog_detected(self):
        """FIX: with paragraph structure preserved, dialog is counted correctly."""
        stripped = fixed_frontend_strip(SCENE_HTML)
        r = _dialog_ratio(stripped)
        assert r["dialog_lines"] == SCENE_DIALOG_LINES, (
            f"Expected {SCENE_DIALOG_LINES} dialog lines after fix, got {r}"
        )


# ── Step 3: _dialog_ratio with various quote styles ───────────────────────────

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

    def test_german_low9_open_quote(self):
        # U+201E " — standard German opening quote
        text = "Clara ging.\n" + chr(0x201E) + "Morgen komme ich wieder," + chr(0x201D) + " sagte sie."
        r = _dialog_ratio(text)
        assert r["dialog_lines"] == 1, f"U+201E not detected: {r}"

    def test_left_double_quotation_mark(self):
        # U+201C " — common in English copy-paste
        text = "Narration.\n" + chr(0x201C) + "Hello," + chr(0x201D) + " she said."
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

    def test_ratio_calculation(self):
        text = (
            "Clara sammelte die Funde.\n"
            '"Morgen gehe ich zu einem anderen Ankaeufer," erklaerte sie.\n'
            '"Na klar," sagte Miya.\n'
            "Die Nacht war ruhig.\n"
            '"Gute Nacht," flisterte Lena.'
        )
        r = _dialog_ratio(text)
        assert r["dialog_lines"] == 3
        assert r["total_lines"] == 5
        assert abs(r["ratio"] - 0.6) < 0.01


# ── Step 4: full endpoint round-trip ─────────────────────────────────────────

class TestProseEndpoint:
    def test_response_shape(self, client):
        r = client.post("/api/prose/check", json={"text": SCENE_HTML, "language": "de"})
        assert r.status_code == 200
        data = r.json()
        for key in ("word_count", "sentence_count", "paragraph_count",
                    "sentence_variety", "auxiliary_density", "adverb_density", "dialog"):
            assert key in data, f"Missing key: {key}"

    def test_dialog_detected_in_html(self, client):
        r = client.post("/api/prose/check", json={"text": SCENE_HTML, "language": "de"})
        assert r.status_code == 200
        d = r.json()["dialog"]
        assert d["total_lines"] == SCENE_TOTAL_LINES, f"total_lines wrong: {d}"
        assert d["dialog_lines"] == SCENE_DIALOG_LINES, f"dialog_lines wrong: {d}"
        assert d["ratio"] > 0, "ratio should be > 0"

    def test_dialog_zero_when_no_quotes(self, client):
        html = "<p>Narration only.</p><p>Still narration.</p><p>More narration.</p>"
        r = client.post("/api/prose/check", json={"text": html, "language": "en"})
        assert r.json()["dialog"]["dialog_lines"] == 0

    def test_word_count_ignores_tags(self, client):
        r = client.post("/api/prose/check", json={"text": "<p>one two three</p>", "language": "en"})
        assert r.json()["word_count"] == 3

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

    def test_plain_text_input_also_works(self, client):
        """Backend should handle pre-stripped plain text too (no tags)."""
        text = 'Clara ging.\n"Morgen komme ich wieder," sagte sie.\n"Na klar."'
        r = client.post("/api/prose/check", json={"text": text, "language": "de"})
        assert r.status_code == 200
        assert r.json()["dialog"]["dialog_lines"] == 2
