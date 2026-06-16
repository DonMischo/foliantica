"""
Foliantica spaCy NLP service.

POST /scan
  body: {
    content: str,            -- HTML or plain text scene content
    entries: [{
      id: int,
      name: str,
      aliases: [str],
      entry_type: str
    }]
  }
  response: {
    counts: { "<codex_id>": int },   -- known-entry mention counts
  }

GET /health
"""

import re
from fastapi import FastAPI
from pydantic import BaseModel
import spacy
from spacy.matcher import PhraseMatcher

app = FastAPI(title="Foliantica spaCy")

# Tokenizer-only pipeline for PhraseMatcher (mention scanning) — English is fine for all Latin-script languages
nlp = spacy.load("en_core_web_sm", disable=["ner", "parser", "attribute_ruler", "lemmatizer"])

# Language → model name mapping for NER
LANG_MODELS: dict[str, str] = {
    "en": "en_core_web_sm",
    "de": "de_core_news_sm",
    "fr": "fr_core_news_sm",
    "es": "es_core_news_sm",
    "it": "it_core_news_sm",
    "nl": "nl_core_news_sm",
    "pt": "pt_core_news_sm",
}

# NER entity labels to keep — covers both OntoNotes (en) and TIGER/Universal (de, fr, …) schemes
SUGGEST_LABELS = {"PERSON", "GPE", "LOC", "FAC", "ORG", "NORP", "PER"}

# Lazily loaded NER models, cached after first use
_ner_cache: dict[str, spacy.language.Language] = {}


def _get_ner_nlp(lang: str) -> spacy.language.Language:
    model = LANG_MODELS.get(lang, "en_core_web_sm")
    if model not in _ner_cache:
        try:
            _ner_cache[model] = spacy.load(model, disable=["parser", "lemmatizer"])
        except OSError:
            # Model not installed — fall back to English
            if "en_core_web_sm" not in _ner_cache:
                _ner_cache["en_core_web_sm"] = spacy.load("en_core_web_sm", disable=["parser", "lemmatizer"])
            _ner_cache[model] = _ner_cache["en_core_web_sm"]
    return _ner_cache[model]


def _strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html or "")


class EntryIn(BaseModel):
    id: int
    name: str
    aliases: list[str] = []
    entry_type: str = ""


class ScanRequest(BaseModel):
    content: str
    entries: list[EntryIn]


class SuggestRequest(BaseModel):
    content: str
    lang: str = "en"


@app.get("/health")
def health():
    return {"status": "ok", "loaded_models": list(_ner_cache.keys())}


@app.post("/suggest")
def suggest(req: SuggestRequest):
    plain = _strip_html(req.content)
    nlp_ner = _get_ner_nlp(req.lang)
    doc = nlp_ner(plain)
    counts: dict[str, int] = {}               # lowercase -> occurrence count
    meta: dict[str, tuple[str, str]] = {}     # lowercase -> (original_text, label)
    for ent in doc.ents:
        if ent.label_ not in SUGGEST_LABELS:
            continue
        text = re.sub(r"^[^\w]+|[^\w]+$", "", ent.text.strip())
        if not text:
            continue
        key = text.lower()
        counts[key] = counts.get(key, 0) + 1
        if key not in meta:
            meta[key] = (text, ent.label_)
    # Only surface entities that appear at least twice — filters out mis-tagged one-offs
    return [{"text": t, "label": l} for key, (t, l) in meta.items() if counts[key] >= 2]


@app.post("/scan")
def scan(req: ScanRequest):
    plain = _strip_html(req.content)
    doc = nlp.make_doc(plain)  # tokenize only — no full pipeline needed

    matcher = PhraseMatcher(nlp.vocab, attr="LOWER")
    for entry in req.entries:
        all_names = [n for n in [entry.name] + entry.aliases if n.strip()]
        if not all_names:
            continue
        patterns = [nlp.make_doc(n) for n in all_names]
        matcher.add(str(entry.id), patterns)

    counts: dict[str, int] = {}
    for match_id, _start, _end in matcher(doc):
        key = nlp.vocab.strings[match_id]
        counts[key] = counts.get(key, 0) + 1

    return {"counts": counts}
