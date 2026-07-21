// ── Book metadata (EPUB Dublin Core fields) ───────────────────────────────────

export interface BookMeta {
  author?: string;          // dc:creator
  author_sort?: string;     // sort key, e.g. "Tolkien, J.R.R."
  subtitle?: string;        // secondary title
  language?: string;        // BCP 47 language code
  publisher?: string;       // dc:publisher
  published_date?: string;  // dc:date — YYYY or YYYY-MM-DD
  isbn?: string;            // dc:identifier scheme=ISBN
  rights?: string;          // dc:rights (copyright statement)
  series?: string;          // series name
  series_index?: string;    // position in series (numeric string, e.g. "0.5", "1")
  series_role?: string;     // human label, e.g. "Prequel", "Book 1", "Short Story"
  genre?: string;           // primary subject/category
  subjects?: string[];      // additional subject tags
  synopsis?: string;        // dc:description (separate from project.description)
  translator?: string;      // dc:contributor role="trl"
  editor?: string;          // dc:contributor role="edt"
}

// ── Series ────────────────────────────────────────────────────────────────────

export interface SeriesBook {
  id: number;
  title: string;
  description: string | null;
  series_index: string | null;
  series_role: string | null;
  cover_image: string | null;
  shared_codex_project_id: number | null;
  updated_at: string | null;
}

export interface SeriesGroup {
  name: string;
  books: SeriesBook[];
}

export interface SeriesData {
  series: SeriesGroup[];
  unserialized: SeriesBook[];
}

export interface Project {
  id: number;
  kind: "book" | "rpg";
  title: string;
  description: string | null;
  book_meta: BookMeta | null;
  shared_codex_project_id: number | null;
  shared_codex_project_title: string | null;
  cover_image: string | null;
  main_plot_color: string | null;
  plot_template: string | null;
  campaign_brief: string | null;
  created_at: string;
  updated_at: string;
}

export interface DmSession {
  id: number;
  project_id: number;
  title: string;
  status: "active" | "ended";
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface DmRollInfo {
  sides: number;
  count: number;
  modifier: number;
  advantage: "adv" | "dis" | null;
  purpose: string | null;
  results: number[];
  kept: number;
  total: number;
  manual: boolean;
}

export interface DmTurn {
  id: number;
  session_id: number;
  role: "player" | "dm" | "roll" | "system";
  content: string;
  rolls: DmRollInfo | null;
  effects: DmTurnEffects | null;
  created_at: string;
}

export interface SessionZeroAnswers {
  tone: string[];
  tone_free: string;
  genre: string;
  truths: string[];
  lines: string;
}

export interface DmPrefs {
  dice_mode?: "digital" | "physical";
  language?: string;
  session_zero?: SessionZeroAnswers;
  wildcards?: string[];
}

export interface WildcardCategory {
  path: string;
  count: number;
  depth: number;
}

export interface RpgGearItem {
  name: string;
  qty: number;
}

export interface RpgAppearance {
  size: string;
  build: string;
  hair_color: string;
  hair_style: string;
  eye_color: string;
  features: string[];
  scars: string[];
  tattoos: string[];
}

export interface RpgSheet {
  species: string;
  species2?: string | null;
  gender?: "male" | "female" | "div";
  class: string;
  level: number;
  stats: Record<string, number>;
  hp: { current: number; max: number };
  ac: number;
  abilities: string[];
  conditions: string[];
  gear: RpgGearItem[];
  appearance?: RpgAppearance;
  is_pc: boolean;
}

export interface DmScene {
  id: number;
  project_id: number;
  session_id: number | null;
  title: string;
  location_entry_id: number | null;
  present_npcs: string[];
  situation: string | null;
  is_current: boolean;
  oracle: Record<string, string> | null;
  created_at: string;
  updated_at: string;
}

export interface DmFact {
  id: number;
  project_id: number;
  kind: "fact" | "thread" | "secret" | "foreshadow";
  text: string;
  codex_entry_id: number | null;
  source_turn_id: number | null;
  status: "open" | "resolved";
  weight: number;
  created_at: string;
}

export interface DmRuleset {
  stats: string[];
  standard_array: number[];
  species: Record<string, { label: string; bonus: Record<string, number>; trait: string; name_style: string }>;
  classes: Record<string, { label: string; hit_die: number; priorities: string[]; ac_base: number; abilities: string[]; kit: string[] }>;
  halfblood: { note?: string };
  appearance: Record<string, unknown>;
}

export interface DmCharacterDraft {
  name: string;
  species: string;
  class_label: string;
  gender: "male" | "female" | "div";
  appearance: RpgAppearance;
  starting_currency: { name: string; amount: number } | null;
  rpg_sheet: RpgSheet;
  stat_rolls?: { dice: number[]; total: number }[];
}

export interface DmTurnEffects {
  effects: {
    new_npcs?: { name: string | null; species: string | null; class: string | null; role: string }[];
    codex_updates?: Record<string, unknown>[];
    scene?: { new_scene?: boolean; title?: string; situation?: string } | null;
    roll_request?: { sides: number; purpose: string } | null;
  };
  applied: {
    created_entries: { id: number; name: string }[];
    updated_entries: { id: number; prev_rpg_sheet: string | null }[];
    scene: { mode: "created" | "updated"; scene_id: number } | null;
  };
  undone: boolean;
}

export interface Act {
  id: number;
  project_id: number;
  title: string;
  order_index: number;
  created_at: string;
}

export interface Chapter {
  id: number;
  act_id: number;
  title: string;
  order_index: number;
  created_at: string;
}

export type SceneTime = Record<string, number>;  // unit_id → value

export interface Scene {
  id: number;
  chapter_id: number;
  title: string | null;
  content: string | null;
  synopsis: string | null;
  order_index: number;
  word_count: number;
  scene_time: SceneTime | null;
  subplot: string | null;
  pov_character_id: number | null;
  beat: string | null;
  scene_type: string | null;
  created_at: string;
  updated_at: string;
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export type SceneType = "action" | "dialogue" | "introspection" | "description" | "transition";

export interface SceneAnalytics {
  scene_id: number;
  scene_title: string | null;
  chapter_id: number;
  chapter_title: string;
  act_id: number;
  act_title: string;
  order_index: number;
  word_count: number;
  scene_type: string | null;
  avg_sentence_length: number;
  dialogue_ratio: number;
}

export interface ChapterAnalytics {
  chapter_id: number;
  chapter_title: string;
  act_id: number;
  act_title: string;
  word_count: number;
  scene_count: number;
  flesch_score: number;
  grade_level: number;
  scene_type_dist: Record<string, number>;
}

export interface ProjectAnalytics {
  scenes: SceneAnalytics[];
  chapters: ChapterAnalytics[];
  total_word_count: number;
  scene_type_dist: Record<string, number>;
}

// ── Research ──────────────────────────────────────────────────────────────────

export interface ResearchMedia {
  id: number;
  kind: 'image' | 'pdf';
  path: string;
  order_index: number;
}

export interface ResearchItem {
  id: number;
  project_id: number;
  tab: string;
  title: string | null;
  url: string | null;
  url_title: string | null;
  url_description: string | null;
  url_image: string | null;
  text_content: string | null;
  media: ResearchMedia[];
  linked_scene_id: number | null;
  linked_codex_id: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

// ── Corkboard ─────────────────────────────────────────────────────────────────

export interface CorkboardScene {
  id: number;
  title: string | null;
  synopsis: string | null;
  word_count: number;
  subplot: string | null;      // null = main plot column
  global_order: number;        // chronological position shared across columns
  stack_group: string | null;  // scenes sharing this value move as one stack
  chapter_id: number;
  node_x: number | null;       // React Flow canvas x position
  node_y: number | null;       // React Flow canvas y position
  pov_character_id: number | null;  // POV character for this scene
  beat: string | null;              // plot beat label
  card_color: string | null;        // per-card tint (hex), persisted server-side
}

export interface SceneConnection {
  id: number;
  source_scene_id: number;
  target_scene_id: number;
  connection_type: string;     // 'foreshadowing' | 'flashback' | 'dependency' | 'parallel' | …
  label: string | null;
}

export type CorkboardLayout = "custom" | "cascade" | "circle" | "concentric";

/** Per-project corkboard view preferences, persisted on the project. */
export interface CorkboardPrefs {
  layout?: CorkboardLayout;
  compact?: boolean;
  show_frames?: boolean;
  beat_template?: string | null;
  col_colors?: Record<string, string>;   // subplot column → hex
  stack_names?: Record<string, string>;  // stack_group → display name
  filter_subplots?: string[];            // empty/missing = show all
  filter_beats?: string[];               // empty/missing = show all
  circle_radius_mult?: number;           // size multiplier for Circle layout (−7…+5, step=1 → −70%…+50%)
  concentric_radius_mult?: number;       // size multiplier for Concentric layout
  board_style?: string;                  // board visual theme id (see boardStyles.ts)
}

export interface CorkboardData {
  scenes: CorkboardScene[];
  subplots: string[];          // names of extra subplot columns (main is implicit)
  connections: SceneConnection[];
  prefs: CorkboardPrefs;
}

/** Project-wide codex relations graph (GET /projects/{id}/graph). */
export interface RelationsGraphNode {
  id: string;                // entry name
  codex_id: number | null;
  entry_type: string;
  color: string;
}
export interface RelationsGraphEdge {
  source: string;            // entry name
  target: string;            // entry name
  type: string;
  relation_id: number | null;
  scene_title: string;
  via: string;
}
export interface RelationsGraph {
  nodes: RelationsGraphNode[];
  edges: RelationsGraphEdge[];
}

// Legacy structure types (used by old structure endpoint, kept for other uses)
export interface CorkboardChapter {
  id: number;
  title: string;
  order_index: number;
  scenes: CorkboardScene[];
}

export interface CorkboardAct {
  id: number;
  title: string;
  order_index: number;
  chapters: CorkboardChapter[];
}

// ── Time Config ───────────────────────────────────────────────────────────────

export interface TimeUnit {
  id: string;
  singular: string;
  plural: string;
  count_per_parent: number | null;
  value_names: string[];
  enabled: boolean;
}

export interface DayNightConfig {
  hours_per_day: number;
  night_start_hour: number;
  night_duration: number;
}

export interface TimeConfig {
  units: TimeUnit[];
  day_night: DayNightConfig;
}

export interface TimelineTrack {
  id: number;
  project_id: number;
  name: string;
  color: string;
  track_type: string;
  order_index: number;
  start_time: SceneTime | null;
  end_time: SceneTime | null;
}

export interface TimelineEventItem {
  id: number;
  project_id: number;
  track_id: number | null;
  title: string;
  description: string | null;
  scene_time: SceneTime | null;
  color: string;
}

export const DEFAULT_TIME_CONFIG: TimeConfig = {
  units: [
    { id: "age",    singular: "Age",    plural: "Ages",    count_per_parent: null, value_names: [],                                        enabled: false },
    { id: "year",   singular: "Year",   plural: "Years",   count_per_parent: 1000, value_names: [],                                        enabled: true  },
    { id: "season", singular: "Season", plural: "Seasons", count_per_parent: 4,    value_names: ["Spring","Summer","Autumn","Winter"],      enabled: false },
    { id: "month",  singular: "Month",  plural: "Months",  count_per_parent: 12,   value_names: [],                                        enabled: true  },
    { id: "day",    singular: "Day",    plural: "Days",    count_per_parent: 30,   value_names: [],                                        enabled: true  },
    { id: "hour",   singular: "Hour",   plural: "Hours",   count_per_parent: 24,   value_names: [],                                        enabled: true  },
    { id: "minute", singular: "Minute", plural: "Minutes", count_per_parent: 60,   value_names: [],                                        enabled: false },
    { id: "second", singular: "Second", plural: "Seconds", count_per_parent: 60,   value_names: [],                                        enabled: false },
  ],
  day_night: { hours_per_day: 24, night_start_hour: 20, night_duration: 10 },
};

export type EntryType = "character" | "location" | "item" | "relic" | "lore" | "custom";

export interface Currency {
  name: string;
  amount: number;
}

export interface Possession {
  entry_id: number;
  quantity: number;
  notes?: string;
}

export interface Relic {
  entry_id: number;
  notes?: string;
}

export interface CharacterInventory {
  currencies: Currency[];
  possessions: Possession[];
  relics?: Relic[];
}

export interface CodexEntry {
  id: number;
  project_id: number;
  name: string;
  aliases: string[];
  entry_type: string;
  description: string | null;
  notes: string | null;
  color: string;
  groups: string[];
  species: string | null;
  subtype: string | null;
  gender: "male" | "female" | "div" | null;
  tags: string[];
  is_main_char: boolean;
  inventory: CharacterInventory | null;
  rpg_sheet: RpgSheet | null;
  image_path: string | null;
  image_crop: { x: number; y: number; width: number; height: number } | null;
  name_type: string | null;
  /** "all" = all linked projects | "specific" = access list | "none" = owner only */
  share_mode: "all" | "specific" | "none";
  share_future: boolean;
  created_at: string;
  updated_at: string;
}

export interface CodexRelation {
  id: number;
  source_id: number;
  target_id: number;
  relation_type: string | null;
  created_at: string;
}

export interface CodexRelationResolved {
  id: number;
  source_id: number;
  target_id: number;
  other_id: number;
  other_name: string;
  other_color: string;
  other_type: EntryType;
  relation_type: string;
  direction: "from" | "to";
}

export interface Settings {
  id: number;
  has_api_key: boolean;
  default_model: string;
  default_chat_model: string | null;
  default_dm_model: string | null;
  wildcards_path: string | null;
  default_synopsis_model: string | null;
  default_codex_model: string | null;
  theme: string;
  enabled_models: string[];
  language: string;
  show_paragraph_numbers: boolean;
  typewriter_mode: boolean;
  typewriter_offset: number;
  session_timer_enabled: boolean;
  grammar_check_enabled: boolean;
  grammar_check_url: string;
  grammar_languages: string[];
  pandoc_enabled: boolean;
  pandoc_url: string;
  spacy_enabled: boolean;
  spacy_url: string;
  calibre_mode: "off" | "system" | "docker";
  calibre_enabled: boolean;
  calibre_url: string;
  vale_mode: "off" | "system" | "docker";
  vale_enabled: boolean;
  vale_url: string;
  vale_config_path: string | null;
  ai_disabled: boolean;
  sync_mirror_enabled: boolean;
  sync_local_dir: string | null;
  codex_highlight_enabled: boolean;
}

// ── Fragments ─────────────────────────────────────────────────────────────────

export const BUILTIN_TABS = ["snippets", "ideas", "archive"] as const;
export type BuiltinTab = typeof BUILTIN_TABS[number];

export interface Fragment {
  id: number;
  project_id: number;
  tab: string;
  title: string | null;
  content: string | null;
  category: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface FragmentTabs {
  builtin: string[];
  custom: string[];
  all: string[];
}

export type SaveStatus = "saved" | "saving" | "error" | "idle" | "unsaved";

// Flowing read view shapes
export interface ChapterReadScene {
  id: number;
  title: string;
  content: string;
}

export interface ChapterReadData {
  id: number;
  title: string;
  act_id: number;
  act_title: string;
  scenes: ChapterReadScene[];
}

export interface ActReadChapter {
  id: number;
  title: string;
  scenes: ChapterReadScene[];
}

export interface ActReadData {
  id: number;
  title: string;
  chapters: ActReadChapter[];
}

export interface ProjectSceneItem {
  id: number;
  title: string;
  chapter_title: string;
  act_title: string;
}

export interface AIPrompt {
  id: number;
  name: string;
  description: string;
  system: string;
  user_template: string;
  is_built_in: boolean;
  built_in_key: string | null;
  word_count: number;
}

export interface SceneVersion {
  id: number;
  scene_id: number;
  content_hash: string;
  created_at: string;
}

export interface SceneVersionDetail extends SceneVersion {
  content: string;
}

// ── Mention stats ─────────────────────────────────────────────────────────────

export interface MentionStat {
  codex_id: number;
  scene_id: number | null;
  count: number;
}

export interface SceneMentionStat {
  scene_id: number;
  scene_title: string;
  act_title: string;
  chapter_title: string;
  count: number;
}

// ── Achievements ─────────────────────────────────────────────────────────────

export type AchievementCategory = "streaks" | "words" | "codex" | "story" | "publishing" | "research";

export interface Achievement {
  key: string;
  chain: string;
  name: string;
  description: string;
  category: AchievementCategory;
  tier: 1 | 2 | 3 | 4 | 5;
  metric: string;
  threshold: number;
  earned: boolean;
  unlocked_at: string | null;
  progress: number;
  progress_max: number;
  show_toast: boolean;
  hidden?: boolean;
}

// ── Writing log / streaks ─────────────────────────────────────────────────────

export interface WritingLogEntry {
  date: string;   // YYYY-MM-DD
  words: number;
}

export interface GhostTextScene {
  scene_id: number;
  scene_title: string;
  act_title: string;
  chapter_title: string;
  ghost_texts: string[];
}

// ── Publishing ────────────────────────────────────────────────────────────────

export type SubmissionStatus =
  | "queried"
  | "partial_requested"
  | "full_requested"
  | "offer"
  | "pass"
  | "no_response"
  | "withdrawn";

export interface QuerySubmission {
  id: number;
  project_id: number;
  agent_name: string;
  agency: string | null;
  email: string | null;
  submission_type: string;
  date_sent: string | null;       // ISO date string
  response_deadline: string | null;
  status: SubmissionStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExportProfile {
  id: number;
  project_id: number | null;       // null = global built-in
  name: string;
  description: string | null;
  is_builtin: boolean;
  options_json: string;            // JSON-encoded ExportOptions partial
  created_at: string;
  updated_at: string;
}

export type PublisherCategory = "standard" | "us_trade" | "uk_trade" | "agency" | "genre" | "selfpub" | "de_trade" | "fr_trade" | "es_trade";

export interface PublisherProfile {
  id: number;
  short_name: string;              // filename prefix, e.g. "CurtisBrown_AU"
  name: string;
  category: PublisherCategory;
  description: string | null;
  word_count_min: number | null;
  word_count_max: number | null;
  accepts_unagented: number;       // 1 = yes
  submission_url: string | null;
  options_json: string;            // JSON-encoded ExportOptions fields
  is_active: number;
}
