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

from routers.prose import (
    _strip_html, _dialog_ratio, _adverb_density, _sentence_variety, _auxiliary_density,
    _split_sentences, _stddev, _first_word, _split_words,
)


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


# ── _sentence_variety ─────────────────────────────────────────────────────────

class TestSentenceVariety:
    def test_empty_returns_n_a(self):
        r = _sentence_variety([])
        assert r["variety"] == "n/a"
        assert r["avg_length"] == 0.0
        assert r["repetitive_starts"] == []

    def test_single_sentence_low_variety(self):
        r = _sentence_variety(["Hello world this is one sentence."])
        assert r["variety"] == "low"
        assert r["length_stddev"] == 0.0

    def test_uniform_lengths_produce_low_variety(self):
        # All sentences exactly 5 words — stddev = 0, CV = 0 → "low"
        sentences = ["one two three four five."] * 10
        r = _sentence_variety(sentences)
        assert r["variety"] == "low"
        assert r["length_stddev"] == 0.0

    def test_high_variance_produces_good_variety(self):
        # Mix very short and very long sentences → high CV
        sentences = ["Yes."] * 5 + ["This is a much longer sentence with many words in it."] * 5
        r = _sentence_variety(sentences)
        assert r["variety"] == "good"

    def test_moderate_variety(self):
        # Sentences with moderate length differences
        sentences = [
            "Short sentence here.",        # 3 words
            "A bit longer sentence here.", # 5 words
            "Another medium one here.",    # 4 words
            "Slightly longer sentence.",   # 3 words
            "Yet another one of medium length.",  # 7 words
        ]
        r = _sentence_variety(sentences)
        assert r["variety"] in ("moderate", "good")

    def test_repetitive_starts_detected_at_three(self):
        sentences = [
            "She walked to the door.",
            "She opened it slowly.",
            "She stepped outside.",
            "She looked at the sky.",
        ]
        r = _sentence_variety(sentences)
        assert len(r["repetitive_starts"]) == 1
        assert r["repetitive_starts"][0]["word"] == "she"
        assert r["repetitive_starts"][0]["count"] == 4

    def test_repetitive_starts_not_triggered_at_two(self):
        sentences = [
            "She walked to the door.",
            "She opened it.",
            "Then she left.",
        ]
        r = _sentence_variety(sentences)
        assert r["repetitive_starts"] == []

    def test_repetitive_starts_multiple_runs(self):
        sentences = (
            ["He went there."] * 3 +
            ["She watched."] +
            ["Then came the morning."] * 3
        )
        r = _sentence_variety(sentences)
        words = {d["word"] for d in r["repetitive_starts"]}
        assert "he" in words
        assert "then" in words

    def test_avg_length_correct(self):
        sentences = ["one two.", "three four five six."]  # 2 + 4 = 6, avg = 3.0
        r = _sentence_variety(sentences)
        assert r["avg_length"] == 3.0


# ── _adverb_density ───────────────────────────────────────────────────────────

class TestAdverbDensity:
    def test_empty_word_list_returns_ok(self):
        r = _adverb_density([], "en")
        assert r["count"] == 0
        assert r["ratio"] == 0.0
        assert r["level"] == "ok"

    def test_english_ly_suffix_detected(self):
        words = ["quickly", "slowly", "ran", "the", "dog"]
        r = _adverb_density(words, "en")
        assert r["count"] == 2
        assert r["level"] == "high"  # 2/5 = 40% ratio > 8% threshold → high

    def test_english_high_density(self):
        # 8/10 = 0.8 → "high"
        words = ["quickly", "slowly", "rapidly", "gently", "softly", "roughly",
                 "kindly", "deeply", "ran", "dog"]
        r = _adverb_density(words, "en")
        assert r["level"] == "high"

    def test_english_elevated_density(self):
        # ~6% → "elevated"
        words = ["quickly"] + ["word"] * 19   # 1/20 = 0.05 → elevated
        r = _adverb_density(words, "en")
        assert r["level"] == "elevated"

    def test_german_weise_suffix_detected(self):
        words = ["normalerweise", "größtenteils", "lief", "er", "schnell"]
        r = _adverb_density(words, "de")
        assert r["count"] >= 1

    def test_german_ig_min_length_enforced(self):
        # "ig" requires len >= 7; "wenig" is only 5 chars → no match
        words = ["wenig", "lustig"]   # lustig = 6 chars, still < 7
        r = _adverb_density(words, "de")
        assert r["count"] == 0

    def test_german_ig_long_enough(self):
        # "sorgfältig" (10 chars) should match -ig suffix
        words = ["sorgfältig", "lustiger"]
        r = _adverb_density(words, "de")
        assert r["count"] >= 1

    def test_unknown_language_falls_back_to_english(self):
        words = ["quickly", "slowly", "word"]
        r_en = _adverb_density(words, "en")
        r_xx = _adverb_density(words, "xx")
        assert r_en["count"] == r_xx["count"]

    def test_ratio_rounded_to_three_decimals(self):
        words = ["quickly"] + ["word"] * 9   # 1/10
        r = _adverb_density(words, "en")
        assert r["ratio"] == 0.1


# ── _auxiliary_density ────────────────────────────────────────────────────────

class TestAuxiliaryDensity:
    def test_short_paragraphs_skipped(self):
        # < 20 words → ignored
        short = "She was here."
        r = _auxiliary_density([short], "en")
        assert r["flagged_paragraphs"] == []

    def test_english_high_auxiliary_density(self):
        # Build a 20+ word paragraph with many auxiliaries
        aux_words = "was were had been would could should "
        filler = "the great old story about an interesting place "
        para = (aux_words * 3 + filler * 2).strip()
        r = _auxiliary_density([para], "en")
        assert len(r["flagged_paragraphs"]) == 1
        assert r["flagged_paragraphs"][0]["level"] in ("elevated", "high")

    def test_clean_paragraph_not_flagged(self):
        para = "Clara walked to the market. She bought fresh bread and vegetables. " \
               "The morning sun shone brightly over the cobblestone street. " \
               "Children played near the fountain as the vendors called out their wares."
        r = _auxiliary_density([para], "en")
        assert r["flagged_paragraphs"] == []

    def test_german_auxiliaries_detected(self):
        # German auxiliaries: war, waren, wurde, wurden, hätte, etc.
        aux_words = "war waren wurde wurden hätte hätten würde "
        filler = "die große alte Geschichte über einen interessanten Ort "
        para = (aux_words * 3 + filler * 2).strip()
        r = _auxiliary_density([para], "de")
        assert len(r["flagged_paragraphs"]) == 1

    def test_flagged_paragraph_has_required_fields(self):
        aux_words = "was were had been would could should "
        filler = "the story about an interesting wonderful place in the world "
        para = (aux_words * 3 + filler * 2).strip()
        r = _auxiliary_density([para], "en")
        if r["flagged_paragraphs"]:
            p = r["flagged_paragraphs"][0]
            assert "paragraph" in p
            assert "auxiliary_count" in p
            assert "word_count" in p
            assert "ratio" in p
            assert "level" in p
            assert p["level"] in ("elevated", "high")

    def test_high_vs_elevated_threshold(self):
        # >= 0.16 → "high", 0.10–0.15 → "elevated"
        # Construct a paragraph where ~16% are auxiliaries
        base = ["was"] * 16 + ["word"] * 84  # 16/100 = 0.16 → "high"
        para_high = " ".join(base)
        r_high = _auxiliary_density([para_high], "en")
        assert r_high["flagged_paragraphs"][0]["level"] == "high"

        base2 = ["was"] * 11 + ["word"] * 89  # 11/100 = 0.11 → "elevated"
        para_elev = " ".join(base2)
        r_elev = _auxiliary_density([para_elev], "en")
        assert r_elev["flagged_paragraphs"][0]["level"] == "elevated"

    def test_multiple_paragraphs_flagged_independently(self):
        clean = "Clara walked to the market and bought fresh bread for the morning meal."
        aux = ("was were had been would could should " * 3 +
               "the story about an interesting place in the world ")
        r = _auxiliary_density([clean, aux.strip()], "en")
        flagged = {p["paragraph"] for p in r["flagged_paragraphs"]}
        assert 0 not in flagged   # clean paragraph not flagged
        assert 1 in flagged       # aux-heavy paragraph flagged

    def test_unknown_language_falls_back_to_english(self):
        aux_words = "was were had been would could should "
        filler = "the story about an interesting place in the world "
        para = (aux_words * 3 + filler * 2).strip()
        r_en = _auxiliary_density([para], "en")
        r_xx = _auxiliary_density([para], "xx")
        assert r_en == r_xx


# ── _split_sentences ──────────────────────────────────────────────────────────

class TestSplitSentences:
    def test_splits_on_period_space(self):
        r = _split_sentences("Hello world. How are you? Fine!")
        assert r == ["Hello world.", "How are you?", "Fine!"]

    def test_question_mark_splits(self):
        r = _split_sentences("Is it raining? Yes it is.")
        assert len(r) == 2

    def test_exclamation_splits(self):
        r = _split_sentences("Run! Do not look back.")
        assert len(r) == 2

    def test_ellipsis_splits(self):
        r = _split_sentences("She waited… Then she left.")
        assert len(r) == 2

    def test_no_trailing_empty(self):
        r = _split_sentences("One sentence.")
        assert r == ["One sentence."]
        assert all(s for s in r)

    def test_empty_string_returns_empty_list(self):
        assert _split_sentences("") == []

    def test_whitespace_only_returns_empty_list(self):
        assert _split_sentences("   ") == []

    def test_no_split_without_trailing_space(self):
        # "End.Next" — no space after period → stays as one token
        r = _split_sentences("End.Next sentence.")
        assert len(r) == 1

    def test_multiple_spaces_ok(self):
        r = _split_sentences("First.  Second sentence.")
        assert len(r) == 2
        assert r[0] == "First."
        assert r[1] == "Second sentence."

    def test_strips_whitespace_from_each_sentence(self):
        r = _split_sentences("  Trimmed.  Also trimmed.  ")
        assert all(s == s.strip() for s in r)


# ── _stddev ───────────────────────────────────────────────────────────────────

class TestStddev:
    def test_empty_list_returns_zero(self):
        assert _stddev([]) == 0.0

    def test_single_value_returns_zero(self):
        assert _stddev([42.0]) == 0.0

    def test_identical_values_returns_zero(self):
        assert _stddev([5.0, 5.0, 5.0]) == 0.0

    def test_known_stddev(self):
        # [2, 4, 4, 4, 5, 5, 7, 9] → population stddev = 2.0
        result = _stddev([2, 4, 4, 4, 5, 5, 7, 9])
        assert abs(result - 2.0) < 0.001

    def test_two_values(self):
        # [0, 10] → mean=5, variance=((5^2 + 5^2)/2)=25, stddev=5
        assert abs(_stddev([0.0, 10.0]) - 5.0) < 0.001

    def test_returns_float(self):
        assert isinstance(_stddev([1, 2, 3]), float)


# ── _first_word ───────────────────────────────────────────────────────────────

class TestFirstWord:
    def test_simple_sentence(self):
        assert _first_word("Hello world") == "hello"

    def test_leading_punctuation_skipped(self):
        assert _first_word('"Said she.') == "said"

    def test_em_dash_prefix_skipped(self):
        assert _first_word("—Hallo, sagte er.") == "hallo"

    def test_empty_string_returns_empty(self):
        assert _first_word("") == ""

    def test_whitespace_only_returns_empty(self):
        assert _first_word("   ") == ""

    def test_lowercase_normalized(self):
        assert _first_word("THE quick brown fox") == "the"


# ── _split_words ─────────────────────────────────────────────────────────────

class TestSplitWords:
    def test_basic_split(self):
        assert _split_words("one two three") == ["one", "two", "three"]

    def test_lowercased(self):
        assert _split_words("Hello World") == ["hello", "world"]

    def test_strips_punctuation(self):
        words = _split_words("Hello, world!")
        assert "hello" in words
        assert "world" in words
        assert "," not in words
        assert "!" not in words

    def test_html_tags_counted_as_words(self):
        # Tags contain word chars — _split_words is applied AFTER HTML stripping in callers
        # but the function itself does not strip HTML. Confirm it at least doesn't crash.
        result = _split_words("<p>Hello</p>")
        assert "hello" in result

    def test_empty_string(self):
        assert _split_words("") == []

    def test_numbers_included(self):
        assert "42" in _split_words("Chapter 42 begins")
