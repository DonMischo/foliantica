"""Oracle tables — genuinely random creative constraints for the DM.

Draws are seeded by scene id, so a scene keeps the same oracle for its whole
lifetime without storing anything, and every new scene gets a fresh draw.
The randomness that fights LLM mode-collapse comes from here, not the model.
"""
import json
import random
from functools import lru_cache
from pathlib import Path

_ORACLES_PATH = Path(__file__).parent.parent / "data" / "oracles.json"


@lru_cache(maxsize=1)
def _load() -> dict:
    return json.loads(_ORACLES_PATH.read_text(encoding="utf-8"))


def ban_list() -> list[str]:
    return _load().get("ban_list", [])


def draw_for_scene(scene_id: int) -> dict[str, str]:
    """Deterministic oracle draw for a scene: one entry per table."""
    tables = _load()["tables"]
    rng = random.Random(scene_id * 7919 + 42)
    return {name: rng.choice(entries) for name, entries in tables.items()}
