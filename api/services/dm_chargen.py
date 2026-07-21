"""Character generation for the simple RPG ruleset.

All randomness happens here in code — never in the model. The same service
backs the player-facing wizard and DM-side NPC stat blocks, so names and
sheets stay consistent and out of the LLM's hands.
"""
import json
import random
from functools import lru_cache
from pathlib import Path

_RULESET_PATH = Path(__file__).parent.parent / "data" / "ruleset_simple.json"


@lru_cache(maxsize=1)
def load_ruleset() -> dict:
    return json.loads(_RULESET_PATH.read_text(encoding="utf-8"))


def stat_mod(score: int) -> int:
    return (score - 10) // 2


def roll_stat_pool(rng: random.Random | None = None) -> list[dict]:
    """Roll 4d6-drop-lowest six times. Returns [{'dice': [..4 dice..], 'total': int}, ...]."""
    rng = rng or random
    pool = []
    for _ in range(6):
        dice = sorted((rng.randint(1, 6) for _ in range(4)), reverse=True)
        pool.append({"dice": dice, "total": sum(dice[:3])})
    return pool


def generate_name(name_style: str, rng: random.Random | None = None, gender: str | None = None) -> str:
    rng = rng or random
    styles = load_ruleset()["name_styles"]
    style = styles.get(name_style) or styles["human"]
    table = gender if gender in ("male", "female") else rng.choice(["male", "female"])
    first = rng.choice(style[f"{table}_start"]) + rng.choice(style[f"{table}_end"])
    last = rng.choice(style["last_start"]) + rng.choice(style["last_end"])
    return f"{first} {last}"


def _primary_bonus_stat(species_def: dict, class_def: dict) -> str:
    """The species' main bonus stat; 'any' resolves to the class's top priority."""
    stat = next(iter(species_def["bonus"]))
    return class_def["priorities"][0] if stat == "any" else stat


def generate_appearance(rng: random.Random | None = None) -> tuple[dict, list[str]]:
    """Draw looks from the appearance tables. Returns (appearance, perk_abilities) —
    some scars and tattoos carry small story-level perks."""
    rng = rng or random
    tables = load_ruleset()["appearance"]

    def draw_marked(table_name: str) -> list[dict]:
        count = rng.choices([0, 1, 2], weights=[4, 4, 2])[0]
        return rng.sample(tables[table_name], count) if count else []

    scars = draw_marked("scars")
    tattoos = draw_marked("tattoos")
    appearance = {
        "size": rng.choice(tables["body_size"]),
        "build": rng.choice(tables["build"]),
        "hair_color": rng.choice(tables["hair_color"]),
        "hair_style": rng.choice(tables["hair_style"]),
        "eye_color": rng.choice(tables["eye_color"]),
        "features": [f for f in rng.sample(tables["features"], 2)],
        "scars": [s["text"] for s in scars],
        "tattoos": [t["text"] for t in tattoos],
    }
    perks = [m["perk"] for m in (*scars, *tattoos) if m.get("perk")]
    return appearance, perks


def build_character(
    species: str,
    klass: str,
    stat_totals: list[int],
    name: str | None = None,
    is_pc: bool = True,
    rng: random.Random | None = None,
    species2: str | None = None,
    gender: str | None = None,
) -> dict:
    """Assemble a character dict from six stat totals (highest→lowest by class
    priority). With *species2* set, the character is a halfblood: +1 to each
    parent species' primary bonus stat (instead of a full bonus), both traits.

    Returns {name, species, class_label, appearance, rpg_sheet} ready to store
    on a codex entry.
    """
    rng = rng or random
    rules = load_ruleset()
    sp = rules["species"].get(species)
    cl = rules["classes"].get(klass)
    if not sp:
        raise ValueError(f"Unknown species: {species}")
    if not cl:
        raise ValueError(f"Unknown class: {klass}")
    sp2 = None
    if species2:
        if species2 == species:
            raise ValueError("A halfblood needs two different species")
        sp2 = rules["species"].get(species2)
        if not sp2:
            raise ValueError(f"Unknown species: {species2}")
    if len(stat_totals) != 6:
        raise ValueError("Exactly six stat values required")

    ordered = sorted(stat_totals, reverse=True)
    stats = {stat: ordered[i] for i, stat in enumerate(cl["priorities"])}

    if sp2:
        # Halfblood: +1 from each parent's primary stat, both traits
        for parent in (sp, sp2):
            stats[_primary_bonus_stat(parent, cl)] += 1
        traits = [sp["trait"], sp2["trait"]]
        species_label = f"{sp['label']}–{sp2['label']} halfblood"
        name_style = rng.choice([sp["name_style"], sp2["name_style"]])
    else:
        for stat, bonus in sp["bonus"].items():
            target = cl["priorities"][0] if stat == "any" else stat
            stats[target] = stats[target] + bonus
        traits = [sp["trait"]]
        species_label = sp["label"]
        name_style = sp["name_style"]

    hp_max = cl["hit_die"] + stat_mod(stats["con"])
    ac = cl["ac_base"] + max(0, min(stat_mod(stats["dex"]), 2))

    if gender not in ("male", "female", "div"):
        gender = rng.choices(["male", "female", "div"], weights=[12, 12, 1])[0]

    appearance, perks = generate_appearance(rng)

    sheet = {
        "species": species,
        "species2": species2,
        "gender": gender,
        "class": klass,
        "level": 1,
        "stats": {s: stats[s] for s in rules["stats"]},
        "hp": {"current": hp_max, "max": hp_max},
        "ac": ac,
        "abilities": [*traits, *cl["abilities"], *perks],
        "conditions": [],
        "gear": [{"name": item, "qty": 1} for item in cl["kit"]],
        "appearance": appearance,
        "is_pc": is_pc,
    }

    return {
        "name": name or generate_name(name_style, rng, gender),
        "species": species_label,
        "class_label": cl["label"],
        "gender": gender,
        "appearance": appearance,
        "starting_currency": cl.get("starting_currency"),
        "rpg_sheet": sheet,
    }


def generate_npc(
    species: str | None,
    klass: str | None,
    rng: random.Random | None = None,
    gender: str | None = None,
) -> dict:
    """Random-fill any missing choice and build an NPC stat block (code-named,
    code-rolled). Roughly one in eight NPCs turns out to be a halfblood."""
    rng = rng or random
    rules = load_ruleset()
    species = species if species in rules["species"] else rng.choice(list(rules["species"]))
    klass = klass if klass in rules["classes"] else rng.choice(list(rules["classes"]))
    species2 = None
    if rng.random() < 0.125:
        others = [s for s in rules["species"] if s != species]
        species2 = rng.choice(others)
    totals = [p["total"] for p in roll_stat_pool(rng)]
    return build_character(species, klass, totals, is_pc=False, rng=rng, species2=species2, gender=gender)
