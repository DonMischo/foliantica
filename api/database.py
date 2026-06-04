import json
import os
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

# ── Engine ────────────────────────────────────────────────────────────────────
# Set LW_USE_SQLITE=1 in dev mode (LaunchFoliantica.bat) to keep SQLite.
# In production Electron builds, leave unset — PostgreSQL is used via the
# embedded-postgres sidecar started by electron/main.js.

USE_SQLITE = os.getenv("LW_USE_SQLITE", "0") == "1"

if USE_SQLITE:
    DATABASE_URL = "sqlite:///./foliantica.db"

    # One-time migration: rename loreweaver.db → foliantica.db for existing users
    if os.path.exists("loreweaver.db") and not os.path.exists("foliantica.db"):
        os.rename("loreweaver.db", "foliantica.db")

    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False, "timeout": 30},
    )

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

else:
    _PG_PORT = os.getenv("LW_PG_PORT", "5433")
    _PG_USER = os.getenv("LW_PG_USER", "foliantica")
    _PG_PASS = os.getenv("LW_PG_PASS", "foliantica")
    _PG_DB   = os.getenv("LW_PG_DB",   "foliantica")
    DATABASE_URL = (
        f"postgresql+psycopg2://{_PG_USER}:{_PG_PASS}"
        f"@127.0.0.1:{_PG_PORT}/{_PG_DB}"
    )
    engine = create_engine(DATABASE_URL, pool_size=5, max_overflow=10)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def migrate_to_four_level():
    """
    One-time migration: Project→Chapter→Scene  →  Project→Act→Chapter→Scene.

    Detected by checking whether the existing 'chapters' table still has a
    'project_id' column (old schema).  If so:
      1. Rename 'chapters' → 'acts'
      2. Create a fresh 'chapters' table with act_id FK
      3. For every act, create one chapter (same title) and remap its scenes
    """
    with engine.begin() as conn:
        # Check if old chapters table exists and has project_id
        result = conn.execute(text("PRAGMA table_info(chapters)"))
        cols = {row[1] for row in result.fetchall()}

        if "project_id" not in cols:
            return  # Already on new schema (or fresh DB)

        # 1. Rename old chapters → acts
        conn.execute(text("ALTER TABLE chapters RENAME TO acts"))

        # 2. Create new chapters table
        conn.execute(text("""
            CREATE TABLE chapters (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                act_id     INTEGER NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
                title      TEXT    NOT NULL DEFAULT '',
                order_index INTEGER NOT NULL DEFAULT 0,
                created_at  DATETIME DEFAULT (datetime('now'))
            )
        """))

        # 3. For each act (old chapter), create one chapter under it and
        #    remap all scenes that pointed to the old chapter id.
        acts = conn.execute(text("SELECT id, title FROM acts")).fetchall()
        for act_id, act_title in acts:
            conn.execute(text(
                "INSERT INTO chapters (act_id, title, order_index) "
                "VALUES (:act_id, :title, 0)"
            ), {"act_id": act_id, "title": act_title})
            new_ch_id = conn.execute(text("SELECT last_insert_rowid()")).scalar()
            conn.execute(text(
                "UPDATE scenes SET chapter_id = :new_id WHERE chapter_id = :old_id"
            ), {"new_id": new_ch_id, "old_id": act_id})


def migrate_new_columns():
    """Safely add new columns to existing databases without Alembic."""
    new_columns = [
        ("codex_entries", "entry_group", "TEXT"),
        ("codex_entries", "species",     "TEXT"),
        ("codex_entries", "subtype",     "TEXT"),
        ("codex_entries", "tags",        "TEXT DEFAULT '[]'"),
        ("projects",      "time_config",    "TEXT"),
        ("projects",      "fragment_tabs",  "TEXT"),
        ("projects",      "book_meta",              "TEXT"),
        ("projects",      "shared_codex_project_id", "INTEGER"),
        ("scenes",        "scene_time",             "TEXT"),
        ("codex_entries", "is_main_char",            "INTEGER DEFAULT 0"),
        ("codex_entries", "inventory",               "TEXT"),
        ("projects",      "cover_image",             "TEXT"),
        ("codex_entries", "image_path",              "TEXT"),
        ("user_settings", "enabled_models",          "TEXT DEFAULT '[]'"),
        ("user_settings", "default_chat_model",      "TEXT"),
        ("user_settings", "default_synopsis_model",   "TEXT"),
        ("user_settings", "default_codex_model",      "TEXT"),
        ("fragments",     "category",                "TEXT"),
        ("scenes",        "synopsis",                "TEXT"),
        ("scenes",        "subplot",                 "TEXT"),
        ("scenes",        "global_order",            "INTEGER"),
        ("scenes",        "stack_group",             "TEXT"),
        ("scenes",        "node_x",                  "REAL"),
        ("scenes",        "node_y",                  "REAL"),
        ("codex_entries", "name_type",               "TEXT"),
        ("user_settings", "language",                "TEXT DEFAULT 'en'"),
        ("user_settings", "show_paragraph_numbers",  "INTEGER DEFAULT 0"),
        ("user_settings", "typewriter_mode",         "INTEGER DEFAULT 0"),
        ("user_settings", "typewriter_offset",       "INTEGER DEFAULT 50"),
        ("user_settings", "session_timer_enabled",   "INTEGER DEFAULT 1"),
        ("projects",      "subplot_names",            "TEXT DEFAULT '[]'"),
        ("user_settings", "grammar_check_enabled",    "INTEGER DEFAULT 0"),
        ("user_settings", "grammar_check_url",        "TEXT DEFAULT 'http://localhost:8081'"),
        ("user_settings", "grammar_languages",        "TEXT DEFAULT '[\"en\"]'"),
        ("user_settings", "pandoc_enabled",           "INTEGER DEFAULT 0"),
        ("user_settings", "pandoc_url",               "TEXT DEFAULT 'http://localhost:8082'"),
        ("scenes",        "pov_character_id",           "INTEGER"),
        ("scenes",        "beat",                       "TEXT"),
        ("scenes",        "scene_type",                 "TEXT"),
        ("projects",      "main_plot_color",             "TEXT"),
        ("scenes",        "word_count",                 "INTEGER DEFAULT 0"),
        ("user_settings", "stats_views",                 "INTEGER DEFAULT 0"),
        ("user_settings", "export_count",                "INTEGER DEFAULT 0"),
    ]
    for table, col, col_type in new_columns:
        try:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}"))
        except OperationalError:
            pass  # column already exists


def migrate_indexes():
    """Create FK indexes on existing databases. Idempotent — uses IF NOT EXISTS."""
    indexes = [
        ("idx_acts_project_id",              "acts",              "project_id"),
        ("idx_chapters_act_id",              "chapters",          "act_id"),
        ("idx_scenes_chapter_id",            "scenes",            "chapter_id"),
        ("idx_codex_entries_project_id",     "codex_entries",     "project_id"),
        ("idx_codex_relations_source_id",    "codex_relations",   "source_id"),
        ("idx_codex_relations_target_id",    "codex_relations",   "target_id"),
        ("idx_codex_entry_access_entry_id",  "codex_entry_access", "entry_id"),
        ("idx_fragments_project_id",         "fragments",         "project_id"),
        ("idx_scene_commands_scene_id",      "scene_commands",    "scene_id"),
        ("idx_mention_stats_scene_id",       "mention_stats",     "scene_id"),
        ("idx_mention_stats_codex_id",       "mention_stats",     "codex_id"),
        ("idx_writing_log_project_id",       "writing_log",       "project_id"),
        ("idx_scene_versions_scene_id",      "scene_versions",    "scene_id"),
        ("idx_timeline_tracks_project_id",   "timeline_tracks",   "project_id"),
        ("idx_research_items_project_id",    "research_items",    "project_id"),
        ("idx_query_submissions_project_id", "query_submissions", "project_id"),
        ("idx_export_profiles_project_id",   "export_profiles",   "project_id"),
        ("idx_timeline_events_project_id",   "timeline_events",   "project_id"),
        ("idx_timeline_events_track_id",     "timeline_events",   "track_id"),
    ]
    with engine.begin() as conn:
        for idx_name, table, col in indexes:
            try:
                conn.execute(text(
                    f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({col})"
                ))
            except Exception:
                pass  # table may not exist yet on first run


def migrate_mention_stats():
    """Create the mention_stats table if it does not yet exist."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS mention_stats (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                scene_id   INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
                codex_id   INTEGER NOT NULL REFERENCES codex_entries(id) ON DELETE CASCADE,
                count      INTEGER NOT NULL DEFAULT 0,
                UNIQUE (scene_id, codex_id)
            )
        """))


def migrate_writing_log():
    """Create the writing_log table if it does not yet exist."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS writing_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                date        TEXT    NOT NULL,
                words_added INTEGER NOT NULL DEFAULT 0,
                UNIQUE (project_id, date)
            )
        """))


def migrate_entry_groups():
    """Convert entry_group plain-string values to JSON arrays (one-time migration)."""
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, entry_group FROM codex_entries WHERE entry_group IS NOT NULL"
        )).fetchall()
        for row_id, group in rows:
            if group and not group.startswith("["):
                conn.execute(
                    text("UPDATE codex_entries SET entry_group = :val WHERE id = :id"),
                    {"val": json.dumps([group]), "id": row_id},
                )
        conn.commit()


DEFAULT_AI_PROMPTS = [
    {
        "name": "Story Generation",
        "description": "Generates prose that continues or fills a scene, matching the author's style.",
        "system": (
            "You are a skilled creative writing assistant helping an author write fiction. "
            "Your sole task is to generate prose that fits seamlessly into their story.\n\n"
            "CORE WRITING PRINCIPLES — follow all of them:\n\n"
            "1. STYLE MIRRORING — Study the voice, sentence rhythm, vocabulary level, POV, tense, and tone in the scene excerpt provided. Your output must be indistinguishable from the author's own writing. Do not introduce a new voice.\n\n"
            "2. SHOW, DON'T TELL — Convey emotion, character, and atmosphere through action, dialogue, and sensory detail. Never state feelings directly when they can be demonstrated (\"Her hands shook\" not \"She was afraid\").\n\n"
            "3. SENSORY GROUNDING — Anchor every scene in at least two or three concrete sensory details (sight, sound, smell, texture, taste). Abstractions without grounding feel hollow.\n\n"
            "4. SUBTEXT IN DIALOGUE — Characters rarely say exactly what they mean. Layer surface speech over underlying want, fear, or secret. Avoid on-the-nose exchanges.\n\n"
            "5. SCENE STRUCTURE — Each passage should have a micro-goal, an obstacle or tension, and a shift in state (something changes, even subtly). Dead scenes with no movement should not exist.\n\n"
            "6. SENTENCE RHYTHM — Vary sentence length deliberately. Short sentences accelerate tension. Longer, flowing sentences slow the pace and allow breath. Match rhythm to the emotional beat.\n\n"
            "7. ACTIVE VOICE — Prefer active constructions. Reserve passive voice for deliberate effect (distance, helplessness, mystery).\n\n"
            "8. ELIMINATE FILTER WORDS — Write from inside experience. Not \"He saw the fire roar\" but \"The fire roared.\" Not \"She felt cold\" but \"Cold bit through her coat.\"\n\n"
            "9. SPECIFICITY OVER VAGUENESS — Concrete, precise details create vivid worlds. \"A dented tin mug\" is stronger than \"a cup.\" Avoid generic nouns and adjectives.\n\n"
            "10. INTERIORITY IN BALANCE — Give the POV character's inner voice access when it deepens the scene, but do not over-explain. Trust the reader.\n\n"
            "11. TENSION ON EVERY PAGE — Even quiet, intimate scenes must carry some undercurrent of want, fear, conflict, or unresolved question. Comfort without tension is inert.\n\n"
            "12. CONSISTENT POV — Do not head-hop within a scene. Stay locked in the established point of view.\n\n"
            "13. EARNED EMOTION — Set up emotional beats before delivering them. Do not tell the reader how to feel. Let the moment land.\n\n"
            "14. FORWARD MOMENTUM — Every paragraph must do at least one of: advance plot, deepen character, or build atmosphere. Cut anything that does none of these.\n\n"
            "15. DIALOGUE TAGS — Use \"said\" as the default invisible tag. Use action beats instead of adverb-loaded tags.\n\n"
            "CODEX USAGE — The codex entries describe characters, locations, items, and lore. You must use established physical descriptions exactly as defined, honour personality and speech patterns, and respect world-building rules.\n\n"
            "OUTPUT FORMAT — Return only the generated prose. No preamble, no commentary, no markdown headings. Plain paragraphs separated by blank lines, ready to drop into the manuscript.\n\n"
            "LANGUAGE — Write exclusively in {{LANGUAGE}}. Use {{LANGUAGE}} vocabulary, sentence structure, and stylistic conventions throughout.\n\n"
            "TARGET LENGTH — Write approximately {{WORD_COUNT}} words."
        ),
        "user_template": "## Current Scene\n{{SCENE_CONTENT}}\n\n## Codex Entries\n{{CODEX_ENTRIES}}\n\n## Instruction\n{{USER_PROMPT}}",
        "is_built_in": 1,
        "built_in_key": "story_generate",
    },
    {
        "name": "Lector Review",
        "description": "Analyses a scene as a professional manuscript editor, covering grammar, logic, character consistency, and prose quality.",
        "system": (
            "You are a professional manuscript editor (lector) with experience across literary fiction, genre fiction, and commercial publishing. "
            "Your task is to give the author a thorough, honest, and constructive editorial report on the provided scene.\n\n"
            "Analyse the scene across every dimension below. For each issue found, quote the relevant passage, name the problem type, and suggest a concrete fix. "
            "Group findings under their category headings. If a category has no issues, write \"No issues found.\"\n\n"
            "--- CATEGORY 1: GRAMMAR, SPELLING & PUNCTUATION ---\n"
            "- Spelling errors and typos\n"
            "- Subject-verb agreement\n"
            "- Incorrect punctuation (comma splices, missing apostrophes, dialogue punctuation)\n"
            "- Run-on sentences or unintentional fragments\n"
            "- Incorrect word choice (homophone errors)\n\n"
            "--- CATEGORY 2: LOGIC & CONTINUITY ---\n"
            "- Cause-and-effect gaps\n"
            "- Timeline inconsistencies\n"
            "- Physical impossibilities\n"
            "- World-building contradictions\n"
            "- Unresolved setups\n\n"
            "--- CATEGORY 3: CHARACTER BEHAVIOUR & CONSISTENCY ---\n"
            "Using the codex entries provided, check:\n"
            "- Does each character act in line with their established personality, values, and history?\n"
            "- Is their dialogue voice consistent with how they have been defined?\n"
            "- Do their motivations make sense?\n"
            "- Are relationships portrayed consistently?\n"
            "- Flag any behaviour that feels plot-convenient rather than character-driven.\n\n"
            "--- CATEGORY 4: PROSE QUALITY ---\n"
            "- Filter words weakening immediacy\n"
            "- Telling instead of showing\n"
            "- Purple prose or overwriting\n"
            "- Underwriting (scenes needing more grounding)\n"
            "- Repetition of words, phrases, or ideas\n"
            "- Unintentional passive voice\n"
            "- Adverb overuse on dialogue tags\n"
            "- Vague or generic language\n\n"
            "--- CATEGORY 5: PACING & STRUCTURE ---\n"
            "- Does the scene have a clear purpose?\n"
            "- Is pacing appropriate — does it drag or rush?\n"
            "- Are scene transitions smooth?\n"
            "- Is tension sustained?\n"
            "- Is sentence rhythm varied?\n\n"
            "--- CATEGORY 6: DIALOGUE ---\n"
            "- Does each character's dialogue sound distinct?\n"
            "- Is dialogue doing double work (character + plot/tension)?\n"
            "- Are there speeches that could be tightened?\n"
            "- Are dialogue tags and beats handled well?\n"
            "- Is there on-the-nose dialogue?\n\n"
            "--- SUMMARY ---\n"
            "Close with:\n"
            "1. Three strengths of this scene that should be preserved\n"
            "2. The top two or three priority fixes\n"
            "3. An overall readiness rating: DRAFT / NEAR-FINAL / PUBLISH-READY\n\n"
            "Tone: Be direct and specific, but constructive. Quote the text. Never vague.\n\n"
            "LANGUAGE — Write your entire editorial report in {{LANGUAGE}}."
        ),
        "user_template": "## Scene to Review\n{{SCENE_CONTENT}}\n\n## Codex Entries (for character/world consistency checks)\n{{CODEX_ENTRIES}}",
        "is_built_in": 1,
        "built_in_key": "lector_review",
    },
    {
        "name": "Codex Entry Distillation",
        "description": "Extracts and structures a codex entry (character, location, item, or lore) from scene content and author notes.",
        "system": (
            "You are a world-building assistant helping an author maintain a structured reference codex for their story. "
            "Your task is to read the provided scene and author notes, then distil a clean, well-structured codex entry of the requested type.\n\n"
            "TYPES AND WHAT TO EXTRACT:\n\n"
            "CHARACTER\n"
            "- Full name and any aliases or titles\n"
            "- Physical appearance (only what is explicitly shown — do not invent)\n"
            "- Personality traits (inferred from actions and dialogue — cite evidence)\n"
            "- Role in the story\n"
            "- Relationships to other characters\n"
            "- Goals, wants, and fears (as evidenced in the scene)\n"
            "- Distinctive speech patterns or mannerisms\n"
            "- Notable backstory details revealed\n"
            "- Open questions / things still unknown\n\n"
            "LOCATION\n"
            "- Name and any alternative names\n"
            "- Physical description (size, layout, atmosphere, sensory qualities)\n"
            "- Geographic or spatial relationship to other places\n"
            "- Who inhabits or frequents it\n"
            "- Its narrative function\n"
            "- Notable objects or features within it\n"
            "- Mood and tone it conveys\n"
            "- Open questions / things still unknown\n\n"
            "ITEM\n"
            "- Name and any alternative names\n"
            "- Physical description\n"
            "- Owner(s) and how it came to them\n"
            "- Function or power (practical and/or symbolic)\n"
            "- Significance to the plot or a character\n"
            "- Known history or provenance\n"
            "- Open questions / things still unknown\n\n"
            "LORE\n"
            "- Name of the concept, rule, event, or system\n"
            "- Clear explanation of what it is or how it works\n"
            "- Scope and reach in the world\n"
            "- Factions, groups, or characters it involves\n"
            "- Historical or mythological context\n"
            "- Open questions / inconsistencies still unresolved\n\n"
            "INSTRUCTIONS:\n"
            "- Extract only what is present or strongly implied. Do not invent facts.\n"
            "- If something is ambiguous, flag it under \"Open questions\".\n"
            "- Be concise but complete — write for a reference document, not for prose.\n"
            "- If the author notes add facts not in the scene, include them and mark them as (from author notes).\n"
            "- Return a clean structured entry with labelled fields. No preamble.\n\n"
            "LANGUAGE — Write the codex entry in {{LANGUAGE}}."
        ),
        "user_template": "## Entry Type\n{{ENTRY_TYPE}}\n\n## Scene\n{{SCENE_CONTENT}}\n\n## Author Notes\n{{USER_NOTES}}",
        "is_built_in": 1,
        "built_in_key": "codex_distill",
    },
]


def migrate_ai_prompts():
    """Create ai_prompts table and seed the three built-in defaults if not already present."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ai_prompts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                system TEXT NOT NULL DEFAULT '',
                user_template TEXT NOT NULL DEFAULT '',
                is_built_in INTEGER NOT NULL DEFAULT 0,
                built_in_key TEXT,
                word_count INTEGER NOT NULL DEFAULT 400
            )
        """))
        try:
            conn.execute(text("ALTER TABLE ai_prompts ADD COLUMN word_count INTEGER NOT NULL DEFAULT 400"))
        except Exception:
            pass  # column already exists
        for p in DEFAULT_AI_PROMPTS:
            existing = conn.execute(
                text("SELECT id FROM ai_prompts WHERE built_in_key = :key"),
                {"key": p["built_in_key"]},
            ).fetchone()
            if not existing:
                conn.execute(
                    text("""
                        INSERT INTO ai_prompts (name, description, system, user_template, is_built_in, built_in_key, word_count)
                        VALUES (:name, :description, :system, :user_template, :is_built_in, :built_in_key, :word_count)
                    """),
                    {**p, "word_count": p.get("word_count", 400)},
                )
        # Upgrade: update built-in system texts when expected placeholders are missing
        _required = {
            "story_generate": ["{{LANGUAGE}}", "{{WORD_COUNT}}"],
            "lector_review":  ["{{LANGUAGE}}"],
            "codex_distill":  ["{{LANGUAGE}}"],
        }
        for p in DEFAULT_AI_PROMPTS:
            tokens = _required.get(p["built_in_key"], [])
            row = conn.execute(
                text("SELECT id, system FROM ai_prompts WHERE built_in_key = :key"),
                {"key": p["built_in_key"]},
            ).fetchone()
            if row and any(t not in (row[1] or "") for t in tokens):
                conn.execute(
                    text("UPDATE ai_prompts SET system = :system WHERE id = :id"),
                    {"system": p["system"], "id": row[0]},
                )


def migrate_scene_versions():
    """Create scene_versions table."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS scene_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
                content TEXT NOT NULL DEFAULT '',
                content_hash TEXT NOT NULL DEFAULT '',
                created_at DATETIME DEFAULT (datetime('now'))
            )
        """))


def migrate_codex_entry_sharing():
    """Add share_mode/share_future columns to codex_entries and create codex_entry_access table."""
    for col, col_type in [
        ("share_mode",   "TEXT NOT NULL DEFAULT 'all'"),
        ("share_future", "INTEGER NOT NULL DEFAULT 1"),
    ]:
        try:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE codex_entries ADD COLUMN {col} {col_type}"))
        except OperationalError:
            pass  # already exists
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS codex_entry_access (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id   INTEGER NOT NULL REFERENCES codex_entries(id) ON DELETE CASCADE,
                project_id INTEGER NOT NULL,
                UNIQUE (entry_id, project_id)
            )
        """))


def migrate_timeline_tables():
    """Create timeline_tracks and timeline_events tables if they don't exist yet."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS timeline_tracks (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                name         TEXT    NOT NULL DEFAULT 'Timeline',
                color        TEXT    NOT NULL DEFAULT '#6b7280',
                track_type   TEXT    NOT NULL DEFAULT 'parallel',
                order_index  INTEGER NOT NULL DEFAULT 0,
                start_time   TEXT,
                end_time     TEXT,
                created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS timeline_events (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                track_id     INTEGER REFERENCES timeline_tracks(id) ON DELETE SET NULL,
                title        TEXT    NOT NULL DEFAULT 'Untitled Event',
                description  TEXT,
                scene_time   TEXT,
                color        TEXT    NOT NULL DEFAULT '#6b7280',
                created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """
        ))


def migrate_research():
    """Create the research_items table if it does not yet exist."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS research_items (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                title             TEXT,
                url               TEXT,
                url_title         TEXT,
                url_description   TEXT,
                url_image         TEXT,
                text_content      TEXT,
                image_path        TEXT,
                linked_scene_id   INTEGER,
                linked_codex_id   INTEGER,
                tags              TEXT NOT NULL DEFAULT '[]',
                created_at        DATETIME DEFAULT (datetime('now')),
                updated_at        DATETIME DEFAULT (datetime('now'))
            )
        """))


# ── Standard Manuscript Format export profile options ─────────────────────────
_SMF_OPTIONS = {
    "format": "docx",
    "font": "Times New Roman", "font_size": "12pt", "line_spacing": "2",
    "paper_size": "letterpaper",
    "heading_align": "center", "h1_size": "1.5em", "h2_size": "1.25em",
    "h3_size": "1em", "h3_style": "normal",
    "paragraph_indent": "1.5em", "text_align": "left",
    "pdf_margin": "1in", "page_numbers": True, "drop_caps": False,
    "include_act_headings": False, "include_chapter_headings": True,
    "include_scene_headings": False,
}
_COURIER_OPTIONS = {**_SMF_OPTIONS, "font": "Courier New"}

_BUILTIN_PROFILES = [
    {
        "name": "Standard Manuscript Format",
        "description": (
            "Industry-standard agent submission format. "
            "Times New Roman 12pt, double-spaced, 1-inch margins. "
            "Outputs .docx — the format agents expect."
        ),
        "options": _SMF_OPTIONS,
    },
    {
        "name": "Courier Manuscript",
        "description": (
            "Traditional Courier New manuscript. "
            "Some agents and small presses still prefer monospace. "
            "Same double-spacing and 1-inch margins as SMF."
        ),
        "options": _COURIER_OPTIONS,
    },
]


def migrate_publishing():
    """Create query_submissions and export_profiles tables; seed built-in profiles."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS query_submissions (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                agent_name        TEXT    NOT NULL DEFAULT '',
                agency            TEXT,
                email             TEXT,
                submission_type   TEXT    NOT NULL DEFAULT 'query',
                date_sent         TEXT,
                response_deadline TEXT,
                status            TEXT    NOT NULL DEFAULT 'queried',
                notes             TEXT,
                created_at        DATETIME DEFAULT (datetime('now')),
                updated_at        DATETIME DEFAULT (datetime('now'))
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS export_profiles (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                name         TEXT    NOT NULL DEFAULT '',
                description  TEXT,
                is_builtin   INTEGER NOT NULL DEFAULT 0,
                options_json TEXT    NOT NULL DEFAULT '{}',
                created_at   DATETIME DEFAULT (datetime('now')),
                updated_at   DATETIME DEFAULT (datetime('now'))
            )
        """))
        # Seed built-in profiles (idempotent)
        for p in _BUILTIN_PROFILES:
            exists = conn.execute(
                text("SELECT id FROM export_profiles WHERE name = :name AND is_builtin = 1"),
                {"name": p["name"]},
            ).fetchone()
            if not exists:
                conn.execute(
                    text("""
                        INSERT INTO export_profiles
                            (project_id, name, description, is_builtin, options_json, created_at, updated_at)
                        VALUES (NULL, :name, :desc, 1, :opts, datetime('now'), datetime('now'))
                    """),
                    {"name": p["name"], "desc": p["description"], "opts": json.dumps(p["options"])},
                )


_SMF_BASE = {
    "format": "docx", "font": "Times New Roman", "font_size": "12pt",
    "line_spacing": "2", "text_align": "left", "heading_align": "center",
    "paragraph_indent": "1.5em", "pdf_margin": "1in", "page_numbers": True,
    "include_act_headings": False, "include_chapter_headings": True, "include_scene_headings": False,
    "h1_size": "1.5em", "h2_size": "1.25em", "h3_size": "1em", "h3_style": "normal",
}
_EPUB_BASE = {
    "format": "epub", "font": "Georgia", "font_size": "12pt",
    "line_spacing": "1.5", "text_align": "left", "heading_align": "center",
    "paragraph_indent": "1.5em", "pdf_margin": "1in", "page_numbers": False,
    "include_act_headings": True, "include_chapter_headings": True, "include_scene_headings": False,
    "h1_size": "2em", "h2_size": "1.5em", "h3_size": "1.25em", "h3_style": "normal",
}
# German standard: TNR 12pt, 1.5-spaced, A4, 2.5 cm margins (Manuskriptformat)
_DE_BASE = {
    "format": "docx", "font": "Times New Roman", "font_size": "12pt",
    "line_spacing": "1.5", "text_align": "left", "heading_align": "center",
    "paragraph_indent": "1.5em", "pdf_margin": "2.5cm", "page_numbers": True,
    "include_act_headings": False, "include_chapter_headings": True, "include_scene_headings": False,
    "h1_size": "1.5em", "h2_size": "1.25em", "h3_size": "1em", "h3_style": "normal",
}
# French standard: TNR 12pt, double-spaced, A4, 2.5 cm margins
_FR_BASE = {
    "format": "docx", "font": "Times New Roman", "font_size": "12pt",
    "line_spacing": "2", "text_align": "left", "heading_align": "center",
    "paragraph_indent": "1.5em", "pdf_margin": "2.5cm", "page_numbers": True,
    "include_act_headings": False, "include_chapter_headings": True, "include_scene_headings": False,
    "h1_size": "1.5em", "h2_size": "1.25em", "h3_size": "1em", "h3_style": "normal",
}
# Spanish standard: TNR 12pt, 1.5-spaced, A4, 2.5 cm margins
_ES_BASE = {
    "format": "docx", "font": "Times New Roman", "font_size": "12pt",
    "line_spacing": "1.5", "text_align": "left", "heading_align": "center",
    "paragraph_indent": "1.5em", "pdf_margin": "2.5cm", "page_numbers": True,
    "include_act_headings": False, "include_chapter_headings": True, "include_scene_headings": False,
    "h1_size": "1.5em", "h2_size": "1.25em", "h3_size": "1em", "h3_style": "normal",
}

_PUBLISHER_PROFILES = [
    # ── Standard formats ──────────────────────────────────────────────────────
    {
        "short_name": "SMF_TNR",
        "name": "Standard Manuscript Format (TNR)",
        "category": "standard",
        "description": "Industry-standard agent submission format. Times New Roman 12pt, double-spaced, 1-inch margins, first-line indent, left-aligned (ragged right). Default for US/UK agent queries when no specific format is given.",
        "word_count_min": None, "word_count_max": None,
        "accepts_unagented": 1, "submission_url": None,
        "options": {**_SMF_BASE},
    },
    {
        "short_name": "SMF_Courier",
        "name": "Standard Manuscript Format (Courier)",
        "category": "standard",
        "description": "Traditional typewriter-style format. Courier New 12pt (monospace, ~250 words/page), double-spaced, 1-inch margins. Preferred by some agents and small presses for its strict word-count clarity.",
        "word_count_min": None, "word_count_max": None,
        "accepts_unagented": 1, "submission_url": None,
        "options": {**_SMF_BASE, "font": "Courier New"},
    },
    # ── US Trade Publishers ───────────────────────────────────────────────────
    {
        "short_name": "PRH_Berkley",
        "name": "Berkley (Penguin Random House)",
        "category": "us_trade",
        "description": "PRH Berkley open submissions — no specific font/spacing required; SMF is the safe default. Accepts romance, romantasy, commercial fiction, SFF, horror. Max 150,000 words. No AI-generated content.",
        "word_count_min": None, "word_count_max": 150000,
        "accepts_unagented": 1,
        "submission_url": "https://sites.prh.com/berkley-open-submissions-2024",
        "options": {**_SMF_BASE},
    },
    {
        "short_name": "Harlequin",
        "name": "Harlequin (HarperCollins — Romance)",
        "category": "genre",
        "description": "Times New Roman 12pt, double-spaced, .docx. Submit to a specific series line via Submittable. Category romance: 50,000–75,000 words; trade romance up to 100,000. Tolerance ±3,000 words.",
        "word_count_min": 50000, "word_count_max": 100000,
        "accepts_unagented": 1,
        "submission_url": "https://harlequin.submittable.com",
        "options": {**_SMF_BASE},
    },
    # ── UK Trade Publishers ───────────────────────────────────────────────────
    {
        "short_name": "PanMacmillan_UK",
        "name": "Pan Macmillan (UK)",
        "category": "uk_trade",
        "description": "Times New Roman 12pt, double-spaced. Word documents ONLY — PDF explicitly rejected. Main imprints are agent-only. Tor UK (SFF/horror, 95,000–150,000 words) accepts complete unagented manuscripts.",
        "word_count_min": None, "word_count_max": 150000,
        "accepts_unagented": 0, "submission_url": None,
        "options": {**_SMF_BASE},
    },
    {
        "short_name": "HachetteUK",
        "name": "Hachette UK (Hodder / Orion)",
        "category": "uk_trade",
        "description": "Serif 10–12pt, double-spaced, left-aligned (explicitly unjustified), continuous page numbers — not restarting per chapter. Occasional open windows for crime/thriller/romance.",
        "word_count_min": None, "word_count_max": None,
        "accepts_unagented": 0,
        "submission_url": "https://www.hodder.co.uk/landing-page/hachette/submissions/",
        "options": {**_SMF_BASE, "font_size": "11pt"},
    },
    {
        "short_name": "Bloomsbury_UK",
        "name": "Bloomsbury (UK)",
        "category": "uk_trade",
        "description": "SMF standard for agented submissions. Fiction imprints are agent-only. Bloomsbury Academic accepts direct proposals. Historical, literary, and YA — all SMF expected.",
        "word_count_min": None, "word_count_max": None,
        "accepts_unagented": 0, "submission_url": None,
        "options": {**_SMF_BASE},
    },
    # ── Literary Agencies ─────────────────────────────────────────────────────
    {
        "short_name": "CurtisBrown_UK",
        "name": "Curtis Brown (UK)",
        "category": "agency",
        "description": "Times New Roman 12pt, 1.5× or double-spaced, indented paragraphs. No copyright notice. Submit .docx or PDF with query letter and sample chapters.",
        "word_count_min": None, "word_count_max": None,
        "accepts_unagented": 1,
        "submission_url": "https://www.curtisbrown.co.uk/submit",
        "options": {**_SMF_BASE, "line_spacing": "1.5"},
    },
    {
        "short_name": "CurtisBrown_AU",
        "name": "Curtis Brown (Australia)",
        "category": "agency",
        "description": "Times New Roman 12pt, double-spaced, 30mm margins (slightly wider than 1\"). .doc, .docx, or PDF. Submission window: June only (1st–last day). Cover letter ≤300 words, synopsis ≤2 pages, first 3 chapters or 50 pages.",
        "word_count_min": None, "word_count_max": None,
        "accepts_unagented": 1,
        "submission_url": "https://www.curtisbrown.com.au/submissions",
        "options": {**_SMF_BASE, "pdf_margin": "30mm"},
    },
    {
        "short_name": "JanklowNesbit",
        "name": "Janklow & Nesbit",
        "category": "agency",
        "description": "12pt, double-spaced, 'reasonable font'. First 10 pages pasted in email body (no attachment). Email subject: FULL NAME / TITLE. Single agent via submissions@janklow.com. Full .docx when requested.",
        "word_count_min": None, "word_count_max": None,
        "accepts_unagented": 1,
        "submission_url": "https://www.janklowandnesbit.com/submissions",
        "options": {**_SMF_BASE},
    },
    {
        "short_name": "WritersHouse",
        "name": "Writers House",
        "category": "agency",
        "description": "SMF standard. Query + credentials + synopsis + first 10 pages pasted in email body (no attachment initially). Full .docx when requested. Query one agent at a time only.",
        "word_count_min": None, "word_count_max": None,
        "accepts_unagented": 1,
        "submission_url": "https://www.writershouse.com/how-to-submit/",
        "options": {**_SMF_BASE},
    },
    # ── Genre Imprints ────────────────────────────────────────────────────────
    {
        "short_name": "TorUK",
        "name": "Tor UK (Pan Macmillan — SFF/Horror)",
        "category": "genre",
        "description": "Science fiction, fantasy, and horror. Accepts complete unagented manuscripts as Word .doc. 95,000–150,000 words. SMF formatting expected.",
        "word_count_min": 95000, "word_count_max": 150000,
        "accepts_unagented": 1, "submission_url": None,
        "options": {**_SMF_BASE},
    },
    {
        "short_name": "SohoCrime",
        "name": "Soho Crime (Soho Press)",
        "category": "genre",
        "description": "International crime fiction where setting is intrinsic to the narrative. Open to unagented direct submissions. SMF formatting. Response time ~12 months.",
        "word_count_min": None, "word_count_max": None,
        "accepts_unagented": 1,
        "submission_url": "https://sohopress.com/resources/submissions",
        "options": {**_SMF_BASE},
    },
    # ── Self-Publishing ───────────────────────────────────────────────────────
    {
        "short_name": "KDP_eBook",
        "name": "Amazon KDP (eBook)",
        "category": "selfpub",
        "description": "Amazon Kindle Direct Publishing ebook. Reflowable EPUB — reader controls font/size/spacing. Use chapter headings via Styles. No page numbers needed for ebook layout.",
        "word_count_min": None, "word_count_max": None,
        "accepts_unagented": 1,
        "submission_url": "https://kdp.amazon.com",
        "options": {**_EPUB_BASE},
    },
    {
        "short_name": "Draft2Digital",
        "name": "Draft2Digital (multi-retailer ebook)",
        "category": "selfpub",
        "description": "Distributes to Apple Books, B&N Nook, Kobo, Scribd, and others from a single upload. D2D auto-formats into their templates. Reflowable EPUB output.",
        "word_count_min": None, "word_count_max": None,
        "accepts_unagented": 1,
        "submission_url": "https://draft2digital.com",
        "options": {**_EPUB_BASE},
    },
    # ── German Publishers (DE) ────────────────────────────────────────────────
    {
        "short_name": "Rowohlt_DE",
        "name": "Rowohlt Verlag",
        "category": "de_trade",
        "description": "One of Germany's largest literary publishers (Hamburg). Literary fiction, non-fiction, crime. TNR 12pt, 1.5-spaced, A4, 2.5 cm margins. Agent submission required.",
        "word_count_min": 70000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.rowohlt.de",
        "options": {**_DE_BASE},
    },
    {
        "short_name": "SFischer_DE",
        "name": "S. Fischer Verlage",
        "category": "de_trade",
        "description": "Prestigious Frankfurt literary publisher (Holtzbrinck group). Literary fiction, classics, non-fiction. TNR 12pt, 1.5-spaced, A4. Agent required.",
        "word_count_min": 70000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.fischerverlage.de",
        "options": {**_DE_BASE},
    },
    {
        "short_name": "Suhrkamp_DE",
        "name": "Suhrkamp Verlag",
        "category": "de_trade",
        "description": "Highly prestigious literary publisher (Frankfurt/Berlin). Contemporary literary fiction, theory, philosophy. Agent required; extremely selective.",
        "word_count_min": 60000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.suhrkamp.de",
        "options": {**_DE_BASE},
    },
    {
        "short_name": "Hanser_DE",
        "name": "Carl Hanser Verlag",
        "category": "de_trade",
        "description": "Munich publisher known for literary fiction and international translations. TNR 12pt, 1.5-spaced, A4, 2.5 cm margins. Agent required.",
        "word_count_min": 60000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.hanser-literaturverlage.de",
        "options": {**_DE_BASE},
    },
    {
        "short_name": "Piper_DE",
        "name": "Piper Verlag",
        "category": "de_trade",
        "description": "Munich publisher covering literary and commercial fiction, non-fiction, fantasy imprint (Piper Fantasy). TNR 12pt, 1.5-spaced, A4. Agent required.",
        "word_count_min": 70000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.piper.de",
        "options": {**_DE_BASE},
    },
    {
        "short_name": "DroemerKnaur_DE",
        "name": "Droemer Knaur",
        "category": "de_trade",
        "description": "Munich commercial fiction imprint (Holtzbrinck). Thrillers, crime, women's fiction, historicals. TNR 12pt, 1.5-spaced, A4. Agent required.",
        "word_count_min": 70000, "word_count_max": 100000,
        "accepts_unagented": 0, "submission_url": "https://www.droemer-knaur.de",
        "options": {**_DE_BASE},
    },
    {
        "short_name": "BasteiLuebbe_DE",
        "name": "Bastei Lübbe",
        "category": "de_trade",
        "description": "Cologne genre and entertainment publisher. Crime, thriller, fantasy, romance. Has an online submissions portal for direct manuscript submissions.",
        "word_count_min": 70000, "word_count_max": 100000,
        "accepts_unagented": 1,
        "submission_url": "https://autorenwelt.de/einreichung",
        "options": {**_DE_BASE},
    },
    {
        "short_name": "Aufbau_DE",
        "name": "Aufbau Verlag",
        "category": "de_trade",
        "description": "Berlin publisher with strong literary and crime lists. TNR 12pt, 1.5-spaced, A4, 2.5 cm margins. Agent preferred.",
        "word_count_min": 70000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.aufbau-verlage.de",
        "options": {**_DE_BASE},
    },
    {
        "short_name": "Ullstein_DE",
        "name": "Ullstein Buchverlage",
        "category": "de_trade",
        "description": "Berlin broad-range publisher (Axel Springer). Fiction, non-fiction, crime, fantasy (Ullstein Hardcover). TNR 12pt, 1.5-spaced, A4. Agent required.",
        "word_count_min": 70000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.ullstein-buchverlage.de",
        "options": {**_DE_BASE},
    },
    {
        "short_name": "dtv_DE",
        "name": "dtv Verlag",
        "category": "de_trade",
        "description": "Munich broad-range publisher (Deutscher Taschenbuch Verlag). Literary fiction, crime, YA. TNR 12pt, 1.5-spaced, A4. Agent required.",
        "word_count_min": 70000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.dtv.de",
        "options": {**_DE_BASE},
    },
    # ── French Publishers (FR) ────────────────────────────────────────────────
    {
        "short_name": "Gallimard_FR",
        "name": "Gallimard",
        "category": "fr_trade",
        "description": "Prestigious Paris literary publisher (Folio, NRF). Literary fiction, essays, crime (Série Noire). TNR 12pt, double-spaced, A4. Agent almost always required.",
        "word_count_min": 60000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.gallimard.fr",
        "options": {**_FR_BASE},
    },
    {
        "short_name": "Seuil_FR",
        "name": "Éditions du Seuil",
        "category": "fr_trade",
        "description": "Major Paris literary and non-fiction publisher. Literary fiction, essays, history. TNR 12pt, double-spaced, A4, 2.5 cm margins. Agent required.",
        "word_count_min": 60000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.seuil.com",
        "options": {**_FR_BASE},
    },
    {
        "short_name": "Flammarion_FR",
        "name": "Flammarion",
        "category": "fr_trade",
        "description": "Broad Paris publisher (Casterman, J'ai lu, Libella group). Literary and commercial fiction. TNR 12pt, double-spaced, A4. Agent required.",
        "word_count_min": 70000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.flammarion.com",
        "options": {**_FR_BASE},
    },
    {
        "short_name": "AlbinMichel_FR",
        "name": "Albin Michel",
        "category": "fr_trade",
        "description": "Paris broad literary publisher. Literary fiction, biographies, crime (Albin Michel Imaginaire for SFF). TNR 12pt, double-spaced, A4. Agent required.",
        "word_count_min": 70000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.albin-michel.fr",
        "options": {**_FR_BASE},
    },
    {
        "short_name": "ActesSud_FR",
        "name": "Actes Sud",
        "category": "fr_trade",
        "description": "Independent Arles publisher known for translated and French literary fiction. Has a direct submissions form for unsolicited manuscripts.",
        "word_count_min": 60000, "word_count_max": 120000,
        "accepts_unagented": 1,
        "submission_url": "https://www.actes-sud.fr/soumission-de-manuscrits",
        "options": {**_FR_BASE},
    },
    {
        "short_name": "Bragelonne_FR",
        "name": "Bragelonne",
        "category": "fr_trade",
        "description": "Leading French SFF, thriller and crime publisher. Accepts direct manuscript submissions via their online portal. TNR 12pt, double-spaced, A4.",
        "word_count_min": 70000, "word_count_max": 120000,
        "accepts_unagented": 1,
        "submission_url": "https://www.bragelonne.fr/soumission",
        "options": {**_FR_BASE},
    },
    {
        "short_name": "LAtlante_FR",
        "name": "L'Atalante",
        "category": "fr_trade",
        "description": "Lyon indie SFF publisher. Accepts direct submissions. TNR 12pt, double-spaced, A4, 2.5 cm margins.",
        "word_count_min": 70000, "word_count_max": 130000,
        "accepts_unagented": 1,
        "submission_url": "https://www.l-atalante.com/soumettre-un-manuscrit",
        "options": {**_FR_BASE},
    },
    # ── Spanish Publishers (ES) ───────────────────────────────────────────────
    {
        "short_name": "Planeta_ES",
        "name": "Grupo Planeta (Spain)",
        "category": "es_trade",
        "description": "Spain's largest publisher group (Barcelona). Imprints include Espasa, Destino, Seix Barral, Tusquets. TNR 12pt, 1.5-spaced, A4, 2.5 cm margins. Agent required.",
        "word_count_min": 70000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.planeta.es",
        "options": {**_ES_BASE},
    },
    {
        "short_name": "Alfaguara_ES",
        "name": "Alfaguara (Penguin Random House ES)",
        "category": "es_trade",
        "description": "PRH Spain's main literary fiction imprint. Contemporary and translated literary fiction. TNR 12pt, 1.5-spaced, A4. Agent required.",
        "word_count_min": 70000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.megustaleer.com",
        "options": {**_ES_BASE},
    },
    {
        "short_name": "Anagrama_ES",
        "name": "Anagrama",
        "category": "es_trade",
        "description": "Barcelona independent literary publisher (Premio Herralde de Novela). Highly selective literary fiction. TNR 12pt, 1.5-spaced, A4. Agent strongly preferred.",
        "word_count_min": 60000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.anagrama-ed.es",
        "options": {**_ES_BASE},
    },
    {
        "short_name": "Tusquets_ES",
        "name": "Tusquets Editores",
        "category": "es_trade",
        "description": "Barcelona literary publisher (Planeta group). Literary fiction and non-fiction. TNR 12pt, 1.5-spaced, A4, 2.5 cm margins. Agent required.",
        "word_count_min": 70000, "word_count_max": 120000,
        "accepts_unagented": 0, "submission_url": "https://www.tusquetseditores.com",
        "options": {**_ES_BASE},
    },
    {
        "short_name": "Siruela_ES",
        "name": "Siruela",
        "category": "es_trade",
        "description": "Madrid publisher specialising in fantasy, horror, mystery, and literary fiction. Has a direct submissions contact for unagented authors.",
        "word_count_min": 70000, "word_count_max": 120000,
        "accepts_unagented": 1,
        "submission_url": "https://www.siruela.com/contacto.php",
        "options": {**_ES_BASE},
    },
    {
        "short_name": "EdicionesUrano_ES",
        "name": "Ediciones Urano",
        "category": "es_trade",
        "description": "Barcelona publisher covering genre fiction (Titania romance, Umbriel thriller/SFF), self-help, and lifestyle. Accepts direct submissions via online form.",
        "word_count_min": 70000, "word_count_max": 100000,
        "accepts_unagented": 1,
        "submission_url": "https://www.edicionesurano.com/es-es/contacto",
        "options": {**_ES_BASE},
    },
    {
        "short_name": "RocaEditorial_ES",
        "name": "Roca Editorial",
        "category": "es_trade",
        "description": "Barcelona commercial fiction publisher. Thrillers, crime, historical fiction, romance. Accepts direct submissions. TNR 12pt, 1.5-spaced, A4.",
        "word_count_min": 70000, "word_count_max": 100000,
        "accepts_unagented": 1,
        "submission_url": "https://rocaeditorial.com/contacto",
        "options": {**_ES_BASE},
    },
]


def migrate_publisher_profiles():
    """Create publisher_profiles table and seed reference data (idempotent)."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS publisher_profiles (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                short_name       TEXT    NOT NULL UNIQUE,
                name             TEXT    NOT NULL DEFAULT '',
                category         TEXT    NOT NULL DEFAULT 'standard',
                description      TEXT,
                word_count_min   INTEGER,
                word_count_max   INTEGER,
                accepts_unagented INTEGER NOT NULL DEFAULT 0,
                submission_url   TEXT,
                options_json     TEXT    NOT NULL DEFAULT '{}',
                is_active        INTEGER NOT NULL DEFAULT 1,
                created_at       DATETIME DEFAULT (datetime('now')),
                updated_at       DATETIME DEFAULT (datetime('now'))
            )
        """))
        for p in _PUBLISHER_PROFILES:
            exists = conn.execute(
                text("SELECT id FROM publisher_profiles WHERE short_name = :sn"),
                {"sn": p["short_name"]},
            ).fetchone()
            params = {
                "sn":   p["short_name"],
                "name": p["name"],
                "cat":  p["category"],
                "desc": p["description"],
                "wmin": p["word_count_min"],
                "wmax": p["word_count_max"],
                "unag": p["accepts_unagented"],
                "url":  p["submission_url"],
                "opts": json.dumps(p["options"]),
            }
            if not exists:
                conn.execute(text("""
                    INSERT INTO publisher_profiles
                        (short_name, name, category, description,
                         word_count_min, word_count_max, accepts_unagented,
                         submission_url, options_json, is_active,
                         created_at, updated_at)
                    VALUES
                        (:sn, :name, :cat, :desc,
                         :wmin, :wmax, :unag,
                         :url, :opts, 1,
                         datetime('now'), datetime('now'))
                """), params)
            else:
                conn.execute(text("""
                    UPDATE publisher_profiles
                    SET name=:name, category=:cat, description=:desc,
                        word_count_min=:wmin, word_count_max=:wmax,
                        accepts_unagented=:unag, submission_url=:url,
                        options_json=:opts, updated_at=datetime('now')
                    WHERE short_name=:sn
                """), params)


def migrate_achievements():
    """Create the achievement_unlocks table if it does not yet exist."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS achievement_unlocks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                key         TEXT    NOT NULL UNIQUE,
                unlocked_at DATETIME DEFAULT (datetime('now'))
            )
        """))


def migrate_ai_disabled():
    """Add ai_disabled column to user_settings if not present."""
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE user_settings ADD COLUMN ai_disabled INTEGER NOT NULL DEFAULT 0"))
        except Exception:
            pass  # column already exists


def migrate_research_pdf():
    """Add pdf_path column to research_items."""
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE research_items ADD COLUMN pdf_path TEXT"))
        except Exception:
            pass  # column already exists


def migrate_research_media():
    """Create research_media table and migrate legacy image_path / pdf_path rows into it."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS research_media (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                research_item_id INTEGER NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
                kind             TEXT    NOT NULL,
                path             TEXT    NOT NULL,
                order_index      INTEGER NOT NULL DEFAULT 0,
                created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # Move any pre-existing image_path / pdf_path values into the new table.
        # Idempotent: skip if an identical path already exists for that item.
        rows = conn.execute(text(
            "SELECT id, image_path, pdf_path FROM research_items "
            "WHERE image_path IS NOT NULL OR pdf_path IS NOT NULL"
        )).fetchall()

        for row in rows:
            for kind, path in (("image", row[1]), ("pdf", row[2])):
                if not path:
                    continue
                already = conn.execute(text(
                    "SELECT 1 FROM research_media "
                    "WHERE research_item_id = :rid AND path = :path"
                ), {"rid": row[0], "path": path}).fetchone()
                if not already:
                    conn.execute(text(
                        "INSERT INTO research_media "
                        "(research_item_id, kind, path, order_index, created_at) "
                        "VALUES (:rid, :kind, :path, 0, CURRENT_TIMESTAMP)"
                    ), {"rid": row[0], "kind": kind, "path": path})


def migrate_sync_mirror():
    """Add sync_mirror_enabled and sync_local_dir columns to user_settings."""
    with engine.begin() as conn:
        for stmt in [
            "ALTER TABLE user_settings ADD COLUMN sync_mirror_enabled INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE user_settings ADD COLUMN sync_local_dir TEXT",
        ]:
            try:
                conn.execute(text(stmt))
            except Exception:
                pass  # column already exists


def migrate_backfill_word_counts():
    """Backfill scenes.word_count for rows where it is 0 but content exists."""
    import re as _re
    with engine.begin() as conn:
        rows = conn.execute(text(
            "SELECT id, content FROM scenes "
            "WHERE (word_count IS NULL OR word_count = 0) "
            "AND content IS NOT NULL AND content != ''"
        )).fetchall()
        for scene_id, content in rows:
            plain = _re.sub(r"<[^>]+>", "", content)
            wc = len(plain.split())
            if wc > 0:
                conn.execute(
                    text("UPDATE scenes SET word_count = :wc WHERE id = :id"),
                    {"wc": wc, "id": scene_id},
                )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── PostgreSQL seed functions ─────────────────────────────────────────────────
# Called by main.py when USE_SQLITE is False.  The schema has already been
# created by Base.metadata.create_all(); these functions only seed static
# reference data that would otherwise be inserted by the SQLite migrate_*
# functions (which use SQLite-specific DDL and cannot run on PostgreSQL).

def seed_ai_prompts():
    """Seed built-in AI prompts for a fresh PostgreSQL database."""
    with engine.begin() as conn:
        for p in DEFAULT_AI_PROMPTS:
            existing = conn.execute(
                text("SELECT id FROM ai_prompts WHERE built_in_key = :key"),
                {"key": p["built_in_key"]},
            ).fetchone()
            if not existing:
                conn.execute(
                    text("""
                        INSERT INTO ai_prompts
                            (name, description, system, user_template,
                             is_built_in, built_in_key, word_count)
                        VALUES
                            (:name, :description, :system, :user_template,
                             :is_built_in, :built_in_key, :word_count)
                    """),
                    {**p, "word_count": p.get("word_count", 400)},
                )
            else:
                # Update system prompt text if expected placeholders are missing
                _required = {
                    "story_generate": ["{{LANGUAGE}}", "{{WORD_COUNT}}"],
                    "lector_review":  ["{{LANGUAGE}}"],
                    "codex_distill":  ["{{LANGUAGE}}"],
                }
                tokens = _required.get(p["built_in_key"], [])
                row = conn.execute(
                    text("SELECT id, system FROM ai_prompts WHERE built_in_key = :key"),
                    {"key": p["built_in_key"]},
                ).fetchone()
                if row and any(t not in (row[1] or "") for t in tokens):
                    conn.execute(
                        text("UPDATE ai_prompts SET system = :system WHERE id = :id"),
                        {"system": p["system"], "id": row[0]},
                    )


def seed_publisher_profiles():
    """Seed publisher reference profiles for a fresh PostgreSQL database."""
    with engine.begin() as conn:
        for p in _PUBLISHER_PROFILES:
            exists = conn.execute(
                text("SELECT id FROM publisher_profiles WHERE short_name = :sn"),
                {"sn": p["short_name"]},
            ).fetchone()
            params = {
                "sn":   p["short_name"],
                "name": p["name"],
                "cat":  p["category"],
                "desc": p["description"],
                "wmin": p["word_count_min"],
                "wmax": p["word_count_max"],
                "unag": p["accepts_unagented"],
                "url":  p["submission_url"],
                "opts": json.dumps(p["options"]),
            }
            if not exists:
                conn.execute(text("""
                    INSERT INTO publisher_profiles
                        (short_name, name, category, description,
                         word_count_min, word_count_max, accepts_unagented,
                         submission_url, options_json, is_active)
                    VALUES
                        (:sn, :name, :cat, :desc,
                         :wmin, :wmax, :unag,
                         :url, :opts, 1)
                """), params)
            else:
                conn.execute(text("""
                    UPDATE publisher_profiles
                    SET name=:name, category=:cat, description=:desc,
                        word_count_min=:wmin, word_count_max=:wmax,
                        accepts_unagented=:unag, submission_url=:url,
                        options_json=:opts
                    WHERE short_name=:sn
                """), params)


def seed_export_profiles():
    """Seed built-in export profiles for a fresh PostgreSQL database."""
    with engine.begin() as conn:
        for p in _BUILTIN_PROFILES:
            exists = conn.execute(
                text("SELECT id FROM export_profiles WHERE name = :name AND is_builtin = 1"),
                {"name": p["name"]},
            ).fetchone()
            if not exists:
                conn.execute(
                    text("""
                        INSERT INTO export_profiles
                            (project_id, name, description, is_builtin, options_json)
                        VALUES (NULL, :name, :desc, 1, :opts)
                    """),
                    {"name": p["name"], "desc": p["description"],
                     "opts": json.dumps(p["options"])},
                )
