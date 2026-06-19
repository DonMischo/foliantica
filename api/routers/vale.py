"""
Vale prose-linter proxy.

POST /api/vale/check                  — run Vale on text
GET  /api/vale/sync-status            — last sync time, error count, entry count
POST /api/vale/sync-rules             — seed/refresh vale_rule_entries from YAML files
GET  /api/vale/rule-meta/{lang}       — list rule names + types for a language
GET  /api/vale/rule-entries/{lang}/{rule}  — entries for one rule (with enabled flag)
PATCH /api/vale/rule-entries/{lang}/{rule} — toggle one entry  {key, enabled}
PUT   /api/vale/rule-entries/{lang}/{rule} — toggle all entries {enabled}
GET  /api/vale/custom-rules           — user custom rule entries
PUT  /api/vale/custom-rules           — replace custom rule entries
"""

import json
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, UTC
from pathlib import Path

import httpx
import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import UserSettings, ValeRuleEntry

router = APIRouter(prefix="/api/vale", tags=["vale"])

_STYLES_DIR = Path(__file__).parent.parent / "vale_styles"
_SUPPORTED_LANG_STYLES = {"en", "de", "es", "fr", "it", "nl", "pt", "sv", "da", "no", "pl"}
_UNSUPPORTED_LANGS = {"zh", "ja", "ko", "ar"}


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class CheckRequest(BaseModel):
    text: str
    language: str | None = None


class CustomRulesBody(BaseModel):
    rules: dict


class ToggleEntryBody(BaseModel):
    key: str
    enabled: bool


class ToggleAllBody(BaseModel):
    enabled: bool


def _lang_code(language: str | None) -> str:
    return (language or "").lower()[:2]


# ── Sync ─────────────────────────────────────────────────────────────────────

def _sync_rules_to_db(db: Session) -> dict[str, str]:
    """Read all YAML style files and sync to vale_rule_entries. Returns {filename: error}."""
    errors: dict[str, str] = {}
    valid_keys: set[tuple[str, str, str]] = set()

    for lang_dir in sorted(_STYLES_DIR.iterdir()):
        lang = lang_dir.name
        if not lang_dir.is_dir() or lang not in _SUPPORTED_LANG_STYLES:
            continue
        for f in sorted(lang_dir.glob("*.yml")):
            file_id = f"{lang}/{f.name}"
            try:
                doc = yaml.safe_load(f.read_text(encoding="utf-8"))
                if not isinstance(doc, dict):
                    errors[file_id] = "Not a YAML mapping"
                    continue
                rule_name = f.stem
                rule_type = doc.get("extends", "existence")
                rule_message = doc.get("message")
                rule_level = doc.get("level", "suggestion")
                rule_ignorecase = 1 if doc.get("ignorecase", True) else 0

                if rule_type == "substitution":
                    items: list[tuple[str, str | None]] = [
                        (k, v) for k, v in (doc.get("swap") or {}).items()
                    ]
                else:
                    items = [(t, None) for t in (doc.get("tokens") or [])]

                for entry_key, entry_value in items:
                    if (lang, rule_name, entry_key) in valid_keys:
                        continue  # skip duplicate tokens within same file
                    valid_keys.add((lang, rule_name, entry_key))
                    existing = db.query(ValeRuleEntry).filter_by(
                        lang=lang, rule_name=rule_name, entry_key=entry_key
                    ).first()
                    if existing is None:
                        db.add(ValeRuleEntry(
                            lang=lang, rule_name=rule_name,
                            rule_type=rule_type, rule_message=rule_message,
                            rule_level=rule_level, rule_ignorecase=rule_ignorecase,
                            entry_key=entry_key, entry_value=entry_value,
                            enabled=1,
                        ))
                    else:
                        existing.rule_type = rule_type
                        existing.rule_message = rule_message
                        existing.rule_level = rule_level
                        existing.rule_ignorecase = rule_ignorecase
                        existing.entry_value = entry_value
            except Exception as exc:
                errors[file_id] = str(exc)

    # Remove entries no longer present in YAML files
    if valid_keys:
        for entry in db.query(ValeRuleEntry).all():
            if (entry.lang, entry.rule_name, entry.entry_key) not in valid_keys:
                db.delete(entry)

    db.commit()
    return errors


def _migrate_old_disabled(db: Session) -> None:
    """On first sync, apply legacy vale_disabled_entries JSON to the new table."""
    s = db.query(UserSettings).first()
    if not s:
        return
    raw = getattr(s, "vale_disabled_entries", None)
    if not raw:
        return
    try:
        old: dict = json.loads(raw)
    except Exception:
        return
    for lang, rules in old.items():
        for rule_name, keys in rules.items():
            for key in (keys or []):
                entry = db.query(ValeRuleEntry).filter_by(
                    lang=lang, rule_name=rule_name, entry_key=key
                ).first()
                if entry:
                    entry.enabled = 0
    s.vale_disabled_entries = None
    db.commit()


# ── Style loading ─────────────────────────────────────────────────────────────

def _load_styles(
    language: str | None,
    custom_rules: dict | None = None,
    db: Session | None = None,
) -> dict[str, str]:
    """Return {rel_path: yaml_content} for the given language.

    Uses DB entries when the table has been synced; falls back to raw YAML
    files otherwise so Vale still works before the first sync.
    """
    lang = _lang_code(language)
    if lang not in _SUPPORTED_LANG_STYLES:
        return {}

    styles: dict[str, str] = {}

    if db is not None:
        count = db.query(ValeRuleEntry).filter(ValeRuleEntry.lang == lang).count()
        if count > 0:
            entries = (
                db.query(ValeRuleEntry)
                .filter(ValeRuleEntry.lang == lang, ValeRuleEntry.enabled == 1)
                .all()
            )
            by_rule: dict[str, dict] = {}
            for e in entries:
                if e.rule_name not in by_rule:
                    by_rule[e.rule_name] = {
                        "type": e.rule_type,
                        "message": e.rule_message or "'%s'",
                        "level": e.rule_level or "suggestion",
                        "ignorecase": bool(e.rule_ignorecase),
                        "entries": [],
                    }
                by_rule[e.rule_name]["entries"].append(e)

            for rule_name, rd in by_rule.items():
                doc: dict = {
                    "extends": rd["type"],
                    "message": rd["message"],
                    "level": rd["level"],
                    "ignorecase": rd["ignorecase"],
                }
                if rd["type"] == "substitution":
                    doc["swap"] = {e.entry_key: e.entry_value for e in rd["entries"]}
                    if not doc["swap"]:
                        continue
                else:
                    doc["tokens"] = [e.entry_key for e in rd["entries"]]
                    if not doc["tokens"]:
                        continue
                styles[f"Foliantica/{rule_name}.yml"] = yaml.dump(
                    doc, allow_unicode=True, default_flow_style=False
                )

            _inject_custom_rules(styles, lang, custom_rules)
            return styles

    # Fallback: read YAML files directly (pre-sync or no DB)
    lang_dir = _STYLES_DIR / lang
    if lang_dir.exists():
        for f in sorted(lang_dir.glob("*.yml")):
            styles[f"Foliantica/{f.name}"] = f.read_text(encoding="utf-8")

    _inject_custom_rules(styles, lang, custom_rules)
    return styles


def _inject_custom_rules(styles: dict[str, str], lang: str, custom_rules: dict | None) -> None:
    if not custom_rules or lang not in custom_rules:
        return
    for rule_name, entries in custom_rules[lang].items():
        if not entries:
            continue
        if isinstance(entries, list):
            doc = {
                "extends": "existence",
                "message": "'%s' — custom rule",
                "level": "suggestion",
                "ignorecase": True,
                "tokens": entries,
            }
        elif isinstance(entries, dict):
            doc = {
                "extends": "substitution",
                "message": "'%s' — custom: consider '%s'",
                "level": "suggestion",
                "ignorecase": True,
                "swap": entries,
            }
        else:
            continue
        styles[f"Foliantica/Custom_{rule_name}.yml"] = yaml.dump(
            doc, allow_unicode=True, default_flow_style=False
        )


# ── Settings helpers ──────────────────────────────────────────────────────────

def _get_settings(db: Session) -> UserSettings:
    s = db.query(UserSettings).first()
    if not s or (getattr(s, "vale_mode", None) or "off") == "off":
        raise HTTPException(503, "Vale is not enabled in settings")
    return s


def _load_custom_rules(s: UserSettings) -> dict:
    try:
        return json.loads(getattr(s, "vale_custom_rules", None) or "{}")
    except Exception:
        return {}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/sync-status")
async def get_sync_status(db: Session = Depends(get_db)):
    s = db.query(UserSettings).first()
    last_synced = getattr(s, "vale_last_synced", None) if s else None
    errors_raw = getattr(s, "vale_sync_errors", None) if s else None
    try:
        errors = json.loads(errors_raw) if errors_raw else {}
    except Exception:
        errors = {}
    total = db.query(ValeRuleEntry).count()
    return {
        "last_synced": last_synced.isoformat() if last_synced else None,
        "errors": errors,
        "total_entries": total,
    }


@router.post("/sync-rules")
async def sync_rules(db: Session = Depends(get_db)):
    is_first = db.query(ValeRuleEntry).count() == 0
    errors = _sync_rules_to_db(db)
    if is_first:
        _migrate_old_disabled(db)

    s = db.query(UserSettings).first()
    if not s:
        s = UserSettings()
        db.add(s)
    s.vale_last_synced = _now()
    s.vale_sync_errors = json.dumps(errors, ensure_ascii=False) if errors else None
    db.commit()

    total = db.query(ValeRuleEntry).count()
    return {
        "synced": total,
        "errors": errors,
        "last_synced": s.vale_last_synced.isoformat(),
    }


@router.get("/rule-meta/{lang}")
async def get_rule_meta(lang: str, db: Session = Depends(get_db)):
    lang_code = lang.lower()[:2]
    if lang_code not in _SUPPORTED_LANG_STYLES:
        return {"rules": []}

    rows = (
        db.query(ValeRuleEntry.rule_name, ValeRuleEntry.rule_type)
        .filter(ValeRuleEntry.lang == lang_code)
        .distinct()
        .all()
    )
    if rows:
        seen: dict[str, str] = {}
        for rule_name, rule_type in rows:
            seen.setdefault(rule_name, rule_type)
        return {"rules": [{"name": n, "type": t} for n, t in sorted(seen.items())]}

    # Fallback: read YAML
    lang_dir = _STYLES_DIR / lang_code
    rules = []
    if lang_dir.exists():
        for f in sorted(lang_dir.glob("*.yml")):
            try:
                data = yaml.safe_load(f.read_text(encoding="utf-8"))
                rules.append({"name": f.stem, "type": data.get("extends", "existence")})
            except Exception:
                pass
    return {"rules": rules}


@router.get("/rule-entries/{lang}/{rule_name}")
async def get_rule_entries(lang: str, rule_name: str, db: Session = Depends(get_db)):
    lang_code = lang.lower()[:2]
    rows = (
        db.query(ValeRuleEntry)
        .filter(ValeRuleEntry.lang == lang_code, ValeRuleEntry.rule_name == rule_name)
        .all()
    )
    if rows:
        rule_type = rows[0].rule_type
        if rule_type == "substitution":
            entries = [{"key": e.entry_key, "value": e.entry_value, "enabled": bool(e.enabled)} for e in rows]
        else:
            entries = [{"key": e.entry_key, "enabled": bool(e.enabled)} for e in rows]
        return {"type": rule_type, "entries": entries}

    # Fallback: read YAML
    rule_file = _STYLES_DIR / lang_code / f"{rule_name}.yml"
    if not rule_file.exists():
        raise HTTPException(404, "Rule not found")
    doc = yaml.safe_load(rule_file.read_text(encoding="utf-8"))
    rule_type = doc.get("extends", "existence")
    if rule_type == "substitution":
        entries = [{"key": k, "value": v, "enabled": True} for k, v in (doc.get("swap") or {}).items()]
    else:
        entries = [{"key": t, "enabled": True} for t in (doc.get("tokens") or [])]
    return {"type": rule_type, "entries": entries}


@router.patch("/rule-entries/{lang}/{rule_name}")
async def toggle_rule_entry(lang: str, rule_name: str, body: ToggleEntryBody, db: Session = Depends(get_db)):
    """Toggle enabled state for a single entry."""
    lang_code = lang.lower()[:2]
    entry = db.query(ValeRuleEntry).filter_by(
        lang=lang_code, rule_name=rule_name, entry_key=body.key
    ).first()
    if not entry:
        raise HTTPException(404, "Entry not found — sync rules first")
    entry.enabled = 1 if body.enabled else 0
    db.commit()
    return {"ok": True}


@router.put("/rule-entries/{lang}/{rule_name}")
async def toggle_all_rule_entries(lang: str, rule_name: str, body: ToggleAllBody, db: Session = Depends(get_db)):
    """Toggle enabled state for all entries in a rule."""
    lang_code = lang.lower()[:2]
    db.query(ValeRuleEntry).filter(
        ValeRuleEntry.lang == lang_code,
        ValeRuleEntry.rule_name == rule_name,
    ).update({"enabled": 1 if body.enabled else 0})
    db.commit()
    return {"ok": True}


@router.get("/custom-rules")
async def get_custom_rules(db: Session = Depends(get_db)):
    s = db.query(UserSettings).first()
    return {"rules": _load_custom_rules(s) if s else {}}


@router.put("/custom-rules")
async def put_custom_rules(body: CustomRulesBody, db: Session = Depends(get_db)):
    s = db.query(UserSettings).first()
    if not s:
        s = UserSettings()
        db.add(s)
    s.vale_custom_rules = json.dumps(body.rules, ensure_ascii=False)
    db.commit()
    return {"ok": True}


@router.post("/check")
async def check_vale(body: CheckRequest, db: Session = Depends(get_db)):
    s = _get_settings(db)
    mode = getattr(s, "vale_mode", None) or "off"
    config_path = getattr(s, "vale_config_path", None) or None
    custom_rules = _load_custom_rules(s)

    if mode == "system":
        return _check_system(body.text, config_path, body.language, custom_rules, db)

    # Docker mode
    vale_url = (getattr(s, "vale_url", None) or "http://localhost:8085").rstrip("/")
    styles = _load_styles(body.language, custom_rules, db)
    payload: dict = {"text": body.text, "language": body.language, "styles": styles or None}
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


def _check_system(
    text: str,
    config_path: str | None,
    language: str | None = None,
    custom_rules: dict | None = None,
    db: Session | None = None,
) -> dict:
    vale_bin = shutil.which("vale")
    if not vale_bin:
        raise HTTPException(
            503,
            "vale not found on PATH. Install it (winget install Vale.Vale / "
            "brew install vale) or switch to Docker mode in settings.",
        )

    lang = _lang_code(language)
    styles = _load_styles(language, custom_rules, db)

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "input.md"
        src.write_text(text, encoding="utf-8")

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
                based_on = "Vale, Foliantica" if styles else "Vale"
                spelling_off = ""
            else:
                based_on = "Vale, Foliantica" if styles else "Vale"
                spelling_off = "\nVale.Spelling = NO"
            ini = Path(tmp) / ".vale.ini"
            ini.write_text(
                "\n".join([
                    "StylesPath = styles",
                    "MinAlertLevel = suggestion",
                    "",
                    "[*.md]",
                    f"BasedOnStyles = {based_on}{spelling_off}",
                ]) + "\n",
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
