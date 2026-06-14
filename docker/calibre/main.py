"""
Foliantica Calibre conversion service.

POST /convert
  body (JSON):
    html:     str          — HTML content of the book
    format:   "mobi" | "azw3"
    title:    str
    author:   str | None
    language: str | None   — BCP-47 code, e.g. "en", "de"
    cover:    str | None   — base64-encoded PNG/JPEG

GET /health
  Health check
"""

import base64
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="Foliantica Calibre")

_MIME = {"mobi": "application/x-mobipocket-ebook", "azw3": "application/vnd.amazon.ebook"}


class ConvertRequest(BaseModel):
    html: str
    format: str = "mobi"
    title: str = ""
    author: str | None = None
    language: str | None = None
    cover: str | None = None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/convert")
def convert(req: ConvertRequest):
    fmt = req.format.lower()
    if fmt not in _MIME:
        raise HTTPException(400, f"Unsupported format: {fmt}. Use 'mobi' or 'azw3'.")

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "input.html"
        dst = Path(tmp) / f"output.{fmt}"
        src.write_text(req.html, encoding="utf-8")

        cmd = ["ebook-convert", str(src), str(dst)]

        if req.title:
            cmd += ["--title", req.title]
        if req.author:
            cmd += ["--authors", req.author]
        if req.language:
            cmd += ["--language", req.language]

        if req.cover:
            cover_path = Path(tmp) / "cover.jpg"
            cover_path.write_bytes(base64.b64decode(req.cover))
            cmd += ["--cover", str(cover_path)]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise HTTPException(500, f"ebook-convert failed: {result.stderr[-2000:]}")

        data = dst.read_bytes()

    return Response(
        content=data,
        media_type=_MIME[fmt],
        headers={"Content-Disposition": f'attachment; filename="book.{fmt}"'},
    )
