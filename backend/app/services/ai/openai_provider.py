"""An adapter for any OpenAI-compatible ``/chat/completions`` endpoint.

Works unchanged against OpenAI, Azure OpenAI, OpenRouter, Groq, Together,
vLLM, Ollama and LM Studio, because they all speak the same JSON shape. Point
``AI_BASE_URL`` at the host and it works.

Security notes that are not optional:

* The API key goes in the ``Authorization`` header and **nowhere else**. It is
  never written to a log line, never put in an exception message, and never
  included in a response body.
* :func:`redact_secrets` is applied to every upstream error fragment before it
  can reach a log or a client, because some gateways echo request headers back
  inside their error payload.
* ``httpx`` clients are created per request rather than held open, so a stalled
  provider cannot exhaust the connection pool.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.services.ai.provider import (
    PROVIDER_OPENAI_COMPATIBLE,
    AIProviderError,
    AIRequest,
    AIResponse,
)

logger = logging.getLogger("data_analyzer.ai.openai")

#: Never log or return a response body larger than this. A gateway error page is
#: megabytes and tells the user nothing a short hint does not.
_MAX_ERROR_FRAGMENT = 400


def redact_secrets(text: str, *secrets: str | None) -> str:
    """Blank out any known secret that appears in ``text``.

    Applied to upstream error bodies because several providers echo the request
    — headers included — back inside their 4xx JSON.
    """
    result = text
    for secret in secrets:
        if secret and len(secret) >= 8:
            result = result.replace(secret, "[redacted]")
    return result


def _truncate(text: str) -> str:
    collapsed = " ".join(text.split())
    if len(collapsed) <= _MAX_ERROR_FRAGMENT:
        return collapsed
    return collapsed[:_MAX_ERROR_FRAGMENT] + "…"


def _endpoint(base_url: str) -> str:
    """Normalise ``AI_BASE_URL`` into a chat-completions endpoint."""
    trimmed = (base_url or "").strip().rstrip("/")
    if not trimmed:
        raise AIProviderError(
            "AI_BASE_URL is empty.",
            code="ai_not_configured",
            hint="Set AI_BASE_URL to your provider's API root, e.g. https://api.openai.com/v1",
        )
    if trimmed.endswith("/chat/completions"):
        return trimmed
    return f"{trimmed}/chat/completions"


class OpenAICompatibleProvider:
    """Calls a chat-completions endpoint and normalises the response."""

    name = PROVIDER_OPENAI_COMPATIBLE
    is_ai = True

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        timeout: float = 30.0,
        max_tokens: int = 1200,
        temperature: float = 0.2,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url
        self.model = model
        self._timeout = timeout
        self._max_tokens = max_tokens
        self._temperature = temperature

    def available(self) -> bool:
        return bool(self._api_key.strip() and self._base_url.strip() and self.model.strip())

    async def complete(self, request: AIRequest) -> AIResponse:
        """POST the conversation and return the first choice's text."""
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.prompt},
            ],
            "max_tokens": request.max_tokens or self._max_tokens,
            "temperature": (
                request.temperature if request.temperature is not None else self._temperature
            ),
            "stream": False,
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    _endpoint(self._base_url), json=payload, headers=headers
                )
        except httpx.TimeoutException as exc:
            raise AIProviderError(
                "The AI provider did not respond in time.",
                code="ai_timeout",
                hint=f"Increase AI_TIMEOUT_SECONDS above {self._timeout:g} or try again.",
            ) from exc
        except httpx.RequestError as exc:
            # httpx exception text can contain the URL; the URL can contain a
            # token if the operator put one in the path. Scrub regardless.
            detail = _truncate(redact_secrets(str(exc), self._api_key))
            logger.warning("AI provider unreachable: %s", detail)
            raise AIProviderError(
                "Could not reach the AI provider.",
                code="ai_unreachable",
                hint="Check AI_BASE_URL and that the host is reachable from this server.",
            ) from exc

        if response.status_code >= 400:
            raise self._error_for(response)

        try:
            body = response.json()
        except (json.JSONDecodeError, ValueError) as exc:
            raise AIProviderError(
                "The AI provider returned a response that was not valid JSON.",
                code="ai_bad_response",
                hint="Confirm AI_BASE_URL points at a chat-completions API, not a web page.",
            ) from exc

        return self._parse(body)

    def _error_for(self, response: httpx.Response) -> AIProviderError:
        """Turn an upstream error status into something a user can act on."""
        fragment = ""
        try:
            fragment = _truncate(redact_secrets(response.text, self._api_key))
        except (UnicodeDecodeError, ValueError):  # pragma: no cover - defensive
            fragment = ""

        status = response.status_code
        detail = f" (HTTP {status})"
        if fragment:
            detail = f"{detail} {fragment}"

        if status in (401, 403):
            logger.warning("AI provider rejected the key: HTTP %s", status)
            return AIProviderError(
                f"The AI provider rejected the API key{detail}.",
                code="ai_unauthorized",
                hint="Check AI_API_KEY and that it is valid for AI_MODEL.",
                status_code=502,
            )
        if status == 404:
            logger.warning("AI provider endpoint not found: %s", self._base_url)
            return AIProviderError(
                f"The AI provider has no chat-completions endpoint at AI_BASE_URL{detail}.",
                code="ai_endpoint_not_found",
                hint=(
                    "AI_BASE_URL should be the API root including any /v1 segment, "
                    "e.g. https://api.openai.com/v1"
                ),
                status_code=502,
            )
        if status == 429:
            return AIProviderError(
                f"The AI provider is rate limiting this key{detail}.",
                code="ai_rate_limited",
                hint="Wait a moment and retry, or lower AI_MAX_TOKENS.",
                status_code=429,
            )
        if 500 <= status < 600:
            logger.warning("AI provider server error: HTTP %s", status)
            return AIProviderError(
                f"The AI provider returned a server error{detail}.",
                code="ai_upstream_error",
                hint="This is a fault at the provider. Try again shortly.",
                status_code=502,
            )

        logger.warning("AI provider rejected the request: HTTP %s", status)
        return AIProviderError(
            f"The AI provider rejected the request{detail}.",
            code="ai_bad_request",
            hint=(
                "Common causes: the model name in AI_MODEL does not exist, or the provider does "
                "not support the parameters being sent."
            ),
            status_code=502,
        )

    def _parse(self, body: dict[str, Any]) -> AIResponse:
        """Pull the text out of a chat-completions body."""
        if not isinstance(body, dict):
            raise AIProviderError(
                "The AI provider returned an unexpected response shape.",
                code="ai_bad_response",
                hint="Confirm AI_BASE_URL points at a chat-completions API.",
            )

        choices = body.get("choices")
        if not isinstance(choices, list) or not choices:
            # Some gateways report refusal or content filtering by returning an
            # empty choices array. Say so rather than showing an empty bubble.
            raise AIProviderError(
                "The AI provider returned no answer for this request.",
                code="ai_empty_response",
                hint=(
                    "The request may have been filtered, or the model returned nothing usable. "
                    "Try rephrasing the question."
                ),
            )

        first = choices[0] if isinstance(choices[0], dict) else {}
        message = first.get("message") if isinstance(first.get("message"), dict) else {}
        text = message.get("content")

        # Some gateways return the answer as a list of content blocks.
        if text is None and isinstance(message.get("content"), list):
            text = "".join(
                block.get("text", "")
                for block in message["content"]
                if isinstance(block, dict)
            )
        if isinstance(text, list):  # pragma: no cover - very unusual
            text = "".join(str(part) for part in text)

        if not isinstance(text, str) or not text.strip():
            raise AIProviderError(
                "The AI provider returned an empty answer.",
                code="ai_empty_response",
                hint="Try rephrasing the question, or check AI_MODEL is a chat model.",
            )

        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        return AIResponse(
            text=text.strip(),
            provider=self.name,
            model=str(body.get("model") or self.model),
            is_ai=True,
            finish_reason=first.get("finish_reason") if isinstance(first, dict) else None,
            prompt_tokens=usage.get("prompt_tokens") if isinstance(usage, dict) else None,
            completion_tokens=usage.get("completion_tokens") if isinstance(usage, dict) else None,
        )
