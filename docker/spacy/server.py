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

# Load once at startup — en_core_web_sm is ~12 MB
nlp = spacy.load("en_core_web_sm", disable=["ner", "parser", "attribute_ruler", "lemmatizer"])


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


@app.get("/health")
def health():
    return {"status": "ok"}


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
