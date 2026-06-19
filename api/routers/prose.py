"""
Prose style checker — structural analysis of creative writing text.

Complements Vale (word/phrase patterns) and LanguageTool (grammar) with
metrics that require statistical or sliding-window computation:
- Sentence variety (length variance, same-start runs)
- Auxiliary / Hilfsverb density per paragraph
- Adverb density (suffix-based approximation)
- Dialogue ratio

POST /api/prose/check
  body: { text: str, language: str }
"""
import math
import re

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/prose", tags=["prose"])


# ── Language data ─────────────────────────────────────────────────────────────

# Auxiliary verbs whose overuse signals static / passive prose.
# Only the most diagnostic forms are listed; common short forms (is, are, a, en)
# that would produce false positives in non-auxiliary roles are excluded.
_AUXILIARIES: dict[str, frozenset[str]] = {
    "en": frozenset({
        "was", "were", "had", "been", "would", "could", "should", "might",
        "shall", "ought",
    }),
    "de": frozenset({
        "war", "wars", "waren", "wäre", "wären",
        "wurde", "wurden", "würde", "würden",
        "hatte", "hatten", "hätte", "hätten",
        "worden",
    }),
    "fr": frozenset({
        "était", "étaient", "fut", "furent",
        "serait", "seraient", "aurait", "auraient",
        "avait", "avaient", "eut", "eurent",
    }),
    "es": frozenset({
        "era", "eran", "sería", "serían",
        "había", "habían", "hubiera", "hubieran",
        "estaba", "estaban",
    }),
    "pt": frozenset({
        "era", "eram", "seria", "seriam",
        "havia", "haviam", "estivera", "estiveram",
        "estaria", "estariam",
    }),
    "it": frozenset({
        "era", "erano", "fu", "furono",
        "sarebbe", "sarebbero", "aveva", "avevano",
        "avrebbe", "avrebbero",
    }),
    "nl": frozenset({
        "was", "waren", "zou", "zouden", "had", "hadden",
        "geweest", "geworden",
    }),
    "sv": frozenset({
        "var", "vore", "hade", "skulle", "kunde",
        "borde", "blivit", "varit",
    }),
    "da": frozenset({
        "var", "ville", "havde", "skulle", "kunne",
        "burde", "blevet", "været",
    }),
    "no": frozenset({
        "var", "ville", "hadde", "skulle", "kunne",
        "burde", "blitt", "vært",
    }),
    "pl": frozenset({
        "był", "była", "było", "byli", "były",
        "byłby", "byłaby", "byłoby", "byliby", "byłyby",
        "zostało", "zostały", "zostali", "zostanie", "zostaną",
    }),
}

# Adverb-forming suffixes per language for density approximation.
# Only suffixes that are predominantly adverbial (low noun/adjective collision).
_ADV_SUFFIXES: dict[str, tuple[str, ...]] = {
    "en": ("ly",),
    # -ig (≥7) and -lich (≥8) catch manner adverbs; overlap with adjectives is
    # acceptable — adjective overuse is similarly worth flagging in prose.
    "de": ("weise", "erweise", "maßen", "ig", "lich"),
    "fr": ("ment",),
    "es": ("mente",),
    "pt": ("mente",),
    "it": ("mente",),
    "nl": ("lijk", "erwijze"),
    "sv": ("ligen",),
    "da": ("ligen", "vis"),
    "no": ("lig", "vis"),
    "pl": ("nie", "wie"),
}


# ── Text utilities ────────────────────────────────────────────────────────────

def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "")


def _split_sentences(plain: str) -> list[str]:
    # Split on sentence-ending punctuation followed by whitespace.
    # Handles ellipsis, question marks, exclamation marks.
    raw = re.split(r"(?<=[.!?…])\s+", plain)
    return [s.strip() for s in raw if s.strip()]


def _split_words(text: str) -> list[str]:
    return re.findall(r"\b\w+\b", text.lower())


def _stddev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    return math.sqrt(variance)


def _first_word(sentence: str) -> str:
    m = re.match(r"^\W*(\w+)", sentence)
    return m.group(1).lower() if m else ""


# ── Analysis functions ────────────────────────────────────────────────────────

def _sentence_variety(sentences: list[str]) -> dict:
    """Length variance + consecutive same-start detection."""
    lengths = [len(s.split()) for s in sentences if s.split()]
    if not lengths:
        return {
            "avg_length": 0.0, "length_stddev": 0.0,
            "variety": "n/a", "repetitive_starts": [],
        }

    avg = sum(lengths) / len(lengths)
    std = _stddev(lengths)
    cv = std / avg if avg > 0 else 0.0
    variety = "good" if cv >= 0.4 else ("moderate" if cv >= 0.2 else "low")

    # Find runs of 3+ consecutive sentences starting with the same word.
    starts = [_first_word(s) for s in sentences]
    repetitive: list[dict] = []
    i = 0
    while i < len(starts):
        w = starts[i]
        if not w:
            i += 1
            continue
        j = i + 1
        while j < len(starts) and starts[j] == w:
            j += 1
        if j - i >= 3:
            repetitive.append({"word": w, "count": j - i, "from_sentence": i})
        i = j if j > i else i + 1

    return {
        "avg_length": round(avg, 1),
        "length_stddev": round(std, 1),
        "variety": variety,
        "repetitive_starts": repetitive,
    }


def _auxiliary_density(paragraphs: list[str], lang: str) -> dict:
    """Flag paragraphs where auxiliary verbs make up too large a share of words."""
    aux = _AUXILIARIES.get(lang) or _AUXILIARIES["en"]
    flagged: list[dict] = []
    for i, para in enumerate(paragraphs):
        words = _split_words(para)
        if len(words) < 20:
            continue
        count = sum(1 for w in words if w in aux)
        ratio = count / len(words)
        if ratio >= 0.10:
            flagged.append({
                "paragraph": i,
                "auxiliary_count": count,
                "word_count": len(words),
                "ratio": round(ratio, 3),
                "level": "high" if ratio >= 0.16 else "elevated",
            })
    return {"flagged_paragraphs": flagged}


_ADV_MIN_LEN: dict[str, int] = {"ig": 7, "lich": 8}

def _adverb_density(words: list[str], lang: str) -> dict:
    """Estimate adverb density via suffix matching."""
    suffixes = _ADV_SUFFIXES.get(lang) or _ADV_SUFFIXES["en"]
    def _matches(w: str) -> bool:
        for s in suffixes:
            if w.endswith(s) and len(w) >= _ADV_MIN_LEN.get(s, 5):
                return True
        return False
    count = sum(1 for w in words if _matches(w))
    ratio = count / len(words) if words else 0.0
    level = "high" if ratio >= 0.08 else ("elevated" if ratio >= 0.05 else "ok")
    return {"count": count, "ratio": round(ratio, 3), "level": level}


def _dialog_ratio(plain: str) -> dict:
    """Estimate what share of lines are dialogue."""
    lines = [ln.strip() for ln in plain.split("\n") if ln.strip()]
    _DIALOG_OPENERS = {
        '"',   # straight double quote
        """,  # " LEFT DOUBLE QUOTATION MARK
        """,  # " DOUBLE LOW-9 QUOTATION MARK (German/Polish open)
        "«",  # « LEFT-POINTING DOUBLE ANGLE (French/Italian open)
        "–",  # – EN DASH (dialog marker in some European traditions)
        "—",  # — EM DASH
    }
    dialog = sum(1 for ln in lines if ln and ln[0] in _DIALOG_OPENERS)
    ratio = dialog / len(lines) if lines else 0.0
    return {
        "ratio": round(ratio, 3),
        "dialog_lines": dialog,
        "total_lines": len(lines),
    }


# ── Endpoint ──────────────────────────────────────────────────────────────────

class ProseCheckRequest(BaseModel):
    text: str
    language: str = "en"


@router.post("/check")
def check_prose(body: ProseCheckRequest):
    lang = body.language.lower()[:2]
    plain = _strip_html(body.text)

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", plain) if p.strip()]
    if not paragraphs:
        paragraphs = [plain] if plain.strip() else []

    sentences = _split_sentences(plain)
    words = _split_words(plain)

    return {
        "language": lang,
        "word_count": len(words),
        "sentence_count": len(sentences),
        "paragraph_count": len(paragraphs),
        "sentence_variety": _sentence_variety(sentences),
        "auxiliary_density": _auxiliary_density(paragraphs, lang),
        "adverb_density": _adverb_density(words, lang),
        "dialog": _dialog_ratio(plain),
    }
