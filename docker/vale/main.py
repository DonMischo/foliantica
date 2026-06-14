import json
import os
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

_DEFAULT_INI = Path(__file__).parent / "default.ini"


class CheckRequest(BaseModel):
    text: str
    config: str | None = None  # .vale.ini content; None → use default.ini


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/check")
def check(req: CheckRequest):
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "input.md"
        src.write_text(req.text, encoding="utf-8")

        if req.config:
            cfg = Path(tmp) / ".vale.ini"
            cfg.write_text(req.config, encoding="utf-8")
            cfg_path = str(cfg)
        else:
            cfg_path = str(_DEFAULT_INI)

        result = subprocess.run(
            ["vale", "--config", cfg_path, "--output=JSON", str(src)],
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
