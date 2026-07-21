"""Wildcard resolver for the "Billions of Wildcards" dynamic-prompts syntax.

Adapted from the user's own engine.py (Billions-of-Wildcards-for-Stable-Diffusion).
Supports:
  __path/to/wildcard__   nested-key lookup ("/"-separated; "*" globs pool siblings)
  {a|b|c}                pick 1; {2$$a|b|c} pick 2; {1-3$$...} pick range;
  {2$$ and $$a|b|c}      custom separator; {0.25::a|b} weighted option
Nested syntax resolves recursively. Missing wildcards are dropped.

The tree is loaded from the file/folder configured in Settings
(user_settings.wildcards_path — a YAML file or a folder of YAML/.txt wildcards)
and cached until the source's mtime changes.
"""
import fnmatch
import random
import re
import threading
from pathlib import Path

import yaml

MAX_RESOLVE_ITERATIONS = 200

_lock = threading.Lock()
_cache: dict = {"path": None, "mtime": None, "tree": None, "error": None}


# ── Loading / caching ─────────────────────────────────────────────────────────

def _source_mtime(path: Path) -> float:
    if path.is_dir():
        times = [p.stat().st_mtime for p in path.rglob("*") if p.is_file()]
        return max(times) if times else 0.0
    return path.stat().st_mtime


def _load_tree(path: Path) -> dict:
    tree: dict = {}
    files: list[Path]
    if path.is_dir():
        files = sorted([*path.rglob("*.yaml"), *path.rglob("*.yml")])
        for txt_path in sorted(path.rglob("*.txt")):
            rel = txt_path.relative_to(path)
            parts = list(rel.parts[:-1]) + [rel.stem]
            lines = [
                ln.strip() for ln in txt_path.read_text(encoding="utf-8").splitlines()
                if ln.strip() and not ln.strip().startswith("#")
            ]
            node = tree
            for part in parts[:-1]:
                node = node.setdefault(part, {})
            node[parts[-1]] = lines
    else:
        files = [path]
    for f in files:
        data = yaml.safe_load(f.read_text(encoding="utf-8"))
        if data:
            _deep_merge(tree, data)
    return tree


def get_tree(path_str: str | None) -> tuple[dict | None, str | None]:
    """Cached wildcard tree for the configured source. Returns (tree, error)."""
    if not path_str:
        return None, None
    path = Path(path_str)
    with _lock:
        if not path.exists():
            _cache.update(path=path_str, mtime=None, tree=None, error="Path not found")
            return None, "Path not found"
        try:
            mtime = _source_mtime(path)
            if _cache["path"] == path_str and _cache["mtime"] == mtime and _cache["tree"] is not None:
                return _cache["tree"], None
            tree = _load_tree(path)
            _cache.update(path=path_str, mtime=mtime, tree=tree, error=None)
            return tree, None
        except Exception as exc:  # noqa: BLE001 — surface load errors to the UI
            _cache.update(path=path_str, mtime=None, tree=None, error=str(exc))
            return None, str(exc)


def tree_overview(tree: dict, max_depth: int = 2) -> list[dict]:
    """Browsable category listing for the picker UI: path + entry count."""
    out: list[dict] = []

    def count(node) -> int:
        if isinstance(node, list):
            return len(node)
        if isinstance(node, dict):
            return sum(count(v) for v in node.values())
        return 1

    def walk(node: dict, prefix: str, depth: int):
        for key in sorted(node, key=str.lower):
            child = node[key]
            path = f"{prefix}/{key}" if prefix else key
            n = count(child)
            has_children = isinstance(child, dict) and depth < max_depth and any(
                isinstance(v, (dict, list)) for v in child.values()
            )
            out.append({"path": path, "count": n, "depth": depth})
            if isinstance(child, dict) and depth < max_depth:
                walk(child, path, depth + 1)

    walk(tree, "", 0)
    return out


def draw(tree: dict, category: str, rng: random.Random | None = None) -> str:
    """One resolved draw from a category path (whole subtree pooled)."""
    rng = rng or random.Random()
    return _resolve(f"__{category}__", tree, rng)


# ── Resolution (ported from engine.py) ────────────────────────────────────────

def _resolve(text: str, tree: dict, rng: random.Random) -> str:
    for _ in range(MAX_RESOLVE_ITERATIONS):
        text, changed = _resolve_once(text, tree, rng)
        if not changed:
            return text
    return text  # bail out on runaway/self-referential templates


def _resolve_once(text, tree, rng):
    wc_idx = _find_wildcard(text)
    brace_idx = _find_top_level_brace(text)
    if wc_idx is None and brace_idx is None:
        return text, False
    if wc_idx is not None and (brace_idx is None or wc_idx[0] < brace_idx[0]):
        start, end, name = wc_idx
        segments = [s for s in name.split("/") if s]
        pool = _gather(tree, segments)
        replacement = str(rng.choice(pool)) if pool else ""
    else:
        start, end, inner = brace_idx
        replacement = _resolve_braces(inner, tree, rng)
    return text[:start] + replacement + text[end:], True


def _resolve_braces(inner, tree, rng):
    count_min, count_max, sep, options_str = _parse_quantifier(inner)
    options = _split_top_level(options_str, "|")
    weighted = [_parse_weight(o) for o in options]
    k = rng.randint(count_min, count_max)
    k = max(0, min(k, len(weighted)))
    return sep.join(_weighted_sample(weighted, k, rng))


def _deep_merge(dst, src):
    for key, value in src.items():
        if key in dst and isinstance(dst[key], dict) and isinstance(value, dict):
            _deep_merge(dst[key], value)
        elif key in dst and isinstance(dst[key], list) and isinstance(value, list):
            dst[key] = dst[key] + value
        else:
            dst[key] = value


def _gather(node, segments):
    if not segments:
        if isinstance(node, list):
            return list(node)
        if isinstance(node, dict):
            flat = []
            for v in node.values():
                flat.extend(_gather(v, []))
            return flat
        return [str(node)]
    if not isinstance(node, dict):
        return []
    seg, rest = segments[0], segments[1:]
    results = []
    if any(ch in seg for ch in "*?[]"):
        for key, child in node.items():
            if fnmatch.fnmatchcase(key, seg):
                results.extend(_gather(child, rest))
    elif seg in node:
        results.extend(_gather(node[seg], rest))
    return results


_WILDCARD_RE = re.compile(r"__([^_].*?)__")


def _find_wildcard(text):
    m = _WILDCARD_RE.search(text)
    if not m:
        return None
    return m.start(), m.end(), m.group(1)


def _find_top_level_brace(text):
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return start, i + 1, text[start + 1 : i]
    return None


_QUANTIFIER_RE = re.compile(r"^(\d+)(?:-(\d+))?\$\$(?:(.*?)\$\$)?(.*)$", re.DOTALL)


def _parse_quantifier(inner):
    m = _QUANTIFIER_RE.match(inner)
    if not m:
        return 1, 1, ", ", inner
    lo = int(m.group(1))
    hi = int(m.group(2)) if m.group(2) else lo
    sep = m.group(3) if m.group(3) is not None else ", "
    return lo, hi, sep, m.group(4)


_WEIGHT_RE = re.compile(r"^\s*([\d.]+)::(.*)$", re.DOTALL)


def _parse_weight(option):
    m = _WEIGHT_RE.match(option)
    if m:
        return float(m.group(1)), m.group(2)
    return 1.0, option


def _split_top_level(text, sep_char):
    parts = []
    depth = 0
    current = []
    for ch in text:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        if ch == sep_char and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)
    parts.append("".join(current))
    return parts


def _weighted_sample(weighted_options, k, rng):
    pool = list(weighted_options)
    chosen = []
    for _ in range(k):
        if not pool:
            break
        weights = [w for w, _ in pool]
        pick = rng.choices(range(len(pool)), weights=weights, k=1)[0]
        _, text = pool.pop(pick)
        chosen.append(text)
    return chosen
