import json
import re

_ANCHORED_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)
_ANY_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def parse_json(text: str):
    """Parses a model's JSON response. Tries, in order: the whole response as
    JSON, the whole response as a ```json ... ``` fence, the last fenced block
    anywhere in the response (models sometimes reason out loud before the
    fence despite instructions not to), then the last {...} span in the text."""
    text = text.strip()

    match = _ANCHORED_FENCE_RE.match(text)
    if match:
        return json.loads(match.group(1))

    try:
        return json.loads(text)
    except ValueError:
        pass

    fence_matches = _ANY_FENCE_RE.findall(text)
    if fence_matches:
        return json.loads(fence_matches[-1])

    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return json.loads(text[start : end + 1])

    raise ValueError(f"No JSON object found in response: {text[:200]!r}")
