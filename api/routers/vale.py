"""
Vale prose-linter proxy.

POST /api/vale/check
  body: { text: str, language?: str }
  system mode: runs `vale --output=JSON` subprocess with Foliantica language rules
  docker mode: forwards to the Vale sidecar, bundling Foliantica rules in the payload
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

_STYLES_DIR = Path(__file__).parent.parent / "vale_styles"
_SUPPORTED_LANG_STYLES = {"en", "de", "es", "fr", "pt", "sv", "da", "no"}
_UNSUPPORTED_LANGS = {"zh", "ja", "ko", "ar"}


class CheckRequest(BaseModel):
    text: str
    language: str | None = None  # e.g. "en-US", "de-DE", "auto"


def _lang_code(language: str | None) -> str:
    return (language or "").lower()[:2]


def _load_styles(language: str | None) -> dict[str, str]:
    """Load Foliantica YAML rules for the given language into a {rel_path: content} dict."""
    lang = _lang_code(language)
    if lang not in _SUPPORTED_LANG_STYLES:
        return {}
    styles: dict[str, str] = {}
    lang_dir = _STYLES_DIR / lang
    if lang_dir.exists():
        for f in sorted(lang_dir.glob("*.yml")):
            styles[f"Foliantica/{f.name}"] = f.read_text(encoding="utf-8")
    return styles


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
    styles = _load_styles(body.language)
    payload: dict = {
        "text": body.text,
        "language": body.language,
        "styles": styles or None,
    }
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

    lang = _lang_code(language)
    styles = _load_styles(language)

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "input.md"
        src.write_text(text, encoding="utf-8")

        # Write Foliantica language rules into the temp styles dir
        if styles:
            for rel, content in styles.items():
                dest = Path(tmp) / "styles" / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(content, encoding="utf-8")

        cmd = [vale_bin, "--output=JSON"]
        if config_path:
            cmd += ["--config", config_path]
        else:
            if lang.startswith("en") or not lang:
                based_on = "Vale"
                if styles:
                    based_on += ", Foliantica"
            else:
                based_on = "Foliantica" if styles else "Vale"
            ini_parts = [
                "StylesPath = styles",
                "MinAlertLevel = suggestion",
                "",
                "[*.md]",
                f"BasedOnStyles = {based_on}",
            ]
            ini = Path(tmp) / ".vale.ini"
            ini.write_text("\n".join(ini_parts) + "\n", encoding="utf-8")
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
