"""Dungeon Master — play sessions for RPG-kind projects.

Phase 1: persistent session transcripts (memory L0), streaming DM narration,
dice rolls (server RNG or manually entered table rolls). Dice are never rolled
by the model.
"""
import json
import random
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, text as sql_text
from sqlalchemy.orm import Session

from ai_providers import stream_provider, post_provider
from database import get_db, SessionLocal
from models import Project, DmFact, DmSession, DmScene, DmTurn, CodexEntry, CodexRelation, UserSettings, AIPrompt, _now
from routers.ai import _resolve_provider, LANGUAGE_NAMES
from routers.codex import _codex_owner_id
from schemas import (
    DICE_SIDES,
    CodexEntryOut,
    DmActionRequest, DmCharacterSaveRequest, DmCharGenRequest, DmFactOut, DmPrefsUpdate,
    DmRollRequest, DmSceneOut, DmSessionCreate, DmSessionOut, DmTurnOut,
)
from services.dm_chargen import build_character, generate_npc, load_ruleset, roll_stat_pool
from services.dm_oracle import ban_list, draw_for_scene
from services import wildcards as wc

router = APIRouter(prefix="/api", tags=["dm"])

HISTORY_TURNS = 30

_FALLBACK_PERSONA = (
    "You are the game master of a tabletop RPG for a single player. Narrate in second person, "
    "present tense. Never roll dice yourself: when an outcome is uncertain, ask for one roll and stop. "
    "Honour every dice result. Narrate exclusively in {{LANGUAGE}}."
)


def _get_project(project_id: int, db: Session) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return project


def _get_session(session_id: int, db: Session) -> DmSession:
    session = db.get(DmSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return session


def _project_language(project: Project) -> str:
    lang_code = None
    # dm_prefs.language wins — RPG projects have no Book Meta dialog
    if project.dm_prefs:
        try:
            lang_code = json.loads(project.dm_prefs).get("language")
        except (json.JSONDecodeError, TypeError):
            pass
    if not lang_code and project.book_meta:
        try:
            lang_code = json.loads(project.book_meta).get("language")
        except (json.JSONDecodeError, TypeError):
            pass
    base = (lang_code or "en").split("-")[0].lower()
    return LANGUAGE_NAMES.get(base, lang_code or "en")


def _entry_line(e: CodexEntry, name_by_id: dict[int, str] | None = None) -> str:
    name_by_id = name_by_id or {}
    aliases = e.get_aliases()
    alias_str = f" (also: {', '.join(aliases)})" if aliases else ""
    line = f"**{e.name}** [{e.entry_type}]{alias_str}: {e.description or ''}"
    if e.rpg_sheet:
        try:
            sheet = json.loads(e.rpg_sheet)
            conds = ", ".join(sheet.get("conditions", []))
            species = sheet.get("species", "")
            if sheet.get("species2"):
                species = f"{species}/{sheet['species2']} halfblood"
            gender = sheet.get("gender") or getattr(e, "gender", None)
            line += (
                f" — {gender + ' ' if gender else ''}{species} {sheet.get('class', '')} L{sheet.get('level', 1)}, "
                f"HP {sheet.get('hp', {}).get('current', '?')}/{sheet.get('hp', {}).get('max', '?')}, AC {sheet.get('ac', '?')}"
                + (f", conditions: {conds}" if conds else "")
            )
            legacy_gear = ", ".join(g["name"] for g in sheet.get("gear", []))
            if legacy_gear:
                line += f", gear: {legacy_gear}"
            looks = sheet.get("appearance")
            if looks:
                marks = ", ".join([*looks.get("scars", []), *looks.get("tattoos", [])])
                line += (
                    f"; looks: {looks.get('size', '')}, {looks.get('build', '')}, "
                    f"{looks.get('hair_color', '')} hair {looks.get('hair_style', '')}, {looks.get('eye_color', '')} eyes"
                    + (f", {marks}" if marks else "")
                )
        except (json.JSONDecodeError, TypeError):
            pass
    if e.inventory:
        try:
            inv = json.loads(e.inventory)
            bits = []
            for c in inv.get("currencies") or []:
                bits.append(f"{c.get('amount', 0)} {c.get('name', '')}")
            for p in inv.get("possessions") or []:
                pname = name_by_id.get(p.get("entry_id"))
                if pname:
                    qty = p.get("quantity", 1)
                    bits.append(f"{pname}{f' ×{qty}' if qty > 1 else ''}")
            for r in inv.get("relics") or []:
                rname = name_by_id.get(r.get("entry_id"))
                if rname:
                    bits.append(f"{rname} (relic)")
            if bits:
                line += f"; carries: {', '.join(bits)}"
        except (json.JSONDecodeError, TypeError):
            pass
    return line


def _search_facts(project_id: int, query_text: str, db: Session, limit: int = 10) -> list[DmFact]:
    """Full-text match over dm_facts ('simple' config — campaigns run in any language).
    Terms are OR-ed so any overlap with the current action surfaces a memory."""
    import re as _re
    terms = list(dict.fromkeys(
        w.lower() for w in _re.findall(r"[^\W\d_]{4,}", query_text, _re.UNICODE)
    ))[:12]
    if not terms:
        return []
    tsquery = " | ".join(terms)
    rows = db.execute(
        sql_text(
            "SELECT id FROM dm_facts WHERE project_id = :pid "
            "AND to_tsvector('simple', text) @@ to_tsquery('simple', :q) "
            "ORDER BY ts_rank(to_tsvector('simple', text), to_tsquery('simple', :q)) DESC, weight DESC, id DESC "
            "LIMIT :lim"
        ),
        {"pid": project_id, "q": tsquery, "lim": limit},
    ).fetchall()
    ids = [r[0] for r in rows]
    if not ids:
        return []
    by_id = {f.id: f for f in db.query(DmFact).filter(DmFact.id.in_(ids)).all()}
    return [by_id[i] for i in ids if i in by_id]


def _dm_system_prompt(project: Project, db: Session, query_text: str = "") -> str:
    """Layered DM context: persona → campaign brief (L3) → scene → relevant
    codex entries → open threads + retrieved facts (L1). Falls back to the full
    codex while the campaign is still small."""
    row = db.query(AIPrompt).filter(AIPrompt.built_in_key == "dm_persona").first()
    system = (row.system if row and row.system else _FALLBACK_PERSONA)
    system = system.replace("{{LANGUAGE}}", _project_language(project))

    parts = [system, f"# Campaign: {project.title}"]
    if project.description:
        parts.append(project.description)

    if project.campaign_brief:
        parts.append(f"## Story so far\n{project.campaign_brief}")

    owner_id = _codex_owner_id(project)
    entries = db.query(CodexEntry).filter(CodexEntry.project_id == owner_id).all()
    by_name = {e.name.lower(): e for e in entries}
    name_by_id = {e.id: e.name for e in entries}

    scene = (
        db.query(DmScene)
        .filter(DmScene.project_id == project.id, DmScene.is_current == 1)
        .order_by(DmScene.id.desc())
        .first()
    )
    present_names: list[str] = []
    if scene:
        try:
            present_names = json.loads(scene.present_npcs or "[]")
        except (json.JSONDecodeError, TypeError):
            present_names = []
        location = db.get(CodexEntry, scene.location_entry_id) if scene.location_entry_id else None
        scene_bits = [f"## Current scene: {scene.title}"]
        if location:
            scene_bits.append(f"Location: {location.name}")
        if scene.situation:
            scene_bits.append(scene.situation)
        if present_names:
            scene_bits.append(f"Present: {', '.join(present_names)}")
        parts.append("\n".join(scene_bits))

        oracle = draw_for_scene(scene.id)
        oracle_lines = [
            "## Scene oracle (random constraints — weave in what fits naturally, never quote them verbatim)",
            f"- Texture of this place: {oracle['scene_texture']}",
            f"- Weather: {oracle['weather']}",
            f"- If a new NPC appears, their quirk: {oracle['npc_quirk']}",
            f"- If the scene stalls, the complication waiting: {oracle['complication']}",
            f"- Meanwhile, offscreen: {oracle['offscreen_move']}",
        ]
        wc_tree, wc_enabled = _wildcards_ctx(project, db)
        if wc_tree and wc_enabled:
            rng = random.Random(scene.id * 31337 + 7)
            for cat in rng.sample(wc_enabled, min(2, len(wc_enabled))):
                spark = wc.draw(wc_tree, cat, rng)
                if spark:
                    oracle_lines.append(f"- Wildcard spark ({cat.rsplit('/', 1)[-1]}): {spark}")
        parts.append("\n".join(oracle_lines))

    def _is_pc(e: CodexEntry) -> bool:
        try:
            return bool(e.rpg_sheet and json.loads(e.rpg_sheet).get("is_pc"))
        except (json.JSONDecodeError, TypeError):
            return False

    facts_exist = db.query(DmFact.id).filter(DmFact.project_id == project.id).first() is not None
    if len(entries) <= 15 and not facts_exist:
        relevant = entries  # early campaign: everything fits
    else:
        relevant = [e for e in entries if _is_pc(e)]
        seen = {e.id for e in relevant}
        mention_pool = (query_text or "").lower()
        for name in present_names:
            hit = by_name.get(name.lower())
            if hit and hit.id not in seen:
                relevant.append(hit)
                seen.add(hit.id)
        for e in entries:
            if e.id not in seen and e.name and e.name.lower() in mention_pool:
                relevant.append(e)
                seen.add(e.id)
    if relevant:
        parts.append(
            "## Campaign Codex (established facts — these win over invention)\n"
            + "\n".join(_entry_line(e, name_by_id) for e in relevant)
        )
        rel_ids = [e.id for e in relevant]
        relations = (
            db.query(CodexRelation)
            .filter((CodexRelation.source_id.in_(rel_ids)) | (CodexRelation.target_id.in_(rel_ids)))
            .all()
        )
        rel_lines = []
        for r in relations:
            a, b = name_by_id.get(r.source_id), name_by_id.get(r.target_id)
            if a and b:
                rel_lines.append(f"- {a} — {r.relation_type or 'related to'} — {b}")
        if rel_lines:
            parts.append("## Relations\n" + "\n".join(rel_lines))

    threads = (
        db.query(DmFact)
        .filter(DmFact.project_id == project.id, DmFact.kind.in_(("thread", "foreshadow")), DmFact.status == "open")
        .order_by(DmFact.weight.desc(), DmFact.id.desc())
        .limit(10)
        .all()
    )
    thread_ids = {f.id for f in threads}
    recalled = [f for f in _search_facts(project.id, query_text, db) if f.id not in thread_ids] if query_text else []
    if threads or recalled:
        lines = ["## Campaign memory (honour these — consequences persist)"]
        for f in threads:
            lines.append(f"- [open {f.kind}] {f.text}")
        for f in recalled:
            lines.append(f"- {f.text}")
        parts.append("\n".join(lines))

    wc_tree, wc_enabled = _wildcards_ctx(project, db)
    if wc_tree and wc_enabled:
        listed = "\n".join(f"- {c}" for c in wc_enabled[:40])
        parts.append(
            "## Wildcard tables (random detail on demand)\n"
            "When you want a fresh concrete detail — a building, garment, object, creature, atmosphere — write "
            "[[wc:<category>]] inline in your narration. It is replaced with a random entry from that table before the "
            "player sees it, so treat it as the thing itself (e.g. \"You enter [[wc:castles]].\"). Use at most two per "
            "beat, and only where genuine randomness helps. Available categories:\n" + listed
        )

    return "\n\n".join(parts)


def _parse_json_reply(raw: str) -> dict:
    """Parse a JSON object out of a model reply that may carry markdown fences,
    reasoning blocks, or chatter around the JSON. Raises ValueError if hopeless."""
    text = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(text[start:end + 1])
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    raise ValueError(raw[:300])


def _wildcards_ctx(project: Project, db: Session) -> tuple[dict | None, list[str]]:
    """(tree, enabled category paths) for this campaign, or (None, [])."""
    settings = db.query(UserSettings).first()
    path = getattr(settings, "wildcards_path", None) if settings else None
    tree, _err = wc.get_tree(path)
    if not tree:
        return None, []
    try:
        prefs = json.loads(project.dm_prefs or "{}")
    except (json.JSONDecodeError, TypeError):
        prefs = {}
    enabled = [c for c in (prefs.get("wildcards") or []) if isinstance(c, str)]
    return tree, enabled


_WC_TOKEN_RE = re.compile(r"\[\[wc:([^\]]{1,120})\]\]")


def _wc_replacer(tree: dict, enabled: list[str]):
    """Resolve [[wc:category]] tokens against the campaign's enabled categories."""
    def replace(text: str) -> str:
        def sub(m: re.Match) -> str:
            cat = m.group(1).strip()
            target = next((c for c in enabled if c == cat), None) \
                or next((c for c in enabled if cat.lower() in c.lower()), None) \
                or (random.choice(enabled) if enabled else None)
            if not target:
                return ""
            return wc.draw(tree, target)
        return _WC_TOKEN_RE.sub(sub, text)
    return replace


def _turn_to_message(turn: DmTurn) -> dict:
    if turn.role == "dm":
        return {"role": "assistant", "content": turn.content}
    if turn.role == "roll":
        return {"role": "user", "content": f"[Dice] {turn.content}"}
    if turn.role == "system":
        return {"role": "user", "content": f"[Note] {turn.content}"}
    return {"role": "user", "content": turn.content}


# ── Sessions ──────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/dm/sessions", response_model=list[DmSessionOut])
def list_sessions(project_id: int, db: Session = Depends(get_db)):
    _get_project(project_id, db)
    return (
        db.query(DmSession)
        .filter(DmSession.project_id == project_id)
        .order_by(DmSession.created_at)
        .all()
    )


@router.post("/projects/{project_id}/dm/sessions", response_model=DmSessionOut, status_code=201)
def create_session(project_id: int, body: DmSessionCreate, db: Session = Depends(get_db)):
    _get_project(project_id, db)
    count = db.query(DmSession).filter(DmSession.project_id == project_id).count()
    session = DmSession(project_id=project_id, title=body.title or f"Session {count + 1}")
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.delete("/dm/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, db: Session = Depends(get_db)):
    db.delete(_get_session(session_id, db))
    db.commit()


# ── Preferences ───────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/dm/prefs")
def get_prefs(project_id: int, db: Session = Depends(get_db)):
    project = _get_project(project_id, db)
    try:
        return json.loads(project.dm_prefs or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}


@router.patch("/projects/{project_id}/dm/prefs")
def update_prefs(project_id: int, body: DmPrefsUpdate, db: Session = Depends(get_db)):
    project = _get_project(project_id, db)
    try:
        prefs = json.loads(project.dm_prefs or "{}")
    except (json.JSONDecodeError, TypeError):
        prefs = {}
    prefs.update(body.model_dump(exclude_none=True))
    project.dm_prefs = json.dumps(prefs)
    db.commit()
    return prefs


# ── Turns ─────────────────────────────────────────────────────────────────────

@router.get("/dm/sessions/{session_id}/turns", response_model=list[DmTurnOut])
def list_turns(session_id: int, db: Session = Depends(get_db)):
    _get_session(session_id, db)
    return db.query(DmTurn).filter(DmTurn.session_id == session_id).order_by(DmTurn.id).all()


# ── Dice ──────────────────────────────────────────────────────────────────────

@router.post("/dm/sessions/{session_id}/roll", response_model=DmTurnOut, status_code=201)
def roll_dice(session_id: int, body: DmRollRequest, db: Session = Depends(get_db)):
    session = _get_session(session_id, db)

    if body.sides not in DICE_SIDES:
        raise HTTPException(400, f"Unknown die d{body.sides} — allowed: {', '.join(f'd{s}' for s in DICE_SIDES)}")
    if not 1 <= body.count <= 20:
        raise HTTPException(400, "Count must be between 1 and 20")
    if not -100 <= body.modifier <= 100:
        raise HTTPException(400, "Modifier out of range")
    if body.advantage and (body.sides != 20 or body.count != 1):
        raise HTTPException(400, "Advantage/disadvantage only applies to a single d20")

    n_dice = 2 if body.advantage else body.count
    manual = body.manual_results is not None
    if manual:
        if len(body.manual_results) != n_dice:
            raise HTTPException(400, f"Expected {n_dice} result(s), got {len(body.manual_results)}")
        if any(not 1 <= r <= body.sides for r in body.manual_results):
            raise HTTPException(400, f"Results must be between 1 and {body.sides}")
        results = body.manual_results
    else:
        results = [random.randint(1, body.sides) for _ in range(n_dice)]

    if body.advantage == "adv":
        kept = max(results)
    elif body.advantage == "dis":
        kept = min(results)
    else:
        kept = sum(results)
    total = kept + body.modifier

    dice_str = f"d{body.sides}" if body.count == 1 else f"{body.count}d{body.sides}"
    if body.modifier:
        dice_str += f"{body.modifier:+d}"
    parts = [dice_str]
    if body.advantage:
        parts.append("(advantage)" if body.advantage == "adv" else "(disadvantage)")
    parts.append(f"→ {results}" if len(results) > 1 else f"→ {results[0]}")
    if body.advantage:
        parts.append(f"kept {kept}")
    parts.append(f"= {total}")
    content = " ".join(parts)
    if body.purpose:
        content = f"{body.purpose}: {content}"
    if manual:
        content += " (table roll)"

    rolls_json = {
        "sides": body.sides, "count": body.count, "modifier": body.modifier,
        "advantage": body.advantage, "purpose": body.purpose,
        "results": results, "kept": kept, "total": total, "manual": manual,
    }
    turn = DmTurn(session_id=session.id, role="roll", content=content, rolls=json.dumps(rolls_json))
    db.add(turn)
    db.commit()
    db.refresh(turn)
    return turn


# ── Play (streaming DM narration) ─────────────────────────────────────────────

@router.post("/dm/sessions/{session_id}/action")
async def player_action(session_id: int, body: DmActionRequest, db: Session = Depends(get_db)):
    session = _get_session(session_id, db)
    project = _get_project(session.project_id, db)

    settings = db.query(UserSettings).first()
    if not settings:
        raise HTTPException(400, "No AI provider configured")
    model = body.model or settings.default_dm_model or settings.default_chat_model or settings.default_model
    if not model:
        raise HTTPException(400, "No AI model configured")
    pdef, base_url, api_key = _resolve_provider(settings, model=model)

    if body.content.strip():
        db.add(DmTurn(session_id=session.id, role="player", content=body.content.strip()))
        db.commit()

    history = (
        db.query(DmTurn)
        .filter(DmTurn.session_id == session.id)
        .order_by(DmTurn.id.desc())
        .limit(HISTORY_TURNS)
        .all()
    )[::-1]

    recent_text = " ".join(t.content for t in history[-6:] if t.role in ("player", "dm"))
    messages = [{"role": "system", "content": _dm_system_prompt(project, db, query_text=f"{body.content} {recent_text}")}]
    messages += [_turn_to_message(t) for t in history]

    wc_tree, wc_enabled = _wildcards_ctx(project, db)
    wc_replace = _wc_replacer(wc_tree, wc_enabled) if wc_tree and wc_enabled else None

    def _emit(text: str) -> str:
        return f"data: {json.dumps({'choices': [{'delta': {'content': text}}]})}\n\n"

    async def stream_and_persist():
        collected: list[str] = []
        holdback = ""  # possible partial [[wc:…]] token spanning stream chunks
        try:
            async for chunk in stream_provider(pdef, base_url, api_key, model, messages):
                payload = chunk.strip()
                if payload.startswith("data: "):
                    data = payload[6:].strip()
                    if data and data != "[DONE]":
                        try:
                            parsed = json.loads(data)
                        except json.JSONDecodeError:
                            yield chunk
                            continue
                        if "error" not in parsed:
                            delta = (parsed.get("choices") or [{}])[0].get("delta", {}).get("content")
                            if delta:
                                if wc_replace:
                                    text = wc_replace(holdback + delta)
                                    idx = text.rfind("[[")
                                    if idx != -1 and "]]" not in text[idx:]:
                                        holdback, text = text[idx:], text[:idx]
                                    elif text.endswith("["):
                                        holdback, text = "[", text[:-1]
                                    else:
                                        holdback = ""
                                    if text:
                                        collected.append(text)
                                        yield _emit(text)
                                else:
                                    collected.append(delta)
                                    yield chunk
                                continue
                yield chunk
            if holdback:  # stream ended mid-token — flush as-is
                collected.append(holdback)
                yield _emit(holdback)
                holdback = ""
        finally:
            text = "".join(collected).strip()
            if text:
                # Fresh session: the request-scoped one may already be torn down
                # by the time the stream finishes.
                s = SessionLocal()
                try:
                    s.add(DmTurn(session_id=session.id, role="dm", content=text))
                    stored = s.get(DmSession, session.id)
                    if stored:
                        stored.updated_at = _now()
                    s.commit()
                finally:
                    s.close()

    return StreamingResponse(
        stream_and_persist(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Character generation ──────────────────────────────────────────────────────

@router.get("/dm/ruleset")
def get_ruleset():
    rules = load_ruleset()
    return {
        "stats": rules["stats"],
        "standard_array": rules["standard_array"],
        "species": rules["species"],
        "classes": rules["classes"],
        "halfblood": rules.get("halfblood", {}),
        "appearance": rules.get("appearance", {}),
    }


@router.post("/projects/{project_id}/dm/generate-character")
def generate_character(project_id: int, body: DmCharGenRequest, db: Session = Depends(get_db)):
    """Build a character draft (no save). Wizard saves it via the normal codex API."""
    _get_project(project_id, db)
    rules = load_ruleset()

    stat_rolls = None
    if body.method == "manual":
        if not body.manual_stats or len(body.manual_stats) != 6:
            raise HTTPException(400, "manual_stats must contain exactly six values")
        if any(not 3 <= v <= 18 for v in body.manual_stats):
            raise HTTPException(400, "Stat values must be between 3 and 18")
        totals = body.manual_stats
    elif body.method == "array":
        totals = rules["standard_array"]
    else:
        stat_rolls = roll_stat_pool()
        totals = [p["total"] for p in stat_rolls]

    try:
        character = build_character(
            body.species, body.char_class, totals,
            name=(body.name or None), is_pc=True,
            species2=(body.species2 or None),
            gender=body.gender,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    if stat_rolls:
        character["stat_rolls"] = stat_rolls
    return character


def _find_or_create_item(name: str, owner_id: int, db: Session, created_record: list | None = None) -> int:
    """Item codex entry for a piece of gear, deduped by name."""
    existing = (
        db.query(CodexEntry)
        .filter(
            CodexEntry.project_id == owner_id,
            CodexEntry.entry_type == "item",
            func.lower(CodexEntry.name) == name.lower(),
        )
        .first()
    )
    if existing:
        return existing.id
    item = CodexEntry(project_id=owner_id, name=name, entry_type="item", description="", color="#a3a3a3")
    item.set_aliases([])
    item.set_tags([])
    db.add(item)
    db.flush()
    if created_record is not None:
        created_record.append({"id": item.id, "name": name})
    return item.id


def _kit_to_inventory(sheet: dict, owner_id: int, db: Session, created_record: list | None = None) -> dict:
    """Convert a generated kit into a real CharacterInventory: item codex entries
    as possessions plus the class's starting currency."""
    possessions = []
    for g in sheet.get("gear") or []:
        if not g.get("name"):
            continue
        item_id = _find_or_create_item(g["name"], owner_id, db, created_record)
        possessions.append({"entry_id": item_id, "quantity": int(g.get("qty") or 1)})
    cur = (load_ruleset()["classes"].get(sheet.get("class")) or {}).get("starting_currency")
    currencies = [dict(cur)] if cur else []
    return {"currencies": currencies, "possessions": possessions, "relics": []}


def _species_label(sheet: dict) -> str:
    rules = load_ruleset()
    sp = rules["species"].get(sheet.get("species"), {})
    label = sp.get("label", sheet.get("species") or "")
    if sheet.get("species2"):
        sp2 = rules["species"].get(sheet["species2"], {})
        label = f"{label}–{sp2.get('label', sheet['species2'])} halfblood"
    return label


@router.post("/projects/{project_id}/dm/characters", response_model=CodexEntryOut, status_code=201)
def save_character(project_id: int, body: DmCharacterSaveRequest, db: Session = Depends(get_db)):
    """Persist a wizard draft as a codex entry. The kit becomes real inventory:
    item entries + possessions + starting currency."""
    project = _get_project(project_id, db)
    owner_id = _codex_owner_id(project)
    if not body.name.strip():
        raise HTTPException(400, "Name required")

    sheet = dict(body.rpg_sheet)
    inventory = _kit_to_inventory(sheet, owner_id, db)
    sheet.pop("gear", None)  # inventory is the source of truth from here on

    klass = load_ruleset()["classes"].get(sheet.get("class"), {})
    entry = CodexEntry(
        project_id=owner_id,
        name=body.name.strip(),
        entry_type="character",
        description=body.description or "",
        species=_species_label(sheet),
        subtype=klass.get("label"),
        gender=body.gender or sheet.get("gender"),
        color="#38bdf8",
        is_main_char=1,
        inventory=json.dumps(inventory),
        rpg_sheet=json.dumps(sheet),
    )
    entry.set_aliases([])
    entry.set_tags([])
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return CodexEntryOut.from_orm_entry(entry)


# ── Scene tracking ────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/dm/scene", response_model=DmSceneOut | None)
def get_current_scene(project_id: int, db: Session = Depends(get_db)):
    _get_project(project_id, db)
    scene = (
        db.query(DmScene)
        .filter(DmScene.project_id == project_id, DmScene.is_current == 1)
        .order_by(DmScene.id.desc())
        .first()
    )
    if not scene:
        return None
    out = DmSceneOut.model_validate(scene)
    out.oracle = draw_for_scene(scene.id)
    return out


@router.get("/dm/style")
def get_style():
    """Style guardrails for the client-side cliché check."""
    return {"ban_list": ban_list()}


@router.get("/dm/wildcards/tree")
def get_wildcards_tree(db: Session = Depends(get_db)):
    """Browsable category overview of the configured wildcard source."""
    settings = db.query(UserSettings).first()
    path = getattr(settings, "wildcards_path", None) if settings else None
    if not path:
        return {"available": False, "error": None, "categories": []}
    tree, err = wc.get_tree(path)
    if not tree:
        return {"available": False, "error": err, "categories": []}
    return {"available": True, "error": None, "categories": wc.tree_overview(tree)}


@router.delete("/dm/turns/{turn_id}", status_code=204)
def delete_turn(turn_id: int, db: Session = Depends(get_db)):
    """Delete a DM narration for a reroll. Only the session's last turn may go —
    rerolling mid-history would corrupt the transcript."""
    turn = db.get(DmTurn, turn_id)
    if not turn:
        raise HTTPException(404, "Turn not found")
    if turn.role != "dm":
        raise HTTPException(400, "Only DM narration can be rerolled")
    last = (
        db.query(DmTurn)
        .filter(DmTurn.session_id == turn.session_id)
        .order_by(DmTurn.id.desc())
        .first()
    )
    if last.id != turn.id:
        raise HTTPException(400, "Only the latest turn can be rerolled")
    db.delete(turn)
    db.commit()


# ── Effects (state changes proposed by the DM) ────────────────────────────────

def _apply_effects(project: Project, effects: dict, session_id: int | None, db: Session) -> dict:
    """Apply an effects dict to codex + scene state. Returns an `applied` record
    that carries everything needed to undo the changes."""
    applied: dict = {"created_entries": [], "updated_entries": [], "scene": None}
    owner_id = _codex_owner_id(project)

    existing_names = {
        (e.name or "").lower(): e.id
        for e in db.query(CodexEntry).filter(CodexEntry.project_id == owner_id).all()
    }

    for npc in effects.get("new_npcs") or []:
        if not isinstance(npc, dict):
            continue
        name = (npc.get("name") or "").strip() or None
        if name and name.lower() in existing_names:
            continue  # already in the codex — extraction over-eagerness
        gen = generate_npc(npc.get("species"), npc.get("class"), gender=npc.get("gender"))
        final_name = name or gen["name"]
        sheet = gen["rpg_sheet"]
        inventory = _kit_to_inventory(sheet, owner_id, db, applied["created_entries"])
        sheet.pop("gear", None)
        entry = CodexEntry(
            project_id=owner_id,
            name=final_name,
            entry_type="character",
            description=(npc.get("role") or "").strip(),
            species=gen["species"],
            gender=sheet.get("gender"),
            color="#8b5cf6",
            inventory=json.dumps(inventory),
            rpg_sheet=json.dumps(sheet),
        )
        entry.set_aliases([])
        entry.set_tags([])
        db.add(entry)
        db.flush()
        existing_names[final_name.lower()] = entry.id
        applied["created_entries"].append({"id": entry.id, "name": final_name})

    for upd in effects.get("codex_updates") or []:
        if not isinstance(upd, dict) or not upd.get("entry_id"):
            continue
        entry = db.get(CodexEntry, upd["entry_id"])
        if not entry or entry.project_id not in (project.id, owner_id):
            continue
        prev_sheet = entry.rpg_sheet
        prev_inventory = entry.inventory
        try:
            sheet = json.loads(entry.rpg_sheet or "{}")
        except (json.JSONDecodeError, TypeError):
            sheet = {}
        sheet.setdefault("conditions", [])
        try:
            inventory = json.loads(entry.inventory or "")
        except (json.JSONDecodeError, TypeError):
            inventory = None
        if not isinstance(inventory, dict):
            inventory = {}
        inventory.setdefault("currencies", [])
        inventory.setdefault("possessions", [])
        inventory.setdefault("relics", [])

        # Gear operates on the real codex inventory (possessions of item entries)
        for item in upd.get("gear_add") or []:
            if not isinstance(item, dict) or not item.get("name"):
                continue
            qty = max(1, int(item.get("qty") or 1))
            item_id = _find_or_create_item(item["name"], owner_id, db, applied["created_entries"])
            match = next((p for p in inventory["possessions"] if p.get("entry_id") == item_id), None)
            if match:
                match["quantity"] = match.get("quantity", 1) + qty
            else:
                inventory["possessions"].append({"entry_id": item_id, "quantity": qty})

        for item in upd.get("gear_remove") or []:
            name = item.get("name") if isinstance(item, dict) else str(item)
            if not name:
                continue
            qty = max(1, int(item.get("qty") or 1)) if isinstance(item, dict) else 1
            owned_item = (
                db.query(CodexEntry)
                .filter(
                    CodexEntry.project_id == owner_id,
                    CodexEntry.entry_type == "item",
                    func.lower(CodexEntry.name) == name.lower(),
                )
                .first()
            )
            if not owned_item:
                continue
            match = next((p for p in inventory["possessions"] if p.get("entry_id") == owned_item.id), None)
            if match:
                match["quantity"] = match.get("quantity", 1) - qty
                if match["quantity"] <= 0:
                    inventory["possessions"].remove(match)

        for cd in upd.get("currency_delta") or []:
            if not isinstance(cd, dict) or not cd.get("name"):
                continue
            amount = int(cd.get("amount") or 0)
            match = next((c for c in inventory["currencies"] if c.get("name", "").lower() == cd["name"].lower()), None)
            if match:
                match["amount"] = max(0, match.get("amount", 0) + amount)
            elif amount > 0:
                inventory["currencies"].append({"name": cd["name"], "amount": amount})

        delta = upd.get("hp_delta")
        if delta and isinstance(sheet.get("hp"), dict):
            hp = sheet["hp"]
            hp["current"] = max(0, min(hp.get("max", 0), hp.get("current", 0) + int(delta)))

        for cond in upd.get("conditions_add") or []:
            if cond and cond not in sheet["conditions"]:
                sheet["conditions"].append(cond)
        for cond in upd.get("conditions_remove") or []:
            if cond in sheet["conditions"]:
                sheet["conditions"].remove(cond)

        entry.rpg_sheet = json.dumps(sheet)
        entry.inventory = json.dumps(inventory)
        applied["updated_entries"].append({
            "id": entry.id, "prev_rpg_sheet": prev_sheet, "prev_inventory": prev_inventory,
        })

    sc = effects.get("scene")
    if isinstance(sc, dict) and (sc.get("title") or sc.get("situation")):
        current = (
            db.query(DmScene)
            .filter(DmScene.project_id == project.id, DmScene.is_current == 1)
            .order_by(DmScene.id.desc())
            .first()
        )
        location_id = None
        if sc.get("location_name"):
            location_id = existing_names.get(sc["location_name"].lower())
        npcs_json = json.dumps(sc.get("present_npcs") or [])

        if current and not sc.get("new_scene"):
            applied["scene"] = {
                "mode": "updated", "scene_id": current.id,
                "prev": {
                    "title": current.title, "location_entry_id": current.location_entry_id,
                    "present_npcs": current.present_npcs, "situation": current.situation,
                },
            }
            current.title = sc.get("title") or current.title
            current.location_entry_id = location_id or current.location_entry_id
            current.present_npcs = npcs_json
            current.situation = sc.get("situation") or current.situation
        else:
            if current:
                current.is_current = 0
            scene = DmScene(
                project_id=project.id, session_id=session_id,
                title=sc.get("title") or "Scene",
                location_entry_id=location_id,
                present_npcs=npcs_json,
                situation=sc.get("situation"),
                is_current=1,
            )
            db.add(scene)
            db.flush()
            applied["scene"] = {
                "mode": "created", "scene_id": scene.id,
                "prev_current_id": current.id if current else None,
            }

    return applied


@router.post("/dm/turns/{turn_id}/effects", response_model=DmTurnOut)
def apply_turn_effects(turn_id: int, effects: dict, db: Session = Depends(get_db)):
    """Apply an effects dict to a turn (used by /extract; also callable directly)."""
    turn = db.get(DmTurn, turn_id)
    if not turn:
        raise HTTPException(404, "Turn not found")
    session = _get_session(turn.session_id, db)
    project = _get_project(session.project_id, db)

    stored = None
    if turn.effects:
        try:
            stored = json.loads(turn.effects)
        except (json.JSONDecodeError, TypeError):
            stored = None
    if stored and stored.get("applied") and not stored.get("undone"):
        raise HTTPException(409, "Effects already applied to this turn — undo first")

    applied = _apply_effects(project, effects, session.id, db)
    turn.effects = json.dumps({"effects": effects, "applied": applied, "undone": False})
    db.commit()
    db.refresh(turn)
    return turn


@router.post("/dm/turns/{turn_id}/undo-effects", response_model=DmTurnOut)
def undo_turn_effects(turn_id: int, db: Session = Depends(get_db)):
    turn = db.get(DmTurn, turn_id)
    if not turn:
        raise HTTPException(404, "Turn not found")
    try:
        stored = json.loads(turn.effects or "")
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(400, "Turn has no effects")
    if not stored.get("applied") or stored.get("undone"):
        raise HTTPException(400, "Nothing to undo")
    applied = stored["applied"]

    for created in applied.get("created_entries") or []:
        entry = db.get(CodexEntry, created["id"])
        if entry:
            db.delete(entry)

    for updated in applied.get("updated_entries") or []:
        entry = db.get(CodexEntry, updated["id"])
        if entry:
            entry.rpg_sheet = updated.get("prev_rpg_sheet")
            if "prev_inventory" in updated:
                entry.inventory = updated.get("prev_inventory")

    sc = applied.get("scene")
    if sc:
        scene = db.get(DmScene, sc["scene_id"])
        if sc["mode"] == "created":
            if scene:
                db.delete(scene)
            if sc.get("prev_current_id"):
                prev = db.get(DmScene, sc["prev_current_id"])
                if prev:
                    prev.is_current = 1
        elif sc["mode"] == "updated" and scene:
            for field, value in sc["prev"].items():
                setattr(scene, field, value)

    stored["undone"] = True
    turn.effects = json.dumps(stored)
    db.commit()
    db.refresh(turn)
    return turn


def _extract_user_content(turn: DmTurn, project: Project, db: Session) -> str:
    owner_id = _codex_owner_id(project)
    entries = db.query(CodexEntry).filter(CodexEntry.project_id == owner_id).all()
    entity_lines = [f"- id={e.id} | {e.name} [{e.entry_type}]" for e in entries]
    rules = load_ruleset()

    current = (
        db.query(DmScene)
        .filter(DmScene.project_id == project.id, DmScene.is_current == 1)
        .order_by(DmScene.id.desc())
        .first()
    )
    scene_line = "none"
    if current:
        scene_line = f"{current.title} — {current.situation or ''}"

    return (
        f"## Allowed species\n{', '.join(rules['species'])}\n\n"
        f"## Allowed classes\n{', '.join(rules['classes'])}\n\n"
        f"## Known entities\n" + ("\n".join(entity_lines) or "none") + "\n\n"
        f"## Current scene\n{scene_line}\n\n"
        f"## DM narration to record\n{turn.content}"
    )


@router.post("/dm/turns/{turn_id}/extract", response_model=DmTurnOut)
async def extract_turn_effects(turn_id: int, db: Session = Depends(get_db)):
    """Bookkeeping pass: ask a (cold, cheap) model what the narration changed, then apply it."""
    turn = db.get(DmTurn, turn_id)
    if not turn:
        raise HTTPException(404, "Turn not found")
    if turn.role != "dm":
        raise HTTPException(400, "Effects are extracted from DM turns only")
    session = _get_session(turn.session_id, db)
    project = _get_project(session.project_id, db)

    stored = None
    if turn.effects:
        try:
            stored = json.loads(turn.effects)
        except (json.JSONDecodeError, TypeError):
            stored = None
    if stored and stored.get("applied") and not stored.get("undone"):
        return turn  # idempotent: already extracted

    settings = db.query(UserSettings).first()
    if not settings:
        raise HTTPException(400, "No AI provider configured")
    model = settings.default_codex_model or settings.default_model
    if not model:
        raise HTTPException(400, "No AI model configured")
    pdef, base_url, api_key = _resolve_provider(settings, model=model)

    row = db.query(AIPrompt).filter(AIPrompt.built_in_key == "dm_extract").first()
    if not row:
        raise HTTPException(500, "dm_extract prompt missing")
    system = row.system.replace("{{LANGUAGE}}", _project_language(project))

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": _extract_user_content(turn, project, db)},
    ]
    try:
        result = await post_provider(pdef, base_url, api_key, model, messages, timeout=60)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"Provider error: {exc.response.text}")

    raw = result["choices"][0]["message"]["content"].strip()
    try:
        effects = _parse_json_reply(raw)
    except ValueError as exc:
        raise HTTPException(502, f"Extraction did not return valid JSON: {exc}")

    applied = _apply_effects(project, effects, session.id, db)
    turn.effects = json.dumps({"effects": effects, "applied": applied, "undone": False})
    db.commit()
    db.refresh(turn)
    return turn


# ── Memory pyramid (L1 facts / L2 session summary / L3 campaign brief) ────────

FACTS_TURN_THRESHOLD = 10


async def _ai_complete(project: Project, prompt_key: str, user_content: str, db: Session) -> str:
    """Cold completion for bookkeeping ops, using the codex-model preference."""
    settings = db.query(UserSettings).first()
    if not settings:
        raise HTTPException(400, "No AI provider configured")
    model = settings.default_codex_model or settings.default_model
    if not model:
        raise HTTPException(400, "No AI model configured")
    pdef, base_url, api_key = _resolve_provider(settings, model=model)

    row = db.query(AIPrompt).filter(AIPrompt.built_in_key == prompt_key).first()
    if not row:
        raise HTTPException(500, f"{prompt_key} prompt missing")
    system = row.system.replace("{{LANGUAGE}}", _project_language(project))

    try:
        result = await post_provider(
            pdef, base_url, api_key, model,
            [{"role": "system", "content": system}, {"role": "user", "content": user_content}],
            timeout=90,
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"Provider error: {exc.response.text}")
    return result["choices"][0]["message"]["content"].strip()


def _format_transcript(turns: list[DmTurn]) -> str:
    lines = []
    for t in turns:
        if t.role == "player":
            lines.append(f"Player: {t.content}")
        elif t.role == "dm":
            lines.append(f"DM: {t.content}")
        elif t.role == "roll":
            lines.append(f"[Dice] {t.content}")
        else:
            lines.append(f"[Note] {t.content}")
    return "\n".join(lines)


@router.get("/projects/{project_id}/dm/facts", response_model=list[DmFactOut])
def list_facts(
    project_id: int,
    kind: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    _get_project(project_id, db)
    q = db.query(DmFact).filter(DmFact.project_id == project_id)
    if kind:
        q = q.filter(DmFact.kind.in_(kind.split(",")))
    if status:
        q = q.filter(DmFact.status == status)
    return q.order_by(DmFact.id.desc()).limit(200).all()


@router.post("/dm/sessions/{session_id}/consolidate")
async def consolidate_session(session_id: int, force: bool = False, db: Session = Depends(get_db)):
    """Extract atomic facts (L1) from turns not yet covered. No-op below the
    turn threshold unless forced."""
    session = _get_session(session_id, db)
    project = _get_project(session.project_id, db)

    last_processed = (
        db.query(func.max(DmFact.source_turn_id))
        .join(DmTurn, DmFact.source_turn_id == DmTurn.id)
        .filter(DmTurn.session_id == session.id)
        .scalar()
    ) or 0
    pending = (
        db.query(DmTurn)
        .filter(DmTurn.session_id == session.id, DmTurn.id > last_processed)
        .order_by(DmTurn.id)
        .all()
    )
    substantive = [t for t in pending if t.role in ("player", "dm")]
    if len(substantive) < FACTS_TURN_THRESHOLD and not force:
        return {"extracted": 0, "pending_turns": len(substantive)}
    if not substantive:
        return {"extracted": 0, "pending_turns": 0}

    known = db.query(DmFact).filter(DmFact.project_id == project.id).order_by(DmFact.id.desc()).limit(40).all()
    open_threads = [f for f in known if f.kind in ("thread", "foreshadow") and f.status == "open"]
    owner_id = _codex_owner_id(project)
    entries = db.query(CodexEntry).filter(CodexEntry.project_id == owner_id).all()
    name_to_id = {e.name.lower(): e.id for e in entries}

    user_content = (
        "## Known facts (do not repeat)\n" + ("\n".join(f"- {f.text}" for f in known) or "none") + "\n\n"
        "## Open threads\n" + ("\n".join(f"- {f.text}" for f in open_threads) or "none") + "\n\n"
        "## Codex entries\n" + (", ".join(e.name for e in entries) or "none") + "\n\n"
        "## Transcript stretch\n" + _format_transcript(pending)
    )
    raw = await _ai_complete(project, "dm_facts", user_content, db)
    try:
        parsed = _parse_json_reply(raw)
    except ValueError as exc:
        raise HTTPException(502, f"Fact extraction did not return valid JSON: {exc}")

    last_turn_id = pending[-1].id
    created = 0
    for fact in parsed.get("facts") or []:
        if not isinstance(fact, dict) or not (fact.get("text") or "").strip():
            continue
        kind = fact.get("kind") if fact.get("kind") in ("fact", "thread", "secret", "foreshadow") else "fact"
        entry_id = name_to_id.get((fact.get("entry_name") or "").lower())
        db.add(DmFact(
            project_id=project.id, kind=kind, text=fact["text"].strip(),
            codex_entry_id=entry_id, source_turn_id=last_turn_id,
        ))
        created += 1
        resolves = (fact.get("resolves") or "").strip()
        if resolves:
            for thread in open_threads:
                if thread.text.strip() == resolves:
                    thread.status = "resolved"
    db.commit()
    return {"extracted": created, "pending_turns": 0}


@router.post("/dm/sessions/{session_id}/end")
async def end_session(session_id: int, db: Session = Depends(get_db)):
    """End a session. The status flips even when AI is unavailable; summary (L2)
    and campaign brief (L3) are best-effort on top."""
    session = _get_session(session_id, db)
    project = _get_project(session.project_id, db)
    if session.status == "ended":
        raise HTTPException(400, "Session already ended")

    session.status = "ended"
    db.commit()

    warning = None
    try:
        # Sweep remaining turns into facts first (best-effort)
        try:
            await consolidate_session(session_id, force=True, db=db)
        except HTTPException:
            pass

        turns = db.query(DmTurn).filter(DmTurn.session_id == session.id).order_by(DmTurn.id).all()
        if turns:
            summary = await _ai_complete(
                project, "dm_summary",
                f"## Session transcript\n{_format_transcript(turns)}", db,
            )
            session.summary = summary
            db.commit()

        summaries = (
            db.query(DmSession)
            .filter(DmSession.project_id == project.id, DmSession.summary.isnot(None))
            .order_by(DmSession.created_at)
            .all()
        )
        threads = (
            db.query(DmFact)
            .filter(DmFact.project_id == project.id, DmFact.kind.in_(("thread", "foreshadow")), DmFact.status == "open")
            .order_by(DmFact.weight.desc(), DmFact.id.desc())
            .all()
        )
        if summaries:
            user_content = (
                ("## Current brief\n" + project.campaign_brief + "\n\n" if project.campaign_brief else "")
                + "## Session summaries\n"
                + "\n\n".join(f"### {s.title}\n{s.summary}" for s in summaries)
                + "\n\n## Open threads\n"
                + ("\n".join(f"- {f.text}" for f in threads) or "none")
            )
            project.campaign_brief = await _ai_complete(project, "dm_brief", user_content, db)
            db.commit()
    except HTTPException as exc:
        warning = exc.detail
    except Exception as exc:  # noqa: BLE001 — session end must never fail outright
        warning = str(exc)

    db.refresh(session)
    return {"session": DmSessionOut.model_validate(session).model_dump(), "warning": warning}
