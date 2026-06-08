"""
AI provider registry and unified streaming/completion utilities.

All providers that implement the OpenAI chat-completions API share a single
streaming + non-streaming helper.  Anthropic uses its own Messages API and
gets a dedicated adapter that normalises the response to OpenAI's shape so
callers don't need to special-case it.

Usage
-----
    from ai_providers import PROVIDER_MAP, stream_provider, post_provider, fetch_models

    pdef   = PROVIDER_MAP["openai"]
    async for chunk in stream_provider(pdef, base_url, api_key, model, messages):
        ...
    result = await post_provider(pdef, base_url, api_key, model, messages)
    text   = result["choices"][0]["message"]["content"]
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import AsyncIterator

import httpx


# ── Provider definitions ──────────────────────────────────────────────────────

@dataclass
class ProviderDef:
    id: str
    name: str
    api_type: str           # "openai_compat" | "anthropic"
    default_base_url: str
    requires_key: bool
    is_local: bool
    # Non-empty ⟹ provider has no /models endpoint; show these instead.
    static_models: list[str] = field(default_factory=list)


PROVIDERS: list[ProviderDef] = [
    # ── Online ────────────────────────────────────────────────────────────────
    ProviderDef(
        id="openrouter", name="OpenRouter",
        api_type="openai_compat",
        default_base_url="https://openrouter.ai/api/v1",
        requires_key=True, is_local=False,
    ),
    ProviderDef(
        id="openai", name="OpenAI",
        api_type="openai_compat",
        default_base_url="https://api.openai.com/v1",
        requires_key=True, is_local=False,
    ),
    ProviderDef(
        id="anthropic", name="Anthropic",
        api_type="anthropic",
        default_base_url="https://api.anthropic.com",
        requires_key=True, is_local=False,
        # Anthropic has no public /models endpoint — hardcode known models.
        static_models=[
            "claude-opus-4-5",
            "claude-sonnet-4-5",
            "claude-haiku-4-5",
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-opus-20240229",
            "claude-3-sonnet-20240229",
            "claude-3-haiku-20240307",
        ],
    ),
    ProviderDef(
        id="groq", name="Groq",
        api_type="openai_compat",
        default_base_url="https://api.groq.com/openai/v1",
        requires_key=True, is_local=False,
    ),
    ProviderDef(
        id="mistral", name="Mistral",
        api_type="openai_compat",
        default_base_url="https://api.mistral.ai/v1",
        requires_key=True, is_local=False,
    ),
    ProviderDef(
        id="gemini", name="Google Gemini",
        api_type="openai_compat",
        # Google exposes an OpenAI-compatible endpoint since late 2024.
        default_base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        requires_key=True, is_local=False,
    ),
    # ── Local ─────────────────────────────────────────────────────────────────
    ProviderDef(
        id="ollama", name="Ollama",
        api_type="openai_compat",
        default_base_url="http://localhost:11434/v1",
        requires_key=False, is_local=True,
    ),
]

PROVIDER_MAP: dict[str, ProviderDef] = {p.id: p for p in PROVIDERS}


# ── Internal helpers ──────────────────────────────────────────────────────────

def _openai_headers(api_key: str | None, extra: dict | None = None) -> dict[str, str]:
    h: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        h["Authorization"] = f"Bearer {api_key}"
    if extra:
        h.update(extra)
    return h


def _anthropic_headers(api_key: str) -> dict[str, str]:
    return {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }


def _extra_headers(pdef: ProviderDef) -> dict[str, str]:
    if pdef.id == "openrouter":
        return {"HTTP-Referer": "http://localhost:3000", "X-Title": "Foliantica"}
    return {}


def _anthropic_payload(model: str, messages: list[dict]) -> dict:
    system = ""
    chat: list[dict] = []
    for m in messages:
        if m["role"] == "system":
            system += m["content"]
        else:
            chat.append(m)
    payload: dict = {"model": model, "messages": chat, "max_tokens": 4096}
    if system:
        payload["system"] = system
    return payload


# ── Streaming ─────────────────────────────────────────────────────────────────

async def _stream_openai_compat(
    base_url: str,
    api_key: str | None,
    model: str,
    messages: list[dict],
    extra_headers: dict | None = None,
) -> AsyncIterator[str]:
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream(
            "POST",
            f"{base_url}/chat/completions",
            headers=_openai_headers(api_key, extra_headers),
            json={"model": model, "messages": messages, "stream": True},
        ) as response:
            if response.status_code != 200:
                body = await response.aread()
                yield f"data: {json.dumps({'error': body.decode()})}\n\n"
                return
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    yield f"{line}\n\n"


async def _stream_anthropic(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
) -> AsyncIterator[str]:
    """Stream Anthropic Messages API; re-emits as OpenAI SSE so callers are uniform."""
    payload = {**_anthropic_payload(model, messages), "stream": True}
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream(
            "POST",
            f"{base_url}/v1/messages",
            headers=_anthropic_headers(api_key),
            json=payload,
        ) as response:
            if response.status_code != 200:
                body = await response.aread()
                yield f"data: {json.dumps({'error': body.decode()})}\n\n"
                return
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw == "[DONE]":
                    yield "data: [DONE]\n\n"
                    return
                try:
                    evt = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                etype = evt.get("type", "")
                if etype == "content_block_delta":
                    text = evt.get("delta", {}).get("text", "")
                    if text:
                        chunk = {"choices": [{"delta": {"content": text}, "finish_reason": None}]}
                        yield f"data: {json.dumps(chunk)}\n\n"
                elif etype == "message_stop":
                    yield "data: [DONE]\n\n"
                    return


async def stream_provider(
    pdef: ProviderDef,
    base_url: str,
    api_key: str | None,
    model: str,
    messages: list[dict],
) -> AsyncIterator[str]:
    """Dispatch streaming to the correct adapter for the given provider."""
    if pdef.api_type == "anthropic":
        async for chunk in _stream_anthropic(base_url, api_key or "", model, messages):
            yield chunk
    else:
        async for chunk in _stream_openai_compat(
            base_url, api_key, model, messages, _extra_headers(pdef)
        ):
            yield chunk


# ── Non-streaming (translate / structure / synopsis) ─────────────────────────

async def _post_openai_compat(
    base_url: str,
    api_key: str | None,
    model: str,
    messages: list[dict],
    timeout: int,
    pdef: ProviderDef,
) -> dict:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers=_openai_headers(api_key, _extra_headers(pdef)),
            json={"model": model, "messages": messages, "stream": False},
        )
    resp.raise_for_status()
    return resp.json()


async def _post_anthropic(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    timeout: int,
) -> dict:
    """Call Anthropic and normalise response to OpenAI shape."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            f"{base_url}/v1/messages",
            headers=_anthropic_headers(api_key),
            json=_anthropic_payload(model, messages),
        )
    resp.raise_for_status()
    body = resp.json()
    # Normalise: Anthropic → OpenAI shape
    text = ""
    for block in body.get("content", []):
        if block.get("type") == "text":
            text += block.get("text", "")
    return {"choices": [{"message": {"role": "assistant", "content": text}}]}


async def post_provider(
    pdef: ProviderDef,
    base_url: str,
    api_key: str | None,
    model: str,
    messages: list[dict],
    timeout: int = 60,
) -> dict:
    """Non-streaming call; always returns OpenAI-shaped JSON."""
    if pdef.api_type == "anthropic":
        return await _post_anthropic(base_url, api_key or "", model, messages, timeout)
    return await _post_openai_compat(base_url, api_key, model, messages, timeout, pdef)


# ── Model listing ─────────────────────────────────────────────────────────────

async def fetch_models(
    pdef: ProviderDef,
    base_url: str,
    api_key: str | None,
) -> list[dict]:
    """Return [{id, name}] for the provider.  Uses static list for Anthropic."""
    if pdef.static_models:
        return [{"id": m, "name": m} for m in pdef.static_models]

    async with httpx.AsyncClient(timeout=10) as client:
        # Ollama: use native /api/tags — always lists all pulled models,
        # even ones not currently loaded into memory.
        if pdef.id == "ollama":
            root = base_url.rstrip("/")
            if root.endswith("/v1"):
                root = root[:-3]
            resp = await client.get(f"{root}/api/tags")
            if resp.status_code != 200:
                return []
            models = [
                {"id": m["name"], "name": m["name"]}
                for m in resp.json().get("models", [])
                if m.get("name")
            ]
            return sorted(models, key=lambda m: m["name"].lower())

        headers: dict[str, str] = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        resp = await client.get(f"{base_url}/models", headers=headers)

    if resp.status_code != 200:
        return []
    data = resp.json()
    raw = data.get("data", data) if isinstance(data, dict) else data
    models = [
        {"id": m["id"], "name": m.get("name") or m["id"]}
        for m in raw
        if isinstance(m, dict) and m.get("id")
    ]
    return sorted(models, key=lambda m: m["name"].lower())
