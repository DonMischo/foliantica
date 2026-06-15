"""
Vale prose-linter proxy.

POST /api/vale/check
  body: { text: str }
  system mode: runs `vale --output=JSON` subprocess
  docker mode: forwards to the Vale sidecar container
"""

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import UserSettings

router = APIRouter(prefix="/api/vale", tags=["vale"])


class CheckRequest(BaseModel):
    text: str
    language: str | None = None  # e.g. "en-US", "de-DE", "auto"


def _get_settings(db: Session) -> UserSettings:
    s = db.query(UserSettings).first()
    if not s or (getattr(s, "vale_mode", None) or "off") == "off":
        raise HTTPException(503, "Vale is not enabled in settings")
    return s


@router.post("/check")
async def check_vale(body: CheckRequest, db: Session = Depends(get_db)):
    s = _get_settings(db)
    mode = getattr(s, "vale_mode", None) or "off"
    config_path = getattr(s, "vale_config_path", None) or None

    if mode == "system":
        return _check_system(body.text, config_path, body.language)

    # docker mode
    vale_url = (getattr(s, "vale_url", None) or "http://localhost:8085").rstrip("/")
    payload: dict = {"text": body.text, "language": body.language}
    if config_path:
        try:
            payload["config"] = Path(config_path).read_text(encoding="utf-8")
        except Exception:
            pass
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(f"{vale_url}/check", json=payload)
        r.raise_for_status()
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Vale container is not reachable. Is it running?")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"Vale error: {exc.response.text[:300]}")


def _check_system(text: str, config_path: str | None, language: str | None = None) -> dict:
    vale_bin = shutil.which("vale")
    if not vale_bin:
        raise HTTPException(
            503,
            "vale not found on PATH. Install it (winget install Vale.Vale / "
            "brew install vale) or switch to Docker mode in settings.",
        )
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "input.md"
        src.write_text(text, encoding="utf-8")

        cmd = [vale_bin, "--output=JSON"]
        if config_path:
            cmd += ["--config", config_path]
        elif not (language or "").lower().startswith("en"):
            # No user config and non-English: generate a minimal config that
            # disables Vale's English-only spell checker.
            ini = Path(tmp) / ".vale.ini"
            ini.write_text(
                "MinAlertLevel = suggestion\n\n[*.md]\nBasedOnStyles = Vale\nVale.Spelling = NO\n",
                encoding="utf-8",
            )
            cmd += ["--config", str(ini)]
        cmd.append(str(src))

        flags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=30,
            cwd=tmp, creationflags=flags,
        )

        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            if result.returncode not in (0, 1):
                raise HTTPException(500, f"Vale error: {result.stderr[:500]}")
            return {"alerts": []}

        alerts = []
        for file_alerts in data.values():
            alerts.extend(file_alerts)
        return {"alerts": alerts}
