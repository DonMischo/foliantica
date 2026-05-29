import json
from datetime import date, datetime, UTC, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, distinct, text
from sqlalchemy.orm import Session

from database import get_db
from models import (
    AchievementUnlock, WritingLog, CodexEntry, CodexRelation,
    MentionStat, Scene, Project, QuerySubmission, ResearchItem,
)

router = APIRouter(prefix="/api", tags=["achievements"])

# ── Achievement definitions ────────────────────────────────────────────────────
# key, chain, name, desc, cat, tier, metric, threshold

ACHIEVEMENTS = [
    # ── Streaks ───────────────────────────────────────────────────────────────
    {"key": "streak_1",   "chain": "streak", "name": "First Spark",       "desc": "Every odyssey starts with a single day. The page is open.",                                "cat": "streaks", "tier": 1, "metric": "longest_streak", "threshold": 1},
    {"key": "streak_3",   "chain": "streak", "name": "Three's Company",   "desc": "Three days in — the habit is quietly taking root.",                                        "cat": "streaks", "tier": 1, "metric": "longest_streak", "threshold": 3},
    {"key": "streak_7",   "chain": "streak", "name": "Week Warrior",      "desc": "'Write every day.' — Ray Bradbury lived by it. So do you, for one week now.",             "cat": "streaks", "tier": 2, "metric": "longest_streak", "threshold": 7},
    {"key": "streak_14",  "chain": "streak", "name": "Fortnight Fighter", "desc": "Two full weeks. Trollope wrote two hours every morning, never missing a day.",            "cat": "streaks", "tier": 2, "metric": "longest_streak", "threshold": 14},
    {"key": "streak_30",  "chain": "streak", "name": "Monthly Maven",     "desc": "Thirty days of showing up. Murakami ran and wrote every day for decades.",               "cat": "streaks", "tier": 3, "metric": "longest_streak", "threshold": 30},
    {"key": "streak_90",  "chain": "streak", "name": "Quarter Champion",  "desc": "A full season of words. 'The secret of getting ahead is getting started.' — Twain",      "cat": "streaks", "tier": 4, "metric": "longest_streak", "threshold": 90},
    {"key": "streak_180", "chain": "streak", "name": "Half-Year Hero",    "desc": "Half a year of daily prose. Discipline is the quiet superpower of all great authors.",    "cat": "streaks", "tier": 4, "metric": "longest_streak", "threshold": 180},
    {"key": "streak_365", "chain": "streak", "name": "Year of Words",     "desc": "'Write every day of your life.' — Ray Bradbury. You just completed the year.",            "cat": "streaks", "tier": 5, "metric": "longest_streak", "threshold": 365},

    # ── Total words ───────────────────────────────────────────────────────────
    {"key": "words_100",  "chain": "words", "name": "First Words",      "desc": "'In the beginning was the Word.' — John 1:1. Yours are written now.",                       "cat": "words", "tier": 1, "metric": "total_words", "threshold": 100},
    {"key": "words_1k",   "chain": "words", "name": "Getting Started",  "desc": "A thousand words. Every novel ever written started with exactly this.",                     "cat": "words", "tier": 1, "metric": "total_words", "threshold": 1_000},
    {"key": "words_5k",   "chain": "words", "name": "In the Flow",      "desc": "Five thousand words — enough for a Raymond Carver short story. Keep going.",               "cat": "words", "tier": 2, "metric": "total_words", "threshold": 5_000},
    {"key": "words_10k",  "chain": "words", "name": "Committed",        "desc": "'The first draft of anything is garbage.' — Hemingway. Write the garbage anyway.",          "cat": "words", "tier": 2, "metric": "total_words", "threshold": 10_000},
    {"key": "words_20k",  "chain": "words", "name": "Short Story",      "desc": "Long enough for a Kafka novella. Short enough to write another.",                          "cat": "words", "tier": 2, "metric": "total_words", "threshold": 20_000},
    {"key": "words_40k",  "chain": "words", "name": "Novella",          "desc": "'The Old Man and the Sea' runs to 27k. You've already surpassed Hemingway's masterpiece.", "cat": "words", "tier": 3, "metric": "total_words", "threshold": 40_000},
    {"key": "words_80k",  "chain": "words", "name": "Novel",            "desc": "Full novel length. 'Pride and Prejudice' took Austen years — you've reached her range.",   "cat": "words", "tier": 3, "metric": "total_words", "threshold": 80_000},
    {"key": "words_100k", "chain": "words", "name": "Centennial",       "desc": "'The Great Gatsby' is only 47k. You have written it twice over and kept going.",           "cat": "words", "tier": 4, "metric": "total_words", "threshold": 100_000},
    {"key": "words_250k", "chain": "words", "name": "Prolific",         "desc": "A quarter million. Tolstoy's 'War and Peace' is 580k — you are closing in on Tolstoy.",   "cat": "words", "tier": 4, "metric": "total_words", "threshold": 250_000},
    {"key": "words_500k", "chain": "words", "name": "Half a Million",   "desc": "'Les Misérables', 'Moby-Dick', 'Don Quixote' — you now write at their scale.",            "cat": "words", "tier": 5, "metric": "total_words", "threshold": 500_000},
    {"key": "words_1m",   "chain": "words", "name": "The Million Club", "desc": "King writes 2,000 words a day. You've just matched 500 of his sessions.",                 "cat": "words", "tier": 5, "metric": "total_words", "threshold": 1_000_000},
    {"key": "words_2m",   "chain": "words", "name": "Dynasty",          "desc": "Two million words. Some authors publish yearly for decades — you outpace them.",           "cat": "words", "tier": 5, "metric": "total_words", "threshold": 2_000_000},
    {"key": "words_5m",   "chain": "words", "name": "The Epics",        "desc": "Five million. Tolkien, Pratchett, Asimov — the company of the truly prolific.",            "cat": "words", "tier": 5, "metric": "total_words", "threshold": 5_000_000},
    {"key": "words_10m",  "chain": "words", "name": "Infinite Ink",     "desc": "'The pen is mightier than the sword.' — Bulwer-Lytton. Yours has proven it ten times.",   "cat": "words", "tier": 5, "metric": "total_words", "threshold": 10_000_000},

    # ── Best single day ───────────────────────────────────────────────────────
    {"key": "day_500",  "chain": "best_day", "name": "Warm-Up",      "desc": "Five hundred words — Hemingway's personal daily minimum. A solid session.",              "cat": "words", "tier": 1, "metric": "best_day", "threshold": 500},
    {"key": "day_2k",   "chain": "best_day", "name": "Big Day",       "desc": "Two thousand in one session — Stephen King's daily target. Running with the greats.",    "cat": "words", "tier": 2, "metric": "best_day", "threshold": 2_000},
    {"key": "day_5k",   "chain": "best_day", "name": "Marathon",      "desc": "Five thousand in one day. Kerouac typed On the Road in three weeks — your pace matches.", "cat": "words", "tier": 3, "metric": "best_day", "threshold": 5_000},
    {"key": "day_10k",  "chain": "best_day", "name": "Ultramarathon", "desc": "Ten thousand words in a single day. 'I wrote it in a fugue.' — probably you, today.",    "cat": "words", "tier": 5, "metric": "best_day", "threshold": 10_000},

    # ── Codex entries ─────────────────────────────────────────────────────────
    {"key": "codex_1",   "chain": "codex", "name": "Ink Drop",       "desc": "Your first entry. A character, place, or idea given a name and a home.",               "cat": "codex", "tier": 1, "metric": "codex_entries", "threshold": 1},
    {"key": "codex_5",   "chain": "codex", "name": "Quill",           "desc": "Five entries — the world is beginning to breathe.",                                    "cat": "codex", "tier": 1, "metric": "codex_entries", "threshold": 5},
    {"key": "codex_15",  "chain": "codex", "name": "Scribe",          "desc": "Tolkien spent years building Middle-earth before writing a word of The Hobbit.",       "cat": "codex", "tier": 2, "metric": "codex_entries", "threshold": 15},
    {"key": "codex_30",  "chain": "codex", "name": "Chronicler",      "desc": "Thirty entries. A world deserving of its own maps and mythology.",                    "cat": "codex", "tier": 2, "metric": "codex_entries", "threshold": 30},
    {"key": "codex_75",  "chain": "codex", "name": "Lore Keeper",     "desc": "The Silmarillion took Tolkien his entire lifetime. You're building faster.",          "cat": "codex", "tier": 3, "metric": "codex_entries", "threshold": 75},
    {"key": "codex_150", "chain": "codex", "name": "Grand Archivist", "desc": "One hundred and fifty entries. A secondary world with genuine, layered depth.",       "cat": "codex", "tier": 3, "metric": "codex_entries", "threshold": 150},
    {"key": "codex_300", "chain": "codex", "name": "World Architect", "desc": "The Encyclopedia of Middle-earth lists over 2,000 entries. You're on your way.",      "cat": "codex", "tier": 4, "metric": "codex_entries", "threshold": 300},
    {"key": "codex_500", "chain": "codex", "name": "Mythographer",    "desc": "Five hundred entries — a mythology in its own right, built myth by myth.",            "cat": "codex", "tier": 4, "metric": "codex_entries", "threshold": 500},
    {"key": "codex_750", "chain": "codex", "name": "Omniscient",      "desc": "Seven hundred and fifty. You know this world better than its inhabitants do.",        "cat": "codex", "tier": 5, "metric": "codex_entries", "threshold": 750},
    {"key": "codex_1k",  "chain": "codex", "name": "God of Worlds",   "desc": "'In the beginning…' — a thousand entries later, your universe is self-sustaining.",  "cat": "codex", "tier": 5, "metric": "codex_entries", "threshold": 1_000},

    # ── Codex relations ───────────────────────────────────────────────────────
    {"key": "rel_1",   "chain": "relations", "name": "First Link",           "desc": "Two souls connected by a thread. Every web begins here.",                             "cat": "codex", "tier": 1, "metric": "codex_relations", "threshold": 1},
    {"key": "rel_10",  "chain": "relations", "name": "Web Weaver",           "desc": "'No man is an island.' — John Donne was writing about your codex.",                  "cat": "codex", "tier": 2, "metric": "codex_relations", "threshold": 10},
    {"key": "rel_25",  "chain": "relations", "name": "Networker",            "desc": "Twenty-five links. Your cast is becoming a community with its own history.",         "cat": "codex", "tier": 3, "metric": "codex_relations", "threshold": 25},
    {"key": "rel_50",  "chain": "relations", "name": "Social Architect",     "desc": "Fifty connections. The web of relationships is what holds a world together.",        "cat": "codex", "tier": 3, "metric": "codex_relations", "threshold": 50},
    {"key": "rel_100", "chain": "relations", "name": "Cosmic Nexus",         "desc": "'Everything is connected.' — the oldest truth in storytelling. A hundred links.",    "cat": "codex", "tier": 4, "metric": "codex_relations", "threshold": 100},
    {"key": "rel_250", "chain": "relations", "name": "All Things Connected", "desc": "In Dostoevsky, everyone is linked by three degrees. You've mapped your own web.",    "cat": "codex", "tier": 5, "metric": "codex_relations", "threshold": 250},

    # ── Codex mentioned in prose ──────────────────────────────────────────────
    {"key": "mentioned_1",   "chain": "mentioned", "name": "Shadow",               "desc": "A name appears in the prose. A character earns their place.",                      "cat": "codex", "tier": 1, "metric": "codex_mentioned", "threshold": 1},
    {"key": "mentioned_10",  "chain": "mentioned", "name": "Presence",             "desc": "Ten entries living in your scenes. The world is populating itself.",               "cat": "codex", "tier": 2, "metric": "codex_mentioned", "threshold": 10},
    {"key": "mentioned_25",  "chain": "mentioned", "name": "Cast of Characters",   "desc": "Twenty-five voices woven through. Even Tolstoy started with a cast this size.",   "cat": "codex", "tier": 3, "metric": "codex_mentioned", "threshold": 25},
    {"key": "mentioned_50",  "chain": "mentioned", "name": "Living World",         "desc": "Fifty entries breathe in your prose. The world feels genuinely inhabited.",        "cat": "codex", "tier": 4, "metric": "codex_mentioned", "threshold": 50},
    {"key": "mentioned_100", "chain": "mentioned", "name": "Everyone Has a Role",  "desc": "A hundred presences across your scenes. Every walk-on has a story behind them.",  "cat": "codex", "tier": 4, "metric": "codex_mentioned", "threshold": 100},
    {"key": "mentioned_200", "chain": "mentioned", "name": "Woven Into the Prose", "desc": "Two hundred entities alive on the page. The lore is no longer background — it is the story.", "cat": "codex", "tier": 5, "metric": "codex_mentioned", "threshold": 200},

    # ── Inventory tracking ────────────────────────────────────────────────────
    {"key": "inventory_1",  "chain": "inventory", "name": "Pack It Up",      "desc": "Someone carries something. Objects give characters weight — and history.",              "cat": "codex", "tier": 1, "metric": "inventory_items", "threshold": 1},
    {"key": "inventory_10", "chain": "inventory", "name": "Quartermaster",   "desc": "'The Ring must be carried by someone.' — Tolkien knew the weight of objects.",          "cat": "codex", "tier": 2, "metric": "inventory_items", "threshold": 10},
    {"key": "inventory_50", "chain": "inventory", "name": "Master of Goods", "desc": "Fifty items tracked. Your world has economy, scarcity, and real stakes.",               "cat": "codex", "tier": 3, "metric": "inventory_items", "threshold": 50},

    # ── Projects ──────────────────────────────────────────────────────────────
    {"key": "project_1", "chain": "projects", "name": "Project Launcher",  "desc": "Every great library begins with one book.",                                              "cat": "story", "tier": 1, "metric": "projects", "threshold": 1},
    {"key": "project_3", "chain": "projects", "name": "Juggler",           "desc": "Three worlds on the go. Dickens once serialised three novels simultaneously.",            "cat": "story", "tier": 2, "metric": "projects", "threshold": 3},
    {"key": "project_5", "chain": "projects", "name": "Multi-World Writer","desc": "Five projects. Your imagination refuses to be contained to one universe.",              "cat": "story", "tier": 3, "metric": "projects", "threshold": 5},

    # ── Scenes ────────────────────────────────────────────────────────────────
    {"key": "scenes_10",  "chain": "scenes", "name": "Scene Starter",  "desc": "Ten scenes. The structure of a story is beginning to emerge.",                              "cat": "story", "tier": 1, "metric": "scene_count", "threshold": 10},
    {"key": "scenes_50",  "chain": "scenes", "name": "Scene Writer",   "desc": "Fifty scenes — half a novel's worth of moments and decisions.",                             "cat": "story", "tier": 2, "metric": "scene_count", "threshold": 50},
    {"key": "scenes_100", "chain": "scenes", "name": "Storyteller",    "desc": "A hundred scenes. 'A story is a series of scenes.' Yours are well into three figures.",     "cat": "story", "tier": 3, "metric": "scene_count", "threshold": 100},
    {"key": "scenes_250", "chain": "scenes", "name": "World Spinner",  "desc": "Two hundred and fifty scenes. Some novelists never write this many in a career.",           "cat": "story", "tier": 4, "metric": "scene_count", "threshold": 250},
    {"key": "scenes_500", "chain": "scenes", "name": "Prolific Author","desc": "Five hundred scenes. At this pace you'll outlast any deadline ever set.",                   "cat": "story", "tier": 5, "metric": "scene_count", "threshold": 500},

    # ── Scene tagging ─────────────────────────────────────────────────────────
    {"key": "typed_1",       "chain": "typed_scenes", "name": "Genre Aware",      "desc": "You know what kind of scene you're writing. Intention is the beginning of craft.",    "cat": "story", "tier": 1, "metric": "typed_scene_count", "threshold": 1},
    {"key": "typed_10",      "chain": "typed_scenes", "name": "Scene Classifier", "desc": "Ten typed scenes. Structure is not a cage — it is a skeleton.",                       "cat": "story", "tier": 2, "metric": "typed_scene_count", "threshold": 10},
    {"key": "typed_50",      "chain": "typed_scenes", "name": "Scene Architect",  "desc": "Fifty scenes tagged. You can see the machinery beneath the story now.",               "cat": "story", "tier": 3, "metric": "typed_scene_count", "threshold": 50},
    {"key": "typed_100",     "chain": "typed_scenes", "name": "Master Plotter",   "desc": "A hundred typed scenes. You don't write scenes anymore — you engineer them.",         "cat": "story", "tier": 4, "metric": "typed_scene_count", "threshold": 100},
    {"key": "scene_types_5", "chain": "typed_scenes", "name": "Five Colors",      "desc": "All five scene types used. Action, dialogue, introspection, description, transition.", "cat": "story", "tier": 3, "metric": "scene_types_used",  "threshold": 5},

    # ── Corkboard ─────────────────────────────────────────────────────────────
    {"key": "corkboard_1",  "chain": "corkboard", "name": "On the Board",    "desc": "First card up. Hitchcock planned every scene on index cards before filming.",           "cat": "story", "tier": 1, "metric": "corkboard_scenes", "threshold": 1},
    {"key": "corkboard_10", "chain": "corkboard", "name": "Board Architect", "desc": "Ten cards arranged. The story is taking shape on the wall.",                            "cat": "story", "tier": 2, "metric": "corkboard_scenes", "threshold": 10},
    {"key": "corkboard_50", "chain": "corkboard", "name": "Grand Planner",   "desc": "Fifty scenes laid out. From here you can see the whole shape of the thing.",            "cat": "story", "tier": 3, "metric": "corkboard_scenes", "threshold": 50},

    # ── Timeline ──────────────────────────────────────────────────────────────
    {"key": "timeline_1",   "chain": "timeline", "name": "First Event",     "desc": "A moment pinned in time. History begins with a single recorded event.",                  "cat": "story", "tier": 1, "metric": "timeline_events", "threshold": 1},
    {"key": "timeline_10",  "chain": "timeline", "name": "History Maker",   "desc": "'The past is never dead. It's not even past.' — Faulkner. You are tracking it.",        "cat": "story", "tier": 2, "metric": "timeline_events", "threshold": 10},
    {"key": "timeline_50",  "chain": "timeline", "name": "World Historian", "desc": "Fifty events across time. Your world has a history deep enough to feel real.",           "cat": "story", "tier": 3, "metric": "timeline_events", "threshold": 50},
    {"key": "timeline_100", "chain": "timeline", "name": "Epoch Architect", "desc": "Tolkien kept detailed timelines for Arda spanning thousands of years. So do you.",       "cat": "story", "tier": 4, "metric": "timeline_events", "threshold": 100},

    # ── Fragments / Snippets ──────────────────────────────────────────────────
    {"key": "snippet_1",  "chain": "snippets", "name": "First Fragment",   "desc": "'Save everything.' The first fragment is the seed of an archive.",                        "cat": "story", "tier": 1, "metric": "fragment_count", "threshold": 1},
    {"key": "snippet_10", "chain": "snippets", "name": "Snippet Hoarder",  "desc": "Ten fragments in the vault. Ideas are currency — save before you spend.",               "cat": "story", "tier": 2, "metric": "fragment_count", "threshold": 10},
    {"key": "snippet_50", "chain": "snippets", "name": "Fragment Archive", "desc": "Fifty fragments. The deleted scenes of a mind that never stops writing.",                 "cat": "story", "tier": 3, "metric": "fragment_count", "threshold": 50},

    # ── Custom time system ────────────────────────────────────────────────────
    {"key": "time_lord", "chain": "time_system", "name": "Time Lord", "desc": "A custom calendar for a custom world. Tolkien invented an entire astronomy for Arda.", "cat": "story", "tier": 2, "metric": "time_system_used", "threshold": 1},

    # ── Project info ──────────────────────────────────────────────────────────
    {"key": "project_meta",      "chain": "project_info", "name": "Author Profile",   "desc": "Title, author, genre — the metadata that turns a draft into a real book.",          "cat": "story",       "tier": 1, "metric": "project_info_set",  "threshold": 1},
    {"key": "project_meta_full", "chain": "project_info", "name": "Submission Ready", "desc": "Every field complete. Your submission package is ready to go out the door.",          "cat": "publishing", "tier": 3, "metric": "project_info_full", "threshold": 1},

    # ── Publishing — queries ──────────────────────────────────────────────────
    {"key": "query_1",  "chain": "queries",   "name": "In the Arena",    "desc": "'It is not the critic who counts.' — Roosevelt. You stepped into the arena.",               "cat": "publishing", "tier": 1, "metric": "queries_sent",    "threshold": 1},
    {"key": "query_10", "chain": "queries",   "name": "Thick Skin",      "desc": "Ten queries out. 'Harry Potter' was rejected twelve times. Keep going.",                   "cat": "publishing", "tier": 2, "metric": "queries_sent",    "threshold": 10},
    {"key": "query_25", "chain": "queries",   "name": "Battle-Hardened", "desc": "Twenty-five queries. King papered his wall with rejection slips — then sold Carrie.",      "cat": "publishing", "tier": 3, "metric": "queries_sent",    "threshold": 25},
    {"key": "query_50", "chain": "queries",   "name": "The Grind",       "desc": "Fifty queries. Perseverance is the one skill no writing workshop can teach.",               "cat": "publishing", "tier": 4, "metric": "queries_sent",    "threshold": 50},
    {"key": "partial",  "chain": "agent_req", "name": "Partial Victory", "desc": "An agent wants to read more. The door is ajar — push it.",                                 "cat": "publishing", "tier": 3, "metric": "queries_partial", "threshold": 1},
    {"key": "full_req", "chain": "agent_req", "name": "Full Send",       "desc": "A full manuscript requested. The most exciting sentence in publishing: 'Send it all.'",     "cat": "publishing", "tier": 4, "metric": "queries_full",    "threshold": 1},
    {"key": "offer",    "chain": "agent_req", "name": "The Call",        "desc": "An offer of representation. This is the phone call every writer dreams about.",             "cat": "publishing", "tier": 5, "metric": "queries_offer",   "threshold": 1},

    # ── Publishing — exports ──────────────────────────────────────────────────
    {"key": "export_1",   "chain": "exports", "name": "First Print",     "desc": "Your first export — the manuscript takes physical form for the first time.",               "cat": "publishing", "tier": 1, "metric": "export_count", "threshold": 1},
    {"key": "export_10",  "chain": "exports", "name": "Print Run",       "desc": "Ten exports. Each revision cycle brings the prose closer to what it should be.",           "cat": "publishing", "tier": 2, "metric": "export_count", "threshold": 10},
    {"key": "export_50",  "chain": "exports", "name": "Publisher Ready", "desc": "Fifty exports. You've refined the process as thoroughly as the prose itself.",             "cat": "publishing", "tier": 3, "metric": "export_count", "threshold": 50},
    {"key": "export_100", "chain": "exports", "name": "Press Master",    "desc": "A hundred exports. You live at the intersection of craft and final production.",           "cat": "publishing", "tier": 4, "metric": "export_count", "threshold": 100},

    # ── Currency tracking ─────────────────────────────────────────────────────
    {"key": "currency_1",  "chain": "currency", "name": "Coin Keeper",    "desc": "A character holds currency. Every economy needs its first transaction.",                   "cat": "codex", "tier": 1, "metric": "inventory_currency", "threshold": 1},
    {"key": "currency_5",  "chain": "currency", "name": "Banker",         "desc": "Five characters with purses tracked. 'Money is the root of a good plot.' — paraphrased.", "cat": "codex", "tier": 2, "metric": "inventory_currency", "threshold": 5},
    {"key": "currency_10", "chain": "currency", "name": "Treasurer",      "desc": "Ten characters with coin. Even Tolkien had to account for hobbit gold in the Shire.",     "cat": "codex", "tier": 3, "metric": "inventory_currency", "threshold": 10},

    # ── Relic tracking ────────────────────────────────────────────────────────
    {"key": "relic_1",  "chain": "relics", "name": "Keepsake",          "desc": "A relic entered. 'The ring, Mr. Frodo. It must be destroyed.' — Tolkien.",                  "cat": "codex", "tier": 1, "metric": "inventory_relics", "threshold": 1},
    {"key": "relic_5",  "chain": "relics", "name": "Collector",         "desc": "Five relics catalogued. Every artifact has a story before the story begins.",               "cat": "codex", "tier": 2, "metric": "inventory_relics", "threshold": 5},
    {"key": "relic_20", "chain": "relics", "name": "Keeper of Relics",  "desc": "Twenty relics. 'The past is never dead.' — Faulkner. You've proven it twenty times.",       "cat": "codex", "tier": 3, "metric": "inventory_relics", "threshold": 20},

    # ── Settings / Setup ──────────────────────────────────────────────────────
    {"key": "grammar_active", "chain": "grammar", "name": "Grammar Police", "desc": "The grammar checker is live. 'Good grammar is clear thinking made visible.'",           "cat": "research",   "tier": 1, "metric": "grammar_enabled", "threshold": 1},
    {"key": "pandoc_active",  "chain": "pandoc",  "name": "Typesetter",     "desc": "Professional exports enabled. 'The medium is the message.' — Marshall McLuhan",        "cat": "publishing", "tier": 2, "metric": "pandoc_enabled",  "threshold": 1},

    # ── Research ──────────────────────────────────────────────────────────────
    {"key": "research_1",  "chain": "research", "name": "Curious Mind", "desc": "The first research item saved. 'The more I read, the more I know what to write.'",         "cat": "research", "tier": 1, "metric": "research_items", "threshold": 1},
    {"key": "research_10", "chain": "research", "name": "Deep Dive",    "desc": "Ten items collected. 'For every page written, ten must be read.' — the writer's equation.", "cat": "research", "tier": 2, "metric": "research_items", "threshold": 10},
    {"key": "research_25", "chain": "research", "name": "Scholar",      "desc": "Twenty-five items. You research as rigorously as you write.",                               "cat": "research", "tier": 3, "metric": "research_items", "threshold": 25},
    {"key": "research_50", "chain": "research", "name": "Librarian",    "desc": "'A library is a hospital for the mind.' — Anonymous. Yours is well-stocked.",               "cat": "research", "tier": 4, "metric": "research_items", "threshold": 50},

    # ── Stats engagement ──────────────────────────────────────────────────────
    {"key": "stats_view",    "chain": "stats", "name": "Self Aware",  "desc": "First visit to the stats page. 'What gets measured gets managed.' — Drucker",           "cat": "research", "tier": 1, "metric": "stats_views", "threshold": 1},
    {"key": "stats_addict",  "chain": "stats", "name": "Data Driven", "desc": "Ten visits. You study your output as carefully as you study your prose.",                    "cat": "research", "tier": 2, "metric": "stats_views", "threshold": 10},
    {"key": "stats_analyst", "chain": "stats", "name": "The Analyst", "desc": "Fifty visits. You track your craft the way Hemingway tracked his daily word count.",         "cat": "research", "tier": 3, "metric": "stats_views", "threshold": 50},
]

# Deduplicate by key (in case of copy-paste error above)
_seen: set[str] = set()
ACHIEVEMENTS = [a for a in ACHIEVEMENTS if not (a["key"] in _seen or _seen.add(a["key"]))]  # type: ignore[func-returns-value]

# Achievement keys that are only earnable through AI feature usage.
# Extend this set when AI-usage tracking is added to the app.
AI_ACHIEVEMENT_KEYS: frozenset[str] = frozenset()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _compute_streaks(dates: list[str]) -> tuple[int, int]:
    if not dates:
        return 0, 0
    date_objects = sorted({date.fromisoformat(d) for d in dates})
    longest = cur = 1
    for i in range(1, len(date_objects)):
        if (date_objects[i] - date_objects[i - 1]).days == 1:
            cur += 1
            if cur > longest:
                longest = cur
        else:
            cur = 1
    today = date.today()
    current = 0
    check = today
    date_set = set(date_objects)
    while check in date_set:
        current += 1
        check -= timedelta(days=1)
    return current, longest


def _safe(db: Session, query: str, default=0):
    try:
        return db.execute(text(query)).scalar() or default
    except Exception:
        return default


def _compute_metrics(db: Session) -> dict[str, int]:
    log_rows = (
        db.query(WritingLog.date, func.sum(WritingLog.words_added).label("words"))
        .group_by(WritingLog.date)
        .all()
    )
    total_words   = db.query(func.sum(Scene.word_count)).scalar() or 0
    best_day      = max((r.words for r in log_rows), default=0)
    active_dates  = [r.date for r in log_rows if r.words > 0]
    current_streak, longest_streak = _compute_streaks(active_dates)

    codex_entries   = db.query(func.count(CodexEntry.id)).scalar() or 0
    codex_relations = db.query(func.count(CodexRelation.id)).scalar() or 0
    codex_mentioned = (
        db.query(func.count(distinct(MentionStat.codex_id)))
        .filter(MentionStat.count > 0)
        .scalar() or 0
    )

    projects         = db.query(func.count(Project.id)).scalar() or 0
    scene_count      = db.query(func.count(Scene.id)).scalar() or 0
    scene_types_used = (
        db.query(func.count(distinct(Scene.scene_type)))
        .filter(Scene.scene_type.isnot(None))
        .scalar() or 0
    )

    queries_sent    = db.query(func.count(QuerySubmission.id)).scalar() or 0
    queries_partial = db.query(func.count(QuerySubmission.id)).filter(QuerySubmission.status == "partial_requested").scalar() or 0
    queries_full    = db.query(func.count(QuerySubmission.id)).filter(QuerySubmission.status == "full_requested").scalar()   or 0
    queries_offer   = db.query(func.count(QuerySubmission.id)).filter(QuerySubmission.status == "offer").scalar()            or 0
    research_items  = db.query(func.count(ResearchItem.id)).scalar() or 0

    # ── New metrics via raw SQL ───────────────────────────────────────────────
    typed_scene_count = _safe(db, "SELECT COUNT(*) FROM scenes WHERE scene_type IS NOT NULL")
    corkboard_scenes  = _safe(db, "SELECT COUNT(*) FROM scenes WHERE node_x IS NOT NULL")
    timeline_events   = _safe(db, "SELECT COUNT(*) FROM timeline_events")
    fragment_count    = _safe(db, "SELECT COUNT(*) FROM fragments")
    # Parse inventory JSON once for items / currency / relics
    inventory_items = inventory_currency = inventory_relics = 0
    try:
        inv_rows = db.execute(text(
            "SELECT inventory FROM codex_entries WHERE inventory IS NOT NULL AND inventory != '' AND inventory != 'null'"
        )).fetchall()
        for (inv_str,) in inv_rows:
            try:
                inv = json.loads(inv_str)
                inventory_items    += len(inv.get("possessions", []))
                inventory_relics   += len(inv.get("relics", []))
                if inv.get("currencies"):
                    inventory_currency += 1
            except Exception:
                pass
    except Exception:
        pass
    time_system_used  = min(1, _safe(db, "SELECT COUNT(*) FROM projects WHERE time_config IS NOT NULL AND time_config NOT IN ('{}','null','')"))

    # Settings from user_settings (first row)
    grammar_enabled = pandoc_enabled = export_count = stats_views = ai_disabled = 0
    try:
        row = db.execute(text(
            "SELECT grammar_check_enabled, pandoc_enabled, export_count, stats_views, ai_disabled FROM user_settings LIMIT 1"
        )).fetchone()
        if row:
            grammar_enabled = int(row[0] or 0)
            pandoc_enabled  = int(row[1] or 0)
            export_count    = int(row[2] or 0)
            stats_views     = int(row[3] or 0)
            ai_disabled     = int(row[4] or 0)
    except Exception:
        pass

    # Project info: any book_meta with a title
    project_info_set = project_info_full = 0
    try:
        rows = db.execute(text(
            "SELECT book_meta FROM projects WHERE book_meta IS NOT NULL AND book_meta NOT IN ('{}','null','')"
        )).fetchall()
        for (bm,) in rows:
            try:
                meta = json.loads(bm or "{}")
                if meta.get("title"):
                    project_info_set = 1
                if meta.get("title") and meta.get("author") and meta.get("genre"):
                    project_info_full = 1
                    break
            except Exception:
                pass
    except Exception:
        pass

    return {
        "current_streak":   current_streak,
        "longest_streak":   longest_streak,
        "total_words":      total_words,
        "best_day":         best_day,
        "codex_entries":    codex_entries,
        "codex_relations":  codex_relations,
        "codex_mentioned":  codex_mentioned,
        "projects":         projects,
        "scene_count":      scene_count,
        "scene_types_used": scene_types_used,
        "queries_sent":     queries_sent,
        "queries_partial":  queries_partial,
        "queries_full":     queries_full,
        "queries_offer":    queries_offer,
        "research_items":   research_items,
        "typed_scene_count": typed_scene_count,
        "corkboard_scenes":  corkboard_scenes,
        "timeline_events":   timeline_events,
        "fragment_count":    fragment_count,
        "inventory_items":    inventory_items,
        "inventory_currency": inventory_currency,
        "inventory_relics":   inventory_relics,
        "time_system_used":  time_system_used,
        "grammar_enabled":   grammar_enabled,
        "pandoc_enabled":    pandoc_enabled,
        "export_count":      export_count,
        "stats_views":       stats_views,
        "project_info_set":  project_info_set,
        "project_info_full": project_info_full,
        "ai_disabled":       ai_disabled,
    }


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/achievements")
def get_achievements(db: Session = Depends(get_db)):
    metrics      = _compute_metrics(db)
    unlocks      = {u.key: u.unlocked_at for u in db.query(AchievementUnlock).all()}
    results      = []
    newly_earned = []
    now          = datetime.now(UTC).replace(tzinfo=None)

    ai_disabled = bool(metrics.get("ai_disabled", 0))

    for ach in ACHIEVEMENTS:
        # When AI is disabled, skip AI-specific achievements entirely
        if ai_disabled and ach["key"] in AI_ACHIEVEMENT_KEYS:
            continue

        val    = metrics.get(ach["metric"], 0)
        earned = val >= ach["threshold"]

        if earned and ach["key"] not in unlocks:
            newly_earned.append(AchievementUnlock(key=ach["key"], unlocked_at=now))
            unlocks[ach["key"]] = now

        ts = unlocks.get(ach["key"])
        results.append({
            "key":          ach["key"],
            "chain":        ach["chain"],
            "name":         ach["name"],
            "description":  ach["desc"],
            "category":     ach["cat"],
            "tier":         ach["tier"],
            "metric":       ach["metric"],
            "threshold":    ach["threshold"],
            "earned":       earned,
            "unlocked_at":  ts.isoformat() if ts and earned else None,
            "progress":     min(val, ach["threshold"]),
            "progress_max": ach["threshold"],
        })

    # ── Special: All Human ────────────────────────────────────────────────────
    # Earned when AI features are disabled AND no AI achievement has ever been unlocked.
    no_ai_unlocked   = not any(k in unlocks for k in AI_ACHIEVEMENT_KEYS)
    all_human_earned = ai_disabled and no_ai_unlocked

    if all_human_earned and "all_human" not in unlocks:
        newly_earned.append(AchievementUnlock(key="all_human", unlocked_at=now))
        unlocks["all_human"] = now

    all_human_ts = unlocks.get("all_human")
    results.append({
        "key":          "all_human",
        "chain":        "all_human",
        "name":         "The Pen & Nothing Else",
        "description":  "'The scariest moment is always just before you start.' — King. You started, and finished, without a single algorithmic word.",
        "category":     "words",
        "tier":         3,
        "metric":       "all_human",
        "threshold":    1,
        "earned":       all_human_earned,
        "unlocked_at":  all_human_ts.isoformat() if all_human_ts and all_human_earned else None,
        "progress":     1 if all_human_earned else 0,
        "progress_max": 1,
    })

    # ── Hidden: The Complete Works ────────────────────────────────────────────
    # Requires every regular achievement + either path:
    #   Human path: all non-AI achievements + all_human earned (AI was always off)
    #   AI path:    all achievements incl. AI (when defined) + all_human NOT earned
    # Together this simplifies to: all applicable achievements earned.
    all_regular_earned = all(r["earned"] for r in results if r["key"] != "all_human")
    all_human_path     = all_regular_earned and all_human_earned
    all_ai_path        = all_regular_earned and not all_human_earned
    complete_earned    = all_human_path or all_ai_path

    if complete_earned and "all_achievements" not in unlocks:
        newly_earned.append(AchievementUnlock(key="all_achievements", unlocked_at=now))
        unlocks["all_achievements"] = now

    complete_ts = unlocks.get("all_achievements")
    results.append({
        "key":          "all_achievements",
        "chain":        "all_achievements",
        "name":         "The Complete Works",
        "description":  "'A writer is someone for whom writing is more difficult than it is for other people.' — Thomas Mann. You made it look easy.",
        "category":     "story",
        "tier":         5,
        "metric":       "all_achievements",
        "threshold":    1,
        "earned":       complete_earned,
        "unlocked_at":  complete_ts.isoformat() if complete_ts and complete_earned else None,
        "progress":     1 if complete_earned else 0,
        "progress_max": 1,
    })

    if newly_earned:
        db.add_all(newly_earned)
        db.commit()

    return results
