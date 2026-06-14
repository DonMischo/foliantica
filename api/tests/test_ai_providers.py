"""
Unit tests for api/ai_providers.py.

All HTTP calls are mocked with unittest.mock — no live network required.
Async functions are exercised via asyncio.run().
"""
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ── Provider registry ─────────────────────────────────────────────────────────

class TestProviderRegistry:
    def test_provider_map_contains_expected_ids(self):
        from ai_providers import PROVIDER_MAP
        for pid in ("openrouter", "openai", "anthropic", "groq", "mistral", "gemini", "ollama"):
            assert pid in PROVIDER_MAP, f"Missing provider: {pid}"

    def test_all_providers_have_required_fields(self):
        from ai_providers import PROVIDERS
        for p in PROVIDERS:
            assert p.id
            assert p.name
            assert p.api_type in ("openai_compat", "anthropic")
            assert p.default_base_url.startswith("http")

    def test_anthropic_has_static_models(self):
        from ai_providers import PROVIDER_MAP
        p = PROVIDER_MAP["anthropic"]
        assert len(p.static_models) > 0

    def test_ollama_is_local_no_key(self):
        from ai_providers import PROVIDER_MAP
        p = PROVIDER_MAP["ollama"]
        assert p.is_local is True
        assert p.requires_key is False

    def test_openrouter_requires_key(self):
        from ai_providers import PROVIDER_MAP
        p = PROVIDER_MAP["openrouter"]
        assert p.requires_key is True
        assert p.is_local is False


# ── Header helpers ────────────────────────────────────────────────────────────

class TestOpenAIHeaders:
    def setup_method(self):
        from ai_providers import _openai_headers
        self.h = _openai_headers

    def test_always_includes_content_type(self):
        headers = self.h(None)
        assert headers["Content-Type"] == "application/json"

    def test_includes_bearer_when_key_provided(self):
        headers = self.h("sk-test")
        assert headers["Authorization"] == "Bearer sk-test"

    def test_no_auth_header_when_key_is_none(self):
        headers = self.h(None)
        assert "Authorization" not in headers

    def test_merges_extra_headers(self):
        headers = self.h("key", extra={"X-Custom": "value"})
        assert headers["X-Custom"] == "value"
        assert headers["Content-Type"] == "application/json"


class TestAnthropicHeaders:
    def setup_method(self):
        from ai_providers import _anthropic_headers
        self.h = _anthropic_headers

    def test_includes_api_key(self):
        headers = self.h("ant-key")
        assert headers["x-api-key"] == "ant-key"

    def test_includes_version(self):
        headers = self.h("key")
        assert "anthropic-version" in headers

    def test_includes_content_type(self):
        headers = self.h("key")
        assert headers["Content-Type"] == "application/json"


class TestExtraHeaders:
    def setup_method(self):
        from ai_providers import _extra_headers, PROVIDER_MAP
        self.extra = _extra_headers
        self.pmap  = PROVIDER_MAP

    def test_openrouter_includes_referer(self):
        headers = self.extra(self.pmap["openrouter"])
        assert "HTTP-Referer" in headers

    def test_other_providers_return_empty(self):
        for pid in ("openai", "anthropic", "ollama", "groq"):
            assert self.extra(self.pmap[pid]) == {}


# ── Anthropic payload builder ─────────────────────────────────────────────────

class TestAnthropicPayload:
    def setup_method(self):
        from ai_providers import _anthropic_payload
        self.build = _anthropic_payload

    def test_system_message_extracted(self):
        msgs = [{"role": "system", "content": "You are helpful."},
                {"role": "user", "content": "Hello"}]
        payload = self.build("claude-3", msgs)
        assert payload["system"] == "You are helpful."
        assert all(m["role"] != "system" for m in payload["messages"])

    def test_chat_messages_preserved(self):
        msgs = [{"role": "user", "content": "Hi"},
                {"role": "assistant", "content": "Hello!"}]
        payload = self.build("claude-3", msgs)
        assert len(payload["messages"]) == 2

    def test_no_system_key_when_no_system_message(self):
        msgs = [{"role": "user", "content": "Hi"}]
        payload = self.build("claude-3", msgs)
        assert "system" not in payload or payload.get("system") == ""

    def test_multiple_system_messages_concatenated(self):
        msgs = [{"role": "system", "content": "A"},
                {"role": "system", "content": "B"},
                {"role": "user", "content": "Q"}]
        payload = self.build("claude-3", msgs)
        assert "A" in payload["system"] and "B" in payload["system"]

    def test_max_tokens_set(self):
        payload = self.build("claude-3", [{"role": "user", "content": "x"}])
        assert payload["max_tokens"] > 0


# ── fetch_models — static list (Anthropic) ────────────────────────────────────

class TestFetchModelsStatic:
    def test_anthropic_returns_static_list_without_http(self):
        from ai_providers import PROVIDER_MAP, fetch_models
        pdef = PROVIDER_MAP["anthropic"]

        models = asyncio.run(fetch_models(pdef, pdef.default_base_url, "any-key"))
        assert len(models) > 0
        for m in models:
            assert "id" in m
            assert "name" in m

    def test_static_models_contain_known_claude(self):
        from ai_providers import PROVIDER_MAP, fetch_models
        pdef = PROVIDER_MAP["anthropic"]
        models = asyncio.run(fetch_models(pdef, pdef.default_base_url, None))
        ids = [m["id"] for m in models]
        assert any("claude" in mid for mid in ids)


# ── fetch_models — HTTP path (mocked) ────────────────────────────────────────

class TestFetchModelsHttp:
    def _mock_response(self, status: int, body: dict | list):
        resp = MagicMock()
        resp.status_code = status
        resp.json.return_value = body
        return resp

    def test_openai_compat_returns_sorted_models(self):
        from ai_providers import PROVIDER_MAP, fetch_models

        pdef = PROVIDER_MAP["openai"]
        fake_body = {"data": [
            {"id": "gpt-4", "name": "GPT-4"},
            {"id": "gpt-3.5-turbo", "name": None},
        ]}
        mock_resp = self._mock_response(200, fake_body)

        async def _run():
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_resp)
            with patch("httpx.AsyncClient", return_value=mock_client):
                return await fetch_models(pdef, "http://localhost", "key")

        models = asyncio.run(_run())
        assert len(models) == 2
        ids = [m["id"] for m in models]
        assert "gpt-4" in ids

    def test_returns_empty_list_on_http_error(self):
        from ai_providers import PROVIDER_MAP, fetch_models

        pdef = PROVIDER_MAP["openai"]
        mock_resp = self._mock_response(401, {"error": "Unauthorized"})

        async def _run():
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_resp)
            with patch("httpx.AsyncClient", return_value=mock_client):
                return await fetch_models(pdef, "http://localhost", "key")

        models = asyncio.run(_run())
        assert models == []

    def test_ollama_uses_api_tags_endpoint(self):
        from ai_providers import PROVIDER_MAP, fetch_models

        pdef = PROVIDER_MAP["ollama"]
        fake_body = {"models": [{"name": "llama3"}, {"name": "mistral"}]}
        mock_resp = self._mock_response(200, fake_body)
        captured: dict = {}

        async def _run():
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_resp)
            captured["client"] = mock_client
            with patch("httpx.AsyncClient", return_value=mock_client):
                return await fetch_models(pdef, "http://localhost:11434/v1", None)

        models = asyncio.run(_run())
        ids = [m["id"] for m in models]
        assert "llama3" in ids
        assert "mistral" in ids
        # Verify it called /api/tags (not /models)
        call_url = captured["client"].get.call_args[0][0]
        assert "api/tags" in call_url


# ── post_provider — response normalisation ────────────────────────────────────

class TestPostProvider:
    def test_anthropic_response_normalised_to_openai_shape(self):
        from ai_providers import PROVIDER_MAP, post_provider

        pdef = PROVIDER_MAP["anthropic"]
        anthropic_body = {
            "content": [{"type": "text", "text": "Hello!"}],
            "role": "assistant",
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = anthropic_body
        mock_resp.raise_for_status = MagicMock()

        async def _run():
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_resp)
            with patch("httpx.AsyncClient", return_value=mock_client):
                return await post_provider(pdef, "http://localhost", "key", "claude-3",
                                           [{"role": "user", "content": "Hi"}])

        result = asyncio.run(_run())
        assert "choices" in result
        assert result["choices"][0]["message"]["content"] == "Hello!"

    def test_openai_compat_returns_raw_response(self):
        from ai_providers import PROVIDER_MAP, post_provider

        pdef = PROVIDER_MAP["openai"]
        openai_body = {
            "choices": [{"message": {"role": "assistant", "content": "Hi!"}}]
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = openai_body
        mock_resp.raise_for_status = MagicMock()

        async def _run():
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_resp)
            with patch("httpx.AsyncClient", return_value=mock_client):
                return await post_provider(pdef, "http://localhost", "key", "gpt-4",
                                           [{"role": "user", "content": "Hello"}])

        result = asyncio.run(_run())
        assert result["choices"][0]["message"]["content"] == "Hi!"
