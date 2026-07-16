from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
_MARKER = "## Prompt text"


def load_template(filename: str) -> str:
    raw = (PROMPTS_DIR / filename).read_text()
    start = raw.index(_MARKER) + len(_MARKER)
    rest = raw[start:]
    end = rest.find("\n---\n")
    if end != -1:
        rest = rest[:end]
    return rest.strip()
