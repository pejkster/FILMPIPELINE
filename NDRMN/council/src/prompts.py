from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"

_FILES = {
    "statement": "model_statement_prompt.md",
    "feedback": "feedback_prompt.md",
    "revision": "model_revision_prompt.md",
    "analysis": "analysis_prompt.md",
}

_MARKER = "## Prompt text"


def _extract(raw: str) -> str:
    """Pulls just the '## Prompt text' section out of a prompt markdown file,
    stopping before the next '---' divider (or end of file if there isn't one)."""
    start = raw.index(_MARKER) + len(_MARKER)
    rest = raw[start:]
    end = rest.find("\n---\n")
    if end != -1:
        rest = rest[:end]
    return rest.strip()


def load_template(name: str) -> str:
    path = PROMPTS_DIR / _FILES[name]
    return _extract(path.read_text())


def fill(template: str, **kwargs) -> str:
    text = template
    for key, value in kwargs.items():
        text = text.replace("{{" + key + "}}", str(value))
    return text
