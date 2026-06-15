import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

_APP_STYLES = Path("/app/styles")

# Vale cannot meaningfully analyse CJK or Arabic — whitespace tokenisation breaks down.
_UNSUPPORTED = {"zh", "ja", "ko", "ar"}


class CheckRequest(BaseModel):
    text: str
    config: str | None = None          # full .vale.ini content; overrides everything
    language: str | None = None        # e.g. "en-US", "de", "auto"
    styles: dict[str, str] | None = None  # rel path inside styles/ → YAML content


@app.get("/health")
def health():
    return {"status": "ok"}


def _lang(language: str | None) -> str:
    return (language or "").lower()[:2]


def _build_config(lang: str, has_foliantica: bool) -> str:
    if lang in ("en", ""):
        based_on = "Vale, write-good, proselint"
        if has_foliantica:
            based_on += ", Foliantica"
    else:
        # Non-English: skip Vale built-ins (English spelling + style) entirely.
        # Use only our Foliantica rules; fall back to bare Vale if none loaded.
        based_on = "Foliantica" if has_foliantica else "Vale"
    return (
        "StylesPath = styles\n"
        "MinAlertLevel = suggestion\n"
        "\n"
        "[*.md]\n"
        f"BasedOnStyles = {based_on}\n"
    )


@app.post("/check")
def check(req: CheckRequest):
    if _lang(req.language) in _UNSUPPORTED:
        return {"alerts": []}

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        (tmp_path / "input.md").write_text(req.text, encoding="utf-8")

        # Seed styles/ with community packages bundled in the image
        styles_dir = tmp_path / "styles"
        if _APP_STYLES.exists():
            shutil.copytree(_APP_STYLES, styles_dir)
        else:
            styles_dir.mkdir()

        # Overlay Foliantica/language rules sent from the API
        has_foliantica = bool(req.styles)
        if req.styles:
            for rel, content in req.styles.items():
                dest = styles_dir / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(content, encoding="utf-8")

        cfg = tmp_path / ".vale.ini"
        if req.config:
            cfg.write_text(req.config, encoding="utf-8")
        else:
            cfg.write_text(_build_config(_lang(req.language), has_foliantica), encoding="utf-8")

        result = subprocess.run(
            ["vale", "--config", str(cfg), "--output=JSON", str(tmp_path / "input.md")],
            capture_output=True, text=True, timeout=30, cwd=tmp,
        )

        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            if result.returncode not in (0, 1):
                raise HTTPException(500, result.stderr[:500] or "Vale error")
            return {"alerts": []}

        alerts = []
        for file_alerts in data.values():
            alerts.extend(file_alerts)
        return {"alerts": alerts}
