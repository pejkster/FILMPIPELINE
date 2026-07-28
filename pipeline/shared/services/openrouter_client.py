"""Async OpenRouter client for multi-model LLM calls."""

import asyncio
import json
import os
import re
import time

import httpx
from dotenv import load_dotenv

load_dotenv()

API_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_RETRIES = 5
RETRY_BACKOFF = 5
MIN_INTERVAL = 1.0

FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)

COUNCIL_MODELS = [
    {"id": "anthropic/claude-opus-4-8", "name": "Claude Opus 4.8", "lab": "Anthropic"},
    {"id": "openai/gpt-4.1", "name": "GPT-4.1", "lab": "OpenAI"},
    {"id": "google/gemini-2.5-pro", "name": "Gemini 2.5 Pro", "lab": "Google"},
    {"id": "x-ai/grok-3", "name": "Grok 3", "lab": "xAI"},
    {"id": "qwen/qwen3-235b-a22b", "name": "Qwen 3 235B", "lab": "Alibaba"},
    {"id": "deepseek/deepseek-r1", "name": "DeepSeek R1", "lab": "DeepSeek"},
]

_last_call = 0.0


def parse_json_response(text: str):
    text = text.strip()
    match = FENCE_RE.match(text)
    if match:
        text = match.group(1)
    return json.loads(text)


async def call_openrouter(model_id: str, prompt: str, system_prompt: str = "", timeout: int = 180) -> str:
    global _last_call
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY not set")

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    for attempt in range(1, MAX_RETRIES + 1):
        now = asyncio.get_event_loop().time()
        wait = _last_call + MIN_INTERVAL - now
        if wait > 0:
            await asyncio.sleep(wait)
        _last_call = asyncio.get_event_loop().time()

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    API_URL,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={"model": model_id, "messages": messages},
                )

            try:
                data = response.json()
            except (json.JSONDecodeError, ValueError):
                data = None

            error_payload = data.get("error") if isinstance(data, dict) else None
            effective_code = response.status_code
            if error_payload and isinstance(error_payload.get("code"), int):
                effective_code = error_payload["code"]

            if effective_code in {429, 500, 502, 503, 504} and attempt < MAX_RETRIES:
                retry_after = response.headers.get("Retry-After")
                w = float(retry_after) if retry_after else RETRY_BACKOFF * attempt
                await asyncio.sleep(max(1.0, w))
                continue

            response.raise_for_status()
            if error_payload:
                raise RuntimeError(f"OpenRouter error for {model_id}: {error_payload}")
            if not data or "choices" not in data or not data["choices"]:
                raise RuntimeError(f"Unexpected response from {model_id}: {data}")

            return data["choices"][0]["message"]["content"]

        except (httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError):
            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_BACKOFF * attempt)
            else:
                raise RuntimeError(f"OpenRouter call to {model_id} failed after {MAX_RETRIES} attempts")

    raise RuntimeError(f"OpenRouter call to {model_id} failed after {MAX_RETRIES} attempts")
