import json
import re
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session, selectinload
import httpx

from ai_providers import PROVIDER_MAP, stream_provider, post_provider, ProviderDef
from crypto import decrypt
from database import get_db
from models import Scene, Chapter, Act, Project, UserSettings, CodexEntry, AIPrompt
from schemas import AIGenerateRequest, KiGenerateRequest, ChatRequest, TranslateRequest, StructureRequest

router = APIRouter(prefix="/api/ai", tags=["ai"])

# BCP 47 base tag → full language name
LANGUAGE_NAMES: dict[str, str] = {
    "en": "English", "de": "German", "fr": "French", "es": "Spanish",
    "it": "Italian", "pt": "Portuguese", "nl": "Dutch", "ru": "Russian",
    "ja": "Japanese", "zh": "Chinese", "ko": "Korean", "pl": "Polish",
    "sv": "Swedish", "da": "Danish", "fi": "Finnish", "nb": "Norwegian",
    "no": "Norwegian", "cs": "Czech", "sk": "Slovak", "hu": "Hungarian",
    "ro": "Romanian", "tr": "Turkish", "ar": "Arabic", "he": "Hebrew",
    "uk": "Ukrainian", "bg": "Bulgarian", "hr": "Croatian", "sr": "Serbian",
    "el": "Greek", "ca": "Catalan", "lt": "Lithuanian", "lv": "Latvian",
    "et": "Estonian", "sl": "Slovenian", "mt": "Maltese", "ga": "Irish",
}


def _resolve_project_id(scene: Scene, db: Session) -> int | None:
    """Resolve scene → project_id in a single SQL join (avoids 3 chained db.get calls)."""
    row = db.execute(
        text("""
            SELECT a.project_id FROM chapters c
            JOIN acts a ON a.id = c.act_id
            WHERE c.id = :cid
        """),
        {"cid": scene.chapter_id},
    ).first()
    return row[0] if row else None


def _project_language(scene: Scene, db: Session) -> str:
    """Return the full language name for the project this scene belongs to."""
    project_id = _resolve_project_id(scene, db)
    lang_code = "en"
    if project_id:
        row = db.execute(
            text("SELECT book_meta FROM projects WHERE id = :pid"),
            {"pid": project_id},
        ).first()
        if row and row[0]:
            try:
                lang_code = json.loads(row[0]).get("language") or "en"
            except (json.JSONDecodeError, TypeError):
                pass
    base = lang_code.split("-")[0].lower()
    return LANGUAGE_NAMES.get(base, lang_code)

MODE_SYSTEM_PROMPTS = {
    "continue": "You are a creative writing assistant. Continue the story naturally, matching the existing tone and style.",
    "rewrite": "You are a creative writing assistant. Rewrite the provided text to improve it while preserving the core meaning and plot.",
    "brainstorm": "You are a creative writing assistant. Generate creative ideas and suggestions based on the provided context.",
    "ask": "You are a creative writing assistant. Answer the question thoughtfully based on the story context provided.",
    "custom": "You are a creative writing assistant helping with a creative writing project.",
}


def _build_context(scene: Scene, db: Session) -> str:
    # Single join to get project_id — avoids 3 chained db.get calls
    project_id = _resolve_project_id(scene, db)
    if not project_id:
        return f"## Current Scene: {scene.title or 'Scene'}\n\n{re.sub(r'<[^>]+>', '', scene.content or '')}"
    project = db.get(Project, project_id)

    codex_entries = db.query(CodexEntry).filter(CodexEntry.project_id == project_id).all()
    codex_text = ""
    if codex_entries:
        lines = ["## World Information (Codex)"]
        for entry in codex_entries:
            aliases = entry.get_aliases()
            alias_str = f" (also: {', '.join(aliases)})" if aliases else ""
            lines.append(f"**{entry.name}** [{entry.entry_type}]{alias_str}: {entry.description or ''}")
        codex_text = "\n".join(lines)

    # Load all acts + chapters + scenes in 3 queries (selectinload) instead of N+1
    all_acts = (
        db.query(Act)
        .filter(Act.project_id == project_id)
        .options(selectinload(Act.chapters).selectinload(Chapter.scenes))
        .order_by(Act.order_index)
        .all()
    )
    all_chapters = [
        ch
        for a in all_acts
        for ch in sorted(a.chapters, key=lambda c: c.order_index)
    ]

    prev_scenes = []
    found = False
    for ch in all_chapters:
        for sc in ch.scenes:
            if sc.id == scene.id:
                found = True
                break
            prev_scenes.append(sc)
        if found:
            break

    prev_scenes_text = ""
    recent_prev = prev_scenes[-2:]
    if recent_prev:
        lines = ["## Previous Scenes"]
        for sc in recent_prev:
            lines.append(f"### {sc.title or 'Scene'}")
            lines.append(re.sub(r"<[^>]+>", "", sc.content or ""))
        prev_scenes_text = "\n".join(lines)

    current_content = re.sub(r"<[^>]+>", "", scene.content or "")

    parts = [f"# Project: {project.title}"]
    if codex_text:
        parts.append(codex_text)
    if prev_scenes_text:
        parts.append(prev_scenes_text)
    parts.append(f"## Current Scene: {scene.title or 'Scene'}")
    parts.append(current_content)

    return "\n\n".join(parts)


def _parse_providers_cfg(settings: UserSettings) -> dict:
    try:
        return json.loads(settings.ai_providers_cfg or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}


def _resolve_provider(settings: UserSettings, model: str | None = None) -> tuple[ProviderDef, str, str | None]:
    """Return (ProviderDef, base_url, api_key) for the provider that should handle this request.

    If *model* is given and it has an entry in the model→provider map (stored in
    ai_providers_cfg._model_provider_map), that provider is used instead of the
    active one.  This lets a user keep OpenRouter as the default while routing
    a locally-favourited Qwen model to AnythingLLM automatically.

    Falls back to the legacy openrouter_api_key field so existing users keep
    working without reconfiguring anything.
    """
    cfg = _parse_providers_cfg(settings)
    active_id = getattr(settings, "active_provider", None) or "openrouter"

    # Per-model provider override
    provider_id = active_id
    if model:
        mapped = cfg.get("_model_provider_map", {}).get(model)
        if mapped and mapped in PROVIDER_MAP:
            provider_id = mapped

    pdef = PROVIDER_MAP.get(provider_id) or PROVIDER_MAP.get(active_id)
    if not pdef:
        raise HTTPException(400, f"Unknown provider: {provider_id}")

    prov_cfg = cfg.get(provider_id, {})
    base_url = prov_cfg.get("base_url") or pdef.default_base_url

    encrypted = prov_cfg.get("api_key")
    api_key = decrypt(encrypted) if encrypted else None

    # Backward compat: legacy openrouter_api_key
    if provider_id == "openrouter" and not api_key and settings.openrouter_api_key:
        api_key = decrypt(settings.openrouter_api_key)

    if pdef.requires_key and not api_key:
        raise HTTPException(400, f"{pdef.name} API key not configured. Add it in Settings → AI Provider.")

    return pdef, base_url, api_key


@router.post("/generate")
async def generate(body: AIGenerateRequest, db: Session = Depends(get_db)):
    scene = db.get(Scene, body.scene_id)
    if not scene:
        raise HTTPException(404, "Scene not found")

    settings = db.query(UserSettings).first()
    if not settings:
        raise HTTPException(400, "No AI provider configured")
    model = body.model or settings.default_model
    if not model:
        raise HTTPException(400, "No AI model configured")
    pdef, base_url, api_key = _resolve_provider(settings, model=model)

    context = _build_context(scene, db)
    system_prompt = MODE_SYSTEM_PROMPTS.get(body.mode, MODE_SYSTEM_PROMPTS["custom"])

    user_message = context
    if body.mode == "custom" and body.custom_prompt:
        user_message = f"{context}\n\n## Instruction\n{body.custom_prompt}"
    elif body.mode == "ask" and body.custom_prompt:
        user_message = f"{context}\n\n## Question\n{body.custom_prompt}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    return StreamingResponse(
        stream_provider(pdef, base_url, api_key, model, messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _build_ki_context(scene: Scene, body: KiGenerateRequest, db: Session) -> dict[str, str]:
    """Build placeholder values for Ki prompt templates."""
    scene_content = re.sub(r"<[^>]+>", "", scene.content or "")
    scene_title = scene.title or "Untitled Scene"

    codex_lines: list[str] = []
    if body.codex_ids:
        entries = db.query(CodexEntry).filter(CodexEntry.id.in_(body.codex_ids)).all()
        for e in entries:
            aliases = e.get_aliases()
            alias_str = f" (also: {', '.join(aliases)})" if aliases else ""
            codex_lines.append(f"**{e.name}** [{e.entry_type}]{alias_str}: {e.description or ''}")
    codex_text = "\n".join(codex_lines) if codex_lines else "No codex entries selected."

    extra_lines: list[str] = []
    if body.extra_scene_ids:
        extra = db.query(Scene).filter(Scene.id.in_(body.extra_scene_ids)).all()
        for sc in extra:
            extra_lines.append(f"### {sc.title or 'Untitled Scene'}")
            extra_lines.append(re.sub(r"<[^>]+>", "", sc.content or ""))
    extra_text = "\n".join(extra_lines) if extra_lines else "No additional scenes selected."

    return {
        "SCENE_CONTENT": scene_content,
        "SCENE_TITLE": scene_title,
        "CODEX_ENTRIES": codex_text,
        "EXTRA_SCENES": extra_text,
        "USER_PROMPT": body.prompt or "",
        "USER_NOTES": body.prompt or "",
        "ENTRY_TYPE": body.entry_type or "character",
        "LANGUAGE": _project_language(scene, db),
    }


def _fill_placeholders(template: str, values: dict[str, str]) -> str:
    for key, value in values.items():
        template = template.replace(f"{{{{{key}}}}}", value)
    return template


# JSON schema hints used when create_entry=True
_ENTRY_JSON_SCHEMAS: dict[str, str] = {
    "character": (
        '{\n'
        '  "name": "full name",\n'
        '  "entry_type": "character",\n'
        '  "aliases": ["alias or nickname"],\n'
        '  "species": "species or race",\n'
        '  "tags": ["tag1", "tag2"],\n'
        '  "description": "Alter: ...\\n\\nAppearance:\\nHaut: ...\\nAugen: ...\\nHaar: ...\\nKörperbau: ...\\n\\nPersonality:\\ntraits:\\n- ...\\n- ...\\n\\nAbilities:\\n- ...\\n\\nBackground:\\n- ..."\n'
        '}'
    ),
    "location": (
        '{\n'
        '  "name": "location name",\n'
        '  "entry_type": "location",\n'
        '  "aliases": [],\n'
        '  "subtype": "type of location (city, forest, ruin…)",\n'
        '  "tags": ["tag1"],\n'
        '  "description": "Geography:\\n...\\n\\nAtmosphere:\\n...\\n\\nNotable features:\\n- ...\\n\\nInhabitants:\\n...\\n\\nHistory:\\n..."\n'
        '}'
    ),
    "item": (
        '{\n'
        '  "name": "item name",\n'
        '  "entry_type": "item",\n'
        '  "aliases": [],\n'
        '  "subtype": "item type (weapon, artifact, tool…)",\n'
        '  "tags": [],\n'
        '  "description": "Appearance:\\n...\\n\\nFunction:\\n...\\n\\nOwner:\\n...\\n\\nHistory:\\n...\\n\\nSignificance:\\n..."\n'
        '}'
    ),
    "lore": (
        '{\n'
        '  "name": "concept or system name",\n'
        '  "entry_type": "lore",\n'
        '  "aliases": [],\n'
        '  "subtype": "magic system / religion / event / faction…",\n'
        '  "tags": [],\n'
        '  "description": "Description:\\n...\\n\\nScope:\\n...\\n\\nOrigin:\\n...\\n\\nKnown facts:\\n- ...\\n\\nOpen questions:\\n..."\n'
        '}'
    ),
}


@router.post("/ki")
async def ki_generate(body: KiGenerateRequest, db: Session = Depends(get_db)):
    """Streaming AI generation for the /ki editor command (SSE)."""
    scene = db.get(Scene, body.scene_id)
    if not scene:
        raise HTTPException(404, "Scene not found")

    settings = db.query(UserSettings).first()
    if not settings:
        raise HTTPException(400, "No AI provider configured")
    model = body.model or settings.default_model
    if not model:
        raise HTTPException(400, "No AI model configured")
    pdef, base_url, api_key = _resolve_provider(settings, model=model)

    if body.prompt_id:
        # Use a stored prompt template
        prompt_row = db.get(AIPrompt, body.prompt_id)
        if not prompt_row:
            raise HTTPException(404, "Prompt not found")
        ctx = _build_ki_context(scene, body, db)
        effective_wc = body.word_count if body.word_count is not None else (prompt_row.word_count or 400)
        ctx["WORD_COUNT"] = str(effective_wc)
        system = _fill_placeholders(prompt_row.system or "You are a creative writing assistant.", ctx)
        user_msg = _fill_placeholders(prompt_row.user_template or "", ctx)
        language = ctx["LANGUAGE"]
    else:
        # Legacy inline behaviour
        parts: list[str] = []
        if body.codex_ids:
            entries = db.query(CodexEntry).filter(CodexEntry.id.in_(body.codex_ids)).all()
            if entries:
                lines = ["## World Information (Codex)"]
                for e in entries:
                    aliases = e.get_aliases()
                    alias_str = f" (also: {', '.join(aliases)})" if aliases else ""
                    lines.append(f"**{e.name}** [{e.entry_type}]{alias_str}: {e.description or ''}")
                parts.append("\n".join(lines))
        if body.extra_scene_ids:
            extra = db.query(Scene).filter(Scene.id.in_(body.extra_scene_ids)).all()
            if extra:
                lines = ["## Reference Scenes"]
                for sc in extra:
                    lines.append(f"### {sc.title or 'Untitled Scene'}")
                    lines.append(re.sub(r"<[^>]+>", "", sc.content or ""))
                parts.append("\n".join(lines))
        current_text = re.sub(r"<[^>]+>", "", scene.content or "")
        parts.append(f"## Current Scene: {scene.title or 'Untitled Scene'}\n{current_text}")
        context = "\n\n".join(parts)
        system = "You are a creative writing assistant. Write naturally, matching the existing tone and style."
        user_msg = f"{context}\n\n## Instruction\n{body.prompt}" if body.prompt else context
        language = _project_language(scene, db)

    # create_entry / update_entry_id mode: override system to demand structured JSON output
    existing_entry: CodexEntry | None = None
    if body.update_entry_id:
        existing_entry = db.get(CodexEntry, body.update_entry_id)
        if not existing_entry:
            raise HTTPException(404, "Codex entry not found")

    if body.create_entry or existing_entry:
        entry_type = (existing_entry.entry_type if existing_entry else (body.entry_type or "character")).lower()
        schema = _ENTRY_JSON_SCHEMAS.get(entry_type, _ENTRY_JSON_SCHEMAS["character"])
        if existing_entry:
            existing_json = json.dumps({
                "name": existing_entry.name,
                "entry_type": existing_entry.entry_type,
                "aliases": existing_entry.get_aliases(),
                "species": existing_entry.species,
                "subtype": existing_entry.subtype,
                "tags": existing_entry.get_tags(),
                "description": existing_entry.description or "",
            }, ensure_ascii=False, indent=2)
            system += (
                f"\n\nCRITICAL OUTPUT FORMAT: Your ENTIRE response must be a single valid JSON object. "
                f"No markdown code fences, no preamble, no commentary outside the JSON. "
                f"You are UPDATING an existing codex entry, not creating a new one. Here is its current data:\n"
                f"{existing_json}\n\n"
                f"Merge new information found in the source material into this entry: keep existing facts that "
                f"are still accurate, and add or refine details based on the new information. Do not remove or "
                f"contradict existing information unless the source material clearly contradicts it. "
                f"Use exactly this structure for a {entry_type}:\n{schema}\n"
                f"Write every descriptive text value in {language}. "
                f"The description field uses labelled sections separated by blank lines, matching the schema above. "
                f"Return the full, complete updated entry — not just the new information."
            )
        else:
            system += (
                f"\n\nCRITICAL OUTPUT FORMAT: Your ENTIRE response must be a single valid JSON object. "
                f"No markdown code fences, no preamble, no commentary outside the JSON. "
                f"Use exactly this structure for a {entry_type}:\n{schema}\n"
                f"Write every descriptive text value in {language}. "
                f"The description field uses labelled sections separated by blank lines, matching the schema above. "
                f"Extract only what is present in the source — do not invent facts."
            )

    messages = [
        {"role": "system", "content": system},
        {"role": "user",   "content": user_msg},
    ]

    return StreamingResponse(
        stream_provider(pdef, base_url, api_key, model, messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/translate")
async def translate_text(body: TranslateRequest, db: Session = Depends(get_db)):
    """Translate a block of text using the configured AI model."""
    settings = db.query(UserSettings).first()
    if not settings:
        raise HTTPException(400, "No AI provider configured")
    model = body.model or settings.default_codex_model or settings.default_model
    if not model:
        raise HTTPException(400, "No AI model configured")
    pdef, base_url, api_key = _resolve_provider(settings, model=model)

    messages = [
        {
            "role": "system",
            "content": (
                f"You are a professional literary translator. "
                f"Translate the provided text into {body.target_language}. "
                f"Preserve the original formatting exactly — keep all section headers, "
                f"bullet points, newlines, and structural elements intact. "
                f"Preserve the meaning, tone, and style. "
                f"Return only the translated text, no preamble or explanation."
            ),
        },
        {"role": "user", "content": body.text},
    ]
    try:
        result = await post_provider(pdef, base_url, api_key, model, messages, timeout=60)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"Provider error: {exc.response.text}")

    translated = result["choices"][0]["message"]["content"].strip()
    return {"text": translated}


# Section templates per entry type (English keys; AI translates headers to the text's language)
_STRUCTURE_SECTIONS: dict[str, list[str]] = {
    "character": ["Age", "Appearance", "Personality", "Abilities", "Social", "Background"],
    "location":  ["Geography", "Atmosphere", "Notable features", "Inhabitants", "History"],
    "item":      ["Appearance", "Function", "Owner", "History", "Significance"],
    "lore":      ["Description", "Scope", "Origin", "Known facts", "Open questions"],
    "custom":    ["Description", "Details", "History", "Notes"],
}


@router.post("/structure")
async def structure_text(body: StructureRequest, db: Session = Depends(get_db)):
    """Reorganize free-form description text into typed sections for a codex entry."""
    settings = db.query(UserSettings).first()
    if not settings:
        raise HTTPException(400, "No AI provider configured")
    model = body.model or settings.default_codex_model or settings.default_model
    if not model:
        raise HTTPException(400, "No AI model configured")
    pdef, base_url, api_key = _resolve_provider(settings, model=model)

    entry_type = (body.entry_type or "custom").lower()
    sections = _STRUCTURE_SECTIONS.get(entry_type, _STRUCTURE_SECTIONS["custom"])
    sections_list = "\n".join(f"- {s}" for s in sections)

    # ── Language directive — top of prompt so the model cannot miss it ──────────
    if body.target_language:
        lang_directive = (
            f"OUTPUT LANGUAGE: {body.target_language}\n"
            f"You MUST write every single word of your response in {body.target_language}. "
            f"This includes section headers, sub-labels, all body text, and the tag/group "
            f"suggestions. Translate the source material into {body.target_language} as you "
            f"reorganise it.\n\n"
        )
    else:
        lang_directive = (
            "OUTPUT LANGUAGE: same as the input text "
            "(auto-detect the source language and match it throughout, including suggestions).\n\n"
        )

    # ── Entry-type-specific notes ─────────────────────────────────────────────
    type_notes = ""
    if entry_type == "character":
        type_notes = (
            "\nAppearance sub-labels (each followed by colon, translated to output language): "
            "Skin, Eyes, Hair, Build"
            "\nPersonality: list each trait as a bullet point starting with '- '"
        )

    # ── Minimal format example (colon + empty section) ────────────────────────
    ex_a = sections[0]
    ex_b = sections[1] if len(sections) > 1 else sections[0]
    format_example = f"{ex_a}:\ncontent goes here\n\n{ex_b}:\n"

    # ── Subtype guidance (not relevant for characters) ────────────────────────
    subtype_rule = (
        "- suggested_subtype: the single most fitting type classification found in the text "
        f"(e.g. for {entry_type}: a descriptive noun like 'garden', 'ruins', 'artifact'…); "
        "null if nothing clear\n"
        if entry_type != "character"
        else "- suggested_subtype: null (not applicable for characters)\n"
    )

    system_content = (
        f"{lang_directive}"
        f"Reorganise the following {entry_type} codex entry into these fixed sections "
        f"(create ALL of them, in this order):\n"
        f"{sections_list}"
        f"{type_notes}\n\n"
        f"=== RESPONSE FORMAT ===\n"
        f"Use EXACTLY these two delimiter lines and nothing else around them:\n\n"
        f"<<<TEXT>>>\n"
        f"[the reorganised description here]\n"
        f"<<<SUGGESTIONS>>>\n"
        f'[a single JSON object on one line: {{"suggested_tags":["tag"],"suggested_groups":["Group"],"suggested_subtype":"type or null"}}]\n\n'
        f"--- Format rules for <<<TEXT>>> ---\n"
        f"- Every section header ends with a colon (:) on its own line\n"
        f"- Content follows on the next line(s); sections separated by one blank line\n"
        f"- Empty sections: header with colon only, no placeholder text\n"
        f"- Do NOT invent content — only reorganise what is in the source\n"
        f"- Preserve all original information\n\n"
        f"Example of correct <<<TEXT>>> format:\n"
        f"{format_example}\n"
        f"--- Rules for <<<SUGGESTIONS>>> JSON ---\n"
        f"- suggested_tags: up to 8 lowercase keywords/descriptors extracted from the text\n"
        f"- suggested_groups: organisations, factions, institutions the entry belongs to "
        f"(proper names, max 5)\n"
        f"{subtype_rule}"
        f"- Return valid JSON on a single line; do not wrap in code fences"
    )

    messages_struct = [
        {"role": "system", "content": system_content},
        {"role": "user",   "content": body.text},
    ]
    try:
        result = await post_provider(pdef, base_url, api_key, model, messages_struct, timeout=60)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"Provider error: {exc.response.text}")

    raw = result["choices"][0]["message"]["content"].strip()

    # ── Split on delimiter ────────────────────────────────────────────────────
    structured_text = raw
    sugg_tags: list[str] = []
    sugg_groups: list[str] = []
    sugg_subtype: str | None = None

    if "<<<SUGGESTIONS>>>" in raw:
        text_part, sugg_part = raw.split("<<<SUGGESTIONS>>>", 1)
        structured_text = text_part.replace("<<<TEXT>>>", "").strip()
        sugg_raw = re.sub(r"```(?:json)?\s*|\s*```", "", sugg_part).strip()
        try:
            sugg = json.loads(sugg_raw)
            sugg_tags   = [str(t).lower().strip() for t in sugg.get("suggested_tags", []) if t]
            sugg_groups = [str(g).strip() for g in sugg.get("suggested_groups", []) if g]
            raw_st = sugg.get("suggested_subtype")
            sugg_subtype = str(raw_st).strip() if raw_st and str(raw_st).lower() != "null" else None
        except (json.JSONDecodeError, ValueError):
            pass
    elif "<<<TEXT>>>" in raw:
        structured_text = raw.replace("<<<TEXT>>>", "").strip()

    return {
        "text": structured_text,
        "suggested_tags": sugg_tags,
        "suggested_groups": sugg_groups,
        "suggested_subtype": sugg_subtype,
    }


@router.post("/scenes/{scene_id}/synopsis")
async def generate_synopsis(scene_id: int, db: Session = Depends(get_db)):
    """Generate a short synopsis for a scene using AI. Returns {synopsis: str}."""
    scene = db.get(Scene, scene_id)
    if not scene:
        raise HTTPException(404, "Scene not found")

    settings = db.query(UserSettings).first()
    if not settings:
        raise HTTPException(400, "No AI provider configured")

    content = re.sub(r"<[^>]+>", "", scene.content or "").strip()
    if not content:
        raise HTTPException(400, "Scene has no content to summarize")

    model = settings.default_synopsis_model or settings.default_model
    if not model:
        raise HTTPException(400, "No AI model configured")
    pdef, base_url, api_key = _resolve_provider(settings, model=model)
    lang = _project_language(scene, db)

    messages_syn = [
        {
            "role": "system",
            "content": (
                f"You are a writing assistant. Write a concise 1–3 sentence synopsis of the scene. "
                f"Focus on what happens — the key action, conflict, or revelation. "
                f"Write in {lang}. Return only the synopsis, no preamble."
            ),
        },
        {"role": "user", "content": content[:4000]},
    ]
    try:
        result = await post_provider(pdef, base_url, api_key, model, messages_syn, timeout=30)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"Provider error: {exc.response.text}")

    synopsis = result["choices"][0]["message"]["content"].strip()
    return {"synopsis": synopsis}


@router.post("/chat")
async def chat(body: ChatRequest, db: Session = Depends(get_db)):
    """Multi-turn chat about the current scene."""
    scene = db.get(Scene, body.scene_id)
    if not scene:
        raise HTTPException(404, "Scene not found")

    settings = db.query(UserSettings).first()
    if not settings:
        raise HTTPException(400, "No AI provider configured")
    model = body.model or settings.default_model
    if not model:
        raise HTTPException(400, "No AI model configured")
    pdef, base_url, api_key = _resolve_provider(settings, model=model)

    language = _project_language(scene, db)
    scene_content = re.sub(r"<[^>]+>", "", scene.content or "")

    system = (
        "You are a creative writing assistant helping an author develop their story. "
        "The author is currently working on the following scene:\n\n"
        f"--- Scene: {scene.title or 'Untitled'} ---\n"
        f"{scene_content}\n"
        "--- End of Scene ---\n\n"
        "Discuss ideas, answer questions, suggest improvements, and explore story possibilities. "
        f"Be conversational, specific, and helpful. Respond in {language}."
    )

    messages = [{"role": "system", "content": system}]
    messages += [{"role": m.role, "content": m.content} for m in body.messages]

    return StreamingResponse(
        stream_provider(pdef, base_url, api_key, model, messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
