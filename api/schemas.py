import json
from datetime import datetime
from typing import Optional, Any, Literal
from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict


# ── Projects ──────────────────────────────────────────────────────────────────

# ── Book metadata (EPUB Dublin Core fields) ───────────────────────────────────

class BookMeta(BaseModel):
    """Stores EPUB / Dublin Core metadata for a project."""
    author: Optional[str] = None           # dc:creator
    author_sort: Optional[str] = None      # sort key, e.g. "Tolkien, J.R.R."
    subtitle: Optional[str] = None         # secondary title line
    language: str = "en"                   # dc:language (BCP 47)
    publisher: Optional[str] = None        # dc:publisher
    published_date: Optional[str] = None   # dc:date (YYYY or YYYY-MM-DD)
    isbn: Optional[str] = None             # dc:identifier scheme=ISBN
    rights: Optional[str] = None           # dc:rights (copyright statement)
    series: Optional[str] = None           # calibre:series
    series_index: Optional[str] = None     # calibre:series_index (numeric string, e.g. "0.5", "1", "2")
    series_role: Optional[str] = None      # human label: "Prequel", "Book 1", "Short Story", etc.
    genre: Optional[str] = None            # primary dc:subject
    subjects: list[str] = Field(default_factory=list)  # additional dc:subject tags
    synopsis: Optional[str] = None         # dc:description (distinct from project description)
    translator: Optional[str] = None       # dc:contributor role="trl"
    editor: Optional[str] = None           # dc:contributor role="edt"


# ── Projects ──────────────────────────────────────────────────────────────────

class ProjectBase(BaseModel):
    title: str
    description: Optional[str] = None


class ProjectCreate(ProjectBase):
    copy_codex_from: Optional[int] = None   # project_id to deep-copy codex from
    share_codex_from: Optional[int] = None  # project_id to live-share codex with


class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    book_meta: Optional[BookMeta] = None
    shared_codex_project_id: Optional[int] = None
    main_plot_color: Optional[str] = None


class ProjectOut(ProjectBase):
    id: int
    created_at: datetime
    updated_at: datetime
    book_meta: Optional[BookMeta] = None
    shared_codex_project_id: Optional[int] = None
    shared_codex_project_title: Optional[str] = None  # resolved title of the parent codex project
    cover_image: Optional[str] = None
    main_plot_color: Optional[str] = None

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _parse_book_meta(cls, data):
        if hasattr(data, "__dict__"):
            raw = getattr(data, "book_meta", None)
            if isinstance(raw, str):
                try:
                    parsed = json.loads(raw)
                    object.__setattr__(data, "book_meta", parsed)
                except Exception:
                    object.__setattr__(data, "book_meta", None)
        return data


# ── Acts ──────────────────────────────────────────────────────────────────────

class ActBase(BaseModel):
    title: str
    order_index: int = 0


class ActCreate(ActBase):
    project_id: int


class ActUpdate(BaseModel):
    title: Optional[str] = None
    order_index: Optional[int] = None


class ActOut(ActBase):
    id: int
    project_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Chapters ──────────────────────────────────────────────────────────────────

class ChapterBase(BaseModel):
    title: str
    order_index: int = 0


class ChapterCreate(ChapterBase):
    act_id: int


class ChapterUpdate(BaseModel):
    title: Optional[str] = None
    order_index: Optional[int] = None


class ChapterOut(ChapterBase):
    id: int
    act_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ReorderItem(BaseModel):
    id: int
    order_index: int


class ReorderRequest(BaseModel):
    items: list[ReorderItem]


# ── Scenes ────────────────────────────────────────────────────────────────────

class SceneBase(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = ""
    order_index: int = 0


class SceneCreate(SceneBase):
    chapter_id: int


class SceneUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    synopsis: Optional[str] = None
    order_index: Optional[int] = None
    word_count: Optional[int] = None
    scene_time: Optional[Any] = None  # JSON dict or None to clear
    chapter_id: Optional[int] = None  # for cross-column corkboard DnD
    subplot: Optional[str] = None
    global_order: Optional[int] = None
    stack_group: Optional[str] = None
    node_x: Optional[float] = None
    node_y: Optional[float] = None
    pov_character_id: Optional[int] = None
    beat: Optional[str] = None
    scene_type: Optional[str] = None
    card_color: Optional[str] = None


class SceneOut(SceneBase):
    id: int
    chapter_id: int
    word_count: int
    synopsis: Optional[str] = None
    scene_time: Optional[Any] = None
    subplot: Optional[str] = None
    global_order: Optional[int] = None
    stack_group: Optional[str] = None
    node_x: Optional[float] = None
    node_y: Optional[float] = None
    pov_character_id: Optional[int] = None
    beat: Optional[str] = None
    scene_type: Optional[str] = None
    card_color: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _parse_scene_time(cls, data):
        if hasattr(data, "__dict__"):
            raw = getattr(data, "scene_time", None)
            if isinstance(raw, str):
                try:
                    object.__setattr__(data, "scene_time", json.loads(raw))
                except Exception:
                    pass
        return data


# ── Corkboard connections / ordering ─────────────────────────────────────────

class SceneConnectionCreate(BaseModel):
    source_scene_id: int
    target_scene_id: int
    connection_type: str = "reference"
    label: Optional[str] = None


class SceneConnectionOut(BaseModel):
    id: int
    project_id: int
    source_scene_id: int
    target_scene_id: int
    connection_type: str
    label: Optional[str] = None

    model_config = {"from_attributes": True}


class GlobalOrderItem(BaseModel):
    id: int
    global_order: int


class GlobalOrderRequest(BaseModel):
    items: list[GlobalOrderItem]


# ── Codex Entries ─────────────────────────────────────────────────────────────

class CodexEntryBase(BaseModel):
    name: str
    aliases: list[str] = Field(default_factory=list)
    entry_type: str = "custom"
    description: Optional[str] = ""
    notes: Optional[str] = None
    color: str = "#eab308"
    groups: list[str] = Field(default_factory=list)
    species: Optional[str] = None
    subtype: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    is_main_char: bool = False
    inventory: Optional[Any] = None  # CharacterInventory JSON or None
    image_path: Optional[str] = None
    name_type: Optional[str] = None  # name generation style (NameType key)
    share_mode: Literal["all", "specific", "none"] = "all"
    share_future: bool = True         # auto-share with future linked projects


class CodexEntryCreate(CodexEntryBase):
    project_id: int


class CodexEntryUpdate(BaseModel):
    name: Optional[str] = None
    aliases: Optional[list[str]] = None
    entry_type: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    color: Optional[str] = None
    groups: Optional[list[str]] = None
    species: Optional[str] = None
    subtype: Optional[str] = None
    tags: Optional[list[str]] = None
    is_main_char: Optional[bool] = None
    inventory: Optional[Any] = None
    name_type: Optional[str] = None
    share_mode: Optional[Literal["all", "specific", "none"]] = None
    share_future: Optional[bool] = None


class CodexEntryOut(CodexEntryBase):
    id: int
    project_id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_entry(cls, entry) -> "CodexEntryOut":
        inv = None
        if entry.inventory:
            try:
                inv = json.loads(entry.inventory)
            except (json.JSONDecodeError, TypeError):
                pass
        data = {
            "id": entry.id,
            "project_id": entry.project_id,
            "name": entry.name,
            "aliases": entry.get_aliases(),
            "entry_type": entry.entry_type,
            "description": entry.description,
            "notes": entry.notes,
            "color": entry.color,
            "groups": entry.get_groups(),
            "species": entry.species,
            "subtype": entry.subtype,
            "tags": entry.get_tags(),
            "is_main_char": bool(entry.is_main_char),
            "inventory": inv,
            "image_path": entry.image_path,
            "name_type": entry.name_type,
            "share_mode": getattr(entry, "share_mode", "all") or "all",
            "share_future": bool(getattr(entry, "share_future", 1)),
            "created_at": entry.created_at,
            "updated_at": entry.updated_at,
        }
        return cls(**data)


# ── Codex Relations ───────────────────────────────────────────────────────────

class CodexRelationCreate(BaseModel):
    source_id: int
    target_id: int
    relation_type: Optional[str] = None


class CodexRelationOut(BaseModel):
    id: int
    source_id: int
    target_id: int
    relation_type: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Fragments ─────────────────────────────────────────────────────────────────

BUILTIN_TABS = ["snippets", "ideas", "archive"]

class FragmentCreate(BaseModel):
    tab: str = "snippets"
    title: Optional[str] = None
    content: Optional[str] = ""
    category: Optional[str] = None
    order_index: int = 0

class FragmentUpdate(BaseModel):
    tab: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    order_index: Optional[int] = None

class FragmentOut(BaseModel):
    id: int
    project_id: int
    tab: str
    title: Optional[str]
    content: Optional[str]
    category: Optional[str]
    order_index: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

class TabsUpdate(BaseModel):
    custom_tabs: list[str]  # names of custom (non-builtin) tabs


# ── Scene Commands ────────────────────────────────────────────────────────────

class SceneCommandIn(BaseModel):
    command_type: str            # "currency" | "item"
    character_id: int
    item_id: Optional[int] = None
    data: Optional[dict] = None  # {currencyName, delta} or {qty}
    order_index: int = 0


class SceneCommandSyncRequest(BaseModel):
    commands: list[SceneCommandIn]


class SceneCommandOut(BaseModel):
    id: int
    scene_id: int
    command_type: str
    character_id: int
    item_id: Optional[int]
    data: Optional[Any]
    scene_time: Optional[Any]
    order_index: int
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("data", "scene_time", mode="before")
    @classmethod
    def _parse_json(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                pass
        return v


# ── Data directory ────────────────────────────────────────────────────────────

class DataDirUpdate(BaseModel):
    path: Optional[str] = None   # None = reset to default
    migrate: bool = False        # copy existing DB + uploads to new path


# ── Settings ──────────────────────────────────────────────────────────────────

class SettingsUpdate(BaseModel):
    openrouter_api_key: Optional[str] = None
    default_model: Optional[str] = None
    default_chat_model: Optional[str] = None
    default_synopsis_model: Optional[str] = None
    default_codex_model: Optional[str] = None
    theme: Optional[str] = None
    enabled_models: Optional[list[str]] = None
    language: Optional[str] = None
    show_paragraph_numbers: Optional[bool] = None
    typewriter_mode: Optional[bool] = None
    typewriter_offset: Optional[int] = None
    session_timer_enabled: Optional[bool] = None
    grammar_check_enabled: Optional[bool] = None
    grammar_check_url: Optional[str] = None
    grammar_languages: Optional[list[str]] = None
    pandoc_enabled: Optional[bool] = None
    pandoc_url: Optional[str] = None
    spacy_enabled: Optional[bool] = None
    spacy_url: Optional[str] = None
    ai_disabled: Optional[bool] = None
    sync_mirror_enabled: Optional[bool] = None
    sync_local_dir: Optional[str] = None


class SettingsOut(BaseModel):
    id: int
    has_api_key: bool
    default_model: str
    default_chat_model: Optional[str] = None
    default_synopsis_model: Optional[str] = None
    default_codex_model: Optional[str] = None
    theme: str
    enabled_models: list[str]
    language: str
    show_paragraph_numbers: bool
    typewriter_mode: bool
    typewriter_offset: int
    session_timer_enabled: bool
    grammar_check_enabled: bool
    grammar_check_url: str
    grammar_languages: list[str]
    pandoc_enabled: bool
    pandoc_url: str
    spacy_enabled: bool = False
    spacy_url: str = "http://localhost:8083"
    ai_disabled: bool = False
    sync_mirror_enabled: bool = False
    sync_local_dir: Optional[str] = None

    model_config = {"from_attributes": True}


# ── AI Prompts ────────────────────────────────────────────────────────────────

class AIPromptOut(BaseModel):
    id: int
    name: str
    description: str
    system: str
    user_template: str
    is_built_in: bool
    built_in_key: Optional[str]
    word_count: int

    model_config = {"from_attributes": True}

class AIPromptCreate(BaseModel):
    name: str
    description: str = ""
    system: str = ""
    user_template: str = ""
    word_count: int = 400

class AIPromptUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    system: Optional[str] = None
    user_template: Optional[str] = None
    word_count: Optional[int] = None


# ── AI ────────────────────────────────────────────────────────────────────────

class AIGenerateRequest(BaseModel):
    scene_id: int
    mode: str  # continue | rewrite | brainstorm | ask | custom
    custom_prompt: Optional[str] = None
    model: Optional[str] = None


class KiGenerateRequest(BaseModel):
    scene_id: int
    model: str
    codex_ids: list[int] = []
    extra_scene_ids: list[int] = []
    prompt: str = ""
    prompt_id: Optional[int] = None
    entry_type: str = ""
    word_count: Optional[int] = None  # per-node override; falls back to prompt's word_count
    create_entry: bool = False  # when True, return structured JSON for codex entry creation


class TranslateRequest(BaseModel):
    text: str
    target_language: str
    model: Optional[str] = None


class StructureRequest(BaseModel):
    text: str
    entry_type: str = "character"
    target_language: Optional[str] = None  # if set, translate while structuring
    model: Optional[str] = None


class ChatMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    scene_id: int
    messages: list[ChatMessage]
    model: Optional[str] = None


class SceneVersionOut(BaseModel):
    id: int
    scene_id: int
    content_hash: str
    created_at: datetime
    model_config = {"from_attributes": True}

class SceneVersionDetail(SceneVersionOut):
    content: str

class CreateVersionRequest(BaseModel):
    content: str


# ── Mention stats ─────────────────────────────────────────────────────────────

class MentionStatOut(BaseModel):
    codex_id: int
    scene_id: Optional[int]   # None for project-level aggregates
    count: int
    model_config = {"from_attributes": True}


# ── Time Config ───────────────────────────────────────────────────────────────

class TimeUnit(BaseModel):
    id: str
    singular: str
    plural: str
    count_per_parent: Optional[int] = None  # None = top-level unit
    value_names: list[str] = Field(default_factory=list)
    enabled: bool = True


class DayNightConfig(BaseModel):
    hours_per_day: int = 24
    night_start_hour: float = 20.0   # 0–hours_per_day
    night_duration: float = 10.0     # hours of darkness


DEFAULT_TIME_UNITS: list[dict] = [
    {"id": "age",    "singular": "Age",    "plural": "Ages",    "count_per_parent": None, "value_names": [], "enabled": False},
    {"id": "year",   "singular": "Year",   "plural": "Years",   "count_per_parent": 1000, "value_names": [], "enabled": True},
    {"id": "season", "singular": "Season", "plural": "Seasons", "count_per_parent": 4,    "value_names": ["Spring","Summer","Autumn","Winter"], "enabled": False},
    {"id": "month",  "singular": "Month",  "plural": "Months",  "count_per_parent": 12,   "value_names": [], "enabled": True},
    {"id": "day",    "singular": "Day",    "plural": "Days",    "count_per_parent": 30,   "value_names": [], "enabled": True},
    {"id": "hour",   "singular": "Hour",   "plural": "Hours",   "count_per_parent": 24,   "value_names": [], "enabled": True},
    {"id": "minute", "singular": "Minute", "plural": "Minutes", "count_per_parent": 60,   "value_names": [], "enabled": False},
    {"id": "second", "singular": "Second", "plural": "Seconds", "count_per_parent": 60,   "value_names": [], "enabled": False},
]

DEFAULT_DAY_NIGHT: dict = {
    "hours_per_day": 24,
    "night_start_hour": 20.0,
    "night_duration": 10.0,
}


class TimeConfig(BaseModel):
    units: list[TimeUnit] = Field(default_factory=lambda: [TimeUnit(**u) for u in DEFAULT_TIME_UNITS])
    day_night: DayNightConfig = Field(default_factory=DayNightConfig)


class TimeConfigOut(TimeConfig):
    pass

# ── Timeline Tracks & Events ──────────────────────────────────────────────────

class TimelineTrackCreate(BaseModel):
    name:        str            = "Timeline"
    color:       str            = "#6b7280"
    track_type:  str            = "parallel"
    order_index: int            = 0
    start_time:  Optional[dict] = None
    end_time:    Optional[dict] = None

class TimelineTrackUpdate(BaseModel):
    name:        Optional[str]  = None
    color:       Optional[str]  = None
    track_type:  Optional[str]  = None
    order_index: Optional[int]  = None
    start_time:  Optional[dict] = None
    end_time:    Optional[dict] = None

class TimelineTrackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:          int
    project_id:  int
    name:        str
    color:       str
    track_type:  str
    order_index: int
    start_time:  Optional[dict] = None
    end_time:    Optional[dict] = None

class TimelineEventCreate(BaseModel):
    track_id:    Optional[int]  = None
    title:       str            = "Untitled Event"
    description: Optional[str] = None
    scene_time:  Optional[dict] = None
    color:       str            = "#6b7280"

class TimelineEventUpdate(BaseModel):
    track_id:    Optional[int]  = None
    title:       Optional[str]  = None
    description: Optional[str] = None
    scene_time:  Optional[dict] = None
    color:       Optional[str]  = None

class TimelineEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:          int
    project_id:  int
    track_id:    Optional[int]  = None
    title:       str
    description: Optional[str] = None
    scene_time:  Optional[dict] = None
    color:       str


# ── Export ────────────────────────────────────────────────────────────────────

class ExportOptions(BaseModel):
    format: Literal["md", "tex", "epub-style", "pdf", "epub", "docx"] = "md"
    # Content selection — None means "all"
    scene_ids: Optional[list[int]] = None   # None = all scenes
    # Structural headings
    include_act_headings: bool = True
    include_chapter_headings: bool = True
    include_scene_headings: bool = True
    # Typography (LaTeX + EPUB)
    font: Optional[str] = None          # e.g. "EB Garamond"
    font_size: Literal["10pt", "11pt", "12pt"] = "12pt"
    line_spacing: Literal["1", "1.5", "2"] = "1.5"
    # LaTeX only
    paper_size: str = "a4paper"         # "a4paper" | "letterpaper"
    # EPUB style only
    text_color: str = "#1a1a1a"
    bg_color: str = "#ffffff"
    page_margin: str = "2em"
    # Author/metadata come from project.book_meta — not stored here
    # Output — when True the backend saves the file to {dataDir}/exports/ and
    # returns {"saved_to": <abs-path>, "filename": <name>} instead of streaming
    # the file as an attachment.  The frontend sets this whenever the user has
    # not explicitly chosen a different directory via the folder picker.
    save_to_disk: bool = False

    # ── Heading typography ─────────────────────────────────────────────────────
    heading_font: Optional[str] = None       # None = same as body font
    heading_align: str = "center"            # "center" | "left"
    h1_size: str = "2em"
    h2_size: str = "1.5em"
    h3_size: str = "1.25em"
    h3_style: str = "italic"                 # "italic" | "normal" | "bold"

    # ── Paragraph layout ───────────────────────────────────────────────────────
    paragraph_indent: str = "1.5em"          # "0" = block style (¶-gap, no indent)
    text_align: str = "justify"              # "justify" | "left"

    # ── PDF / LaTeX extras ────────────────────────────────────────────────────
    pdf_margin: str = "2.5cm"
    page_numbers: bool = True
    drop_caps: bool = False                  # first letter of each chapter as drop cap


# ── Query / Submission tracker ────────────────────────────────────────────────

_SUBMISSION_STATUS  = Literal["queried", "partial_requested", "full_requested", "offer", "pass", "no_response", "withdrawn"]
_SUBMISSION_TYPE    = Literal["query", "partial", "full", "unsolicited", "synopsis"]

class QuerySubmissionCreate(BaseModel):
    agent_name:        str                         = ""
    agency:            Optional[str]               = None
    email:             Optional[str]               = None
    submission_type:   _SUBMISSION_TYPE            = "query"
    date_sent:         Optional[str]               = None   # ISO date string
    response_deadline: Optional[str]               = None
    status:            _SUBMISSION_STATUS          = "queried"
    notes:             Optional[str]               = None

class QuerySubmissionUpdate(BaseModel):
    agent_name:        Optional[str]               = None
    agency:            Optional[str]               = None
    email:             Optional[str]               = None
    submission_type:   Optional[_SUBMISSION_TYPE]  = None
    date_sent:         Optional[str]               = None
    response_deadline: Optional[str]               = None
    status:            Optional[_SUBMISSION_STATUS] = None
    notes:             Optional[str]               = None

class QuerySubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                int
    project_id:        int
    agent_name:        str
    agency:            Optional[str]
    email:             Optional[str]
    submission_type:   str
    date_sent:         Optional[str]
    response_deadline: Optional[str]
    status:            str
    notes:             Optional[str]
    created_at:        datetime
    updated_at:        datetime


# ── Export profiles ───────────────────────────────────────────────────────────

class ExportProfileCreate(BaseModel):
    name:         str
    description:  Optional[str] = None
    options_json: str           = "{}"

class ExportProfileUpdate(BaseModel):
    name:         Optional[str] = None
    description:  Optional[str] = None
    options_json: Optional[str] = None

class ExportProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:           int
    project_id:   Optional[int]
    name:         str
    description:  Optional[str]
    is_builtin:   int
    options_json: str
    created_at:   datetime
    updated_at:   datetime


# ── Publisher profiles ────────────────────────────────────────────────────────

class PublisherProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                int
    short_name:        str
    name:              str
    category:          str
    description:       Optional[str]
    word_count_min:    Optional[int]
    word_count_max:    Optional[int]
    accepts_unagented: int
    submission_url:    Optional[str]
    options_json:      str
    is_active:         int


class BatchExportRequest(BaseModel):
    publisher_ids:           list[int]
    include_act_headings:    bool = False
    include_chapter_headings: bool = True
    include_scene_headings:  bool = False
    scene_ids:               Optional[list[int]] = None


# ── Analytics ─────────────────────────────────────────────────────────────────

class SceneAnalytics(BaseModel):
    scene_id: int
    scene_title: Optional[str]
    chapter_id: int
    chapter_title: str
    act_id: int
    act_title: str
    order_index: int
    word_count: int
    scene_type: Optional[str]
    avg_sentence_length: float
    dialogue_ratio: float


class ChapterAnalytics(BaseModel):
    chapter_id: int
    chapter_title: str
    act_id: int
    act_title: str
    word_count: int
    scene_count: int
    flesch_score: float
    grade_level: float
    scene_type_dist: dict[str, int]


class ProjectAnalytics(BaseModel):
    scenes: list[SceneAnalytics]
    chapters: list[ChapterAnalytics]
    total_word_count: int
    scene_type_dist: dict[str, int]


# ── Research ──────────────────────────────────────────────────────────────────

class ResearchItemCreate(BaseModel):
    title: Optional[str] = None
    url: Optional[str] = None
    text_content: Optional[str] = None
    linked_scene_id: Optional[int] = None
    linked_codex_id: Optional[int] = None
    tags: list[str] = Field(default_factory=list)


class ResearchItemUpdate(BaseModel):
    title: Optional[str] = None
    url: Optional[str] = None
    text_content: Optional[str] = None
    linked_scene_id: Optional[int] = None
    linked_codex_id: Optional[int] = None
    tags: Optional[list[str]] = None


class ResearchMediaOut(BaseModel):
    id: int
    kind: str          # "image" | "pdf"
    path: str
    order_index: int

    model_config = {"from_attributes": True}


class ResearchItemOut(BaseModel):
    id: int
    project_id: int
    title: Optional[str]
    url: Optional[str]
    url_title: Optional[str]
    url_description: Optional[str]
    url_image: Optional[str]
    text_content: Optional[str]
    media: list[ResearchMediaOut] = []
    linked_scene_id: Optional[int]
    linked_codex_id: Optional[int]
    tags: list[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _parse_tags(cls, data):
        if hasattr(data, "__dict__"):
            raw = getattr(data, "tags", None)
            if isinstance(raw, str):
                # Build a plain dict so Pydantic constructs from it — never mutate
                # the ORM object directly (that corrupts the SQLAlchemy identity map).
                d = {k: v for k, v in vars(data).items() if not k.startswith("_")}
                try:
                    d["tags"] = json.loads(raw)
                except Exception:
                    d["tags"] = []
                return d
        return data
