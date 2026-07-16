import base64
import mimetypes
import os
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

API_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_RETRIES = 5
RETRY_BACKOFF_SECONDS = 5
MIN_INTERVAL_SECONDS = 1.0  # simple pacing to avoid tripping rate limits in the first place

_RETRYABLE_CONNECTION_ERRORS = (
    requests.exceptions.ConnectionError,
    requests.exceptions.ChunkedEncodingError,
    requests.exceptions.Timeout,
)
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}

_last_call_time = 0.0


def _throttle():
    global _last_call_time
    now = time.monotonic()
    wait = _last_call_time + MIN_INTERVAL_SECONDS - now
    if wait > 0:
        time.sleep(wait)
    _last_call_time = time.monotonic()


def _retry_wait_seconds(response, attempt: int) -> float:
    retry_after = response.headers.get("Retry-After")
    if retry_after is not None:
        try:
            return max(1.0, float(retry_after))
        except ValueError:
            pass
    return RETRY_BACKOFF_SECONDS * attempt


def _post_with_retries(openrouter_id: str, messages: list, timeout: int) -> str:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is not set — add it to disordine/.env")

    for attempt in range(1, MAX_RETRIES + 1):
        _throttle()
        try:
            response = requests.post(
                API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"model": openrouter_id, "messages": messages},
                timeout=timeout,
            )

            try:
                data = response.json()
            except ValueError:
                data = None

            # OpenRouter sometimes proxies an upstream provider failure back as
            # HTTP 200 with the real error embedded in the JSON body instead of
            # in the status code — check both.
            error_payload = data.get("error") if isinstance(data, dict) else None
            effective_code = response.status_code
            if error_payload and isinstance(error_payload.get("code"), int):
                effective_code = error_payload["code"]

            if effective_code in _RETRYABLE_STATUS_CODES and attempt < MAX_RETRIES:
                wait = _retry_wait_seconds(response, attempt)
                detail = error_payload.get("message") if error_payload else response.reason
                print(
                    f"  [retry] {openrouter_id} got {effective_code} ({detail}), "
                    f"retrying in {wait:.0f}s (attempt {attempt}/{MAX_RETRIES})"
                )
                time.sleep(wait)
                continue

            response.raise_for_status()

            if error_payload:
                raise RuntimeError(f"OpenRouter error for {openrouter_id}: {error_payload}")

            if not data or "choices" not in data or not data["choices"]:
                raise RuntimeError(f"Unexpected OpenRouter response for {openrouter_id}: {data}")

            return data["choices"][0]["message"]["content"]

        except _RETRYABLE_CONNECTION_ERRORS as exc:
            if attempt < MAX_RETRIES:
                wait = RETRY_BACKOFF_SECONDS * attempt
                print(
                    f"  [retry] {openrouter_id} call failed ({exc.__class__.__name__}), "
                    f"retrying in {wait}s (attempt {attempt}/{MAX_RETRIES})"
                )
                time.sleep(wait)
            else:
                raise RuntimeError(
                    f"OpenRouter call to {openrouter_id} failed after {MAX_RETRIES} attempts"
                ) from exc

    raise RuntimeError(
        f"OpenRouter call to {openrouter_id} failed after {MAX_RETRIES} attempts (transient upstream errors)"
    )


def call_model(openrouter_id: str, prompt: str, timeout: int = 120) -> str:
    messages = [{"role": "user", "content": prompt}]
    return _post_with_retries(openrouter_id, messages, timeout)


def call_model_with_image(openrouter_id: str, prompt: str, image_path: Path, timeout: int = 120) -> str:
    mime_type = mimetypes.guess_type(str(image_path))[0] or "image/jpeg"
    image_b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{image_b64}"}},
            ],
        }
    ]
    return _post_with_retries(openrouter_id, messages, timeout)
