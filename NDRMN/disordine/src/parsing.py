import json
import re

_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)


def parse_json(text: str):
    """Parses a model's JSON response, tolerating a ```json ... ``` code fence
    even though the prompts ask models not to include one."""
    text = text.strip()
    match = _FENCE_RE.match(text)
    if match:
        text = match.group(1)
    return json.loads(text)
