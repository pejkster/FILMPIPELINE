"""Multi-model feedback loop — iterative convergence via blind peer review using Runware."""

import asyncio
import json
import os
import random
import re
from datetime import datetime

from dotenv import load_dotenv
from runware import Runware, ITextInference, ITextInferenceMessage

load_dotenv()

FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)

COUNCIL_MODELS = [
    {"id": "anthropic-claude-opus-4-8", "name": "Claude Opus 4.8", "lab": "Anthropic", "thinking": "off"},
    {"id": "openai-gpt-5-5", "name": "GPT-5.5", "lab": "OpenAI", "thinking": "off"},
    {"id": "google-gemini-3-1-pro", "name": "Gemini 3.1 Pro", "lab": "Google", "thinking": "low"},
    {"id": "xai-grok-4-3", "name": "Grok 4.3", "lab": "xAI", "thinking": "off"},
    {"id": "alibaba-qwen3-coder-plus", "name": "Qwen 3 Coder Plus", "lab": "Alibaba", "thinking": "off"},
    {"id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro", "lab": "DeepSeek", "thinking": "off"},
]

LABELS = ["A", "B", "C", "D", "E"]

FEEDBACK_PROMPT = """You were previously asked to give your perspective on a specific topic, and you answered it yourself.

**The topic:** {topic}

Below are {count} independent statements on this same topic, from other perspectives. For each one, rate how strongly you agree with it and briefly explain why.

**Scale:**
- **1 — Strongly disagree.** This doesn't ring true.
- **2 — Disagree.**
- **3 — Neutral.**
- **4 — Agree.**
- **5 — Strongly agree.** This is essentially how you would describe it too.

For each statement, give a score (1–5) and a short explanation (2–4 sentences) — be specific about what you agree or disagree with.

**Statements:**

{statements_block}

**Output format:** Return a JSON array of objects, one per statement:

```json
[
  {{"label": "A", "score": 1, "feedback": "..."}},
  ...
]
```

Return only the JSON array — no commentary before or after it."""

REVISION_PROMPT = """You previously gave the following statement on this topic:

**Topic:** {topic}

**Your statement:**

> {current_statement}

**How {feedback_count} other perspectives reacted to it:**

{feedback_block}

**Your task:** Decide whether to revise your statement.

Disagreement from others is not, by itself, a reason to change your view. Only revise if the feedback surfaces something you find genuinely compelling — a gap in your reasoning, a more plausible mechanism, a detail worth sharpening. If you still believe your original statement is right, keep it exactly as it is.

Classify your own change:
- **0 — Unchanged.** Your statement is identical to before.
- **1 — Minor revision.** Wording or detail changed; core position is the same.
- **2 — Major revision.** The core claim or position itself changed.

**Output format:**

```json
{{
  "revision_score": 0,
  "statement": "...",
  "rationale": "1-3 sentences on why you kept it, softened it, or changed it"
}}
```

Return only the JSON object — no commentary before or after it."""

ANALYSIS_PROMPT = """You are analyzing the final statements from {model_count} independent AI models on a specific topic.

**Topic:** {topic}

**Peer feedback context:** After initial statements, models scored each other's work (1-5 scale) and provided feedback. They then had the opportunity to revise. The statements below are the final versions after this peer review process.

{statements_block}

**Your task:** Evaluate the original expert output based on the multi-model debate. Score the output's quality and provide structured feedback.

**Output format:**

```json
{{
  "summary": "1-2 sentence overall takeaway",
  "score": 7,
  "strengths": [
    {{"id": "s1", "text": "Specific strength — what the models agreed works well"}},
    {{"id": "s2", "text": "Another strength"}}
  ],
  "concerns": [
    {{"id": "c1", "text": "Specific concern — where models disagreed or flagged issues"}},
    {{"id": "c2", "text": "Another concern"}}
  ],
  "suggestions": [
    {{"id": "sg1", "text": "Concrete actionable improvement based on the debate"}},
    {{"id": "sg2", "text": "Another suggestion"}}
  ],
  "strongest_ideas": [
    {{"id": "si1", "text": "The most compelling specific idea that emerged from the debate"}},
    {{"id": "si2", "text": "Another strong idea"}}
  ]
}}
```

Score 1-10 where 10 means the models unanimously validated the output. Aim for 3-6 items per section. Be specific — cite which models and what they said. Return only the JSON object."""


def parse_json_response(text: str):
    text = text.strip()
    match = FENCE_RE.search(text)
    if match:
        text = match.group(1)
    return json.loads(text)


_shared_client: Runware | None = None


async def _get_shared_client() -> Runware:
    global _shared_client
    if _shared_client is None:
        api_key = os.getenv("RUNWARE_API_KEY")
        if not api_key:
            raise ValueError("RUNWARE_API_KEY not set")
        _shared_client = Runware(api_key=api_key)
        await _shared_client.connect()
    return _shared_client


async def _call_model(model_id: str, user_message: str, system_prompt: str = "", thinking_level: str = "off") -> str:
    """Call a model via shared Runware connection."""
    client = await _get_shared_client()

    settings = {
        "maxTokens": 4096,
        "thinkingLevel": thinking_level,
    }
    if system_prompt:
        settings["systemPrompt"] = system_prompt

    request = ITextInference(
        model=model_id,
        messages=[ITextInferenceMessage(role="user", content=user_message)],
        settings=settings,
    )

    results = await client.textInference(request)
    return results[0].text


async def _call_with_retry(model, prompt, emit, system_prompt="", max_attempts=5):
    for attempt in range(max_attempts):
        try:
            result = await _call_model(model["id"], prompt, system_prompt=system_prompt, thinking_level=model.get("thinking", "off"))
            await asyncio.sleep(3)
            return result
        except Exception as e:
            if "concurrentRequestLimitExceeded" in str(e) and attempt < max_attempts - 1:
                wait = 20 * (attempt + 1)
                emit(f"  {model['name']} rate limited, retrying in {wait}s...", level="info")
                await asyncio.sleep(wait)
            else:
                emit(f"  {model['name']} FAILED: {e}", level="error")
                return None


async def run_feedback_loop(
    expert_output: str,
    expert_role: str,
    max_rounds: int = 3,
    on_event=None,
):
    """Run the full multi-model feedback loop on an expert's output."""
    models = COUNCIL_MODELS
    topic = f"{expert_role}'s output"

    def emit(msg, level="info", **extra):
        if on_event:
            on_event({"message": msg, "level": level, "time": datetime.now().strftime("%H:%M:%S"), **extra})

    result = {
        "expert_role": expert_role,
        "models": [m["name"] for m in models],
        "rounds": [],
        "analysis": None,
        "started_at": datetime.now().isoformat(),
        "completed_at": None,
    }

    # Round 1: Each model produces its own statement
    emit(f"Round 1: {len(models)} models producing initial statements...", level="phase")
    round1_prompt = (
        f"You are reviewing the following expert output and producing your own independent "
        f"perspective on the same topic. Read the expert's work carefully, then write your own "
        f"statement — agree, disagree, extend, or reframe as you see fit.\n\n"
        f"**Expert ({expert_role}) output:**\n\n{expert_output}\n\n"
        f"**Your task:** Write your own statement on this topic (150-300 words). Take a clear, "
        f"specific position with concrete details. Return only the statement text."
    )

    statements = {}
    for model in models:
        emit(f"  {model['name']} generating statement...", level="start")
        text = await _call_with_retry(model, round1_prompt, emit)
        if text:
            emit(f"  {model['name']} done ({len(text)} chars)", level="done")
            statements[model["id"]] = {"name": model["name"], "text": text, "model_id": model["id"]}
        else:
            emit(f"  {model['name']} FAILED after retries", level="error")

    emit(f"Round 1 complete: {len(statements)}/{len(models)} statements collected", level="done")

    round_data = {
        "round": 1,
        "statements": {mid: {"name": s["name"], "text": s["text"]} for mid, s in statements.items()},
        "feedback": {},
        "revisions": {},
    }
    result["rounds"].append(round_data)

    if len(statements) < 2:
        emit("Not enough statements to run peer review — aborting", level="error")
        result["completed_at"] = datetime.now().isoformat()
        return result

    # Iterative feedback + revision rounds
    for round_num in range(1, max_rounds + 1):
        emit(f"Round {round_num}: Peer feedback phase ({len(statements)} models)...", level="phase")

        all_feedback = {}
        feedback_tasks = []

        for reviewer_id, reviewer_data in statements.items():
            others = [(mid, s) for mid, s in statements.items() if mid != reviewer_id]
            if not others:
                continue
            shuffled = random.sample(others, len(others))
            label_map = {}
            stmts_block = ""
            for i, (mid, s) in enumerate(shuffled):
                label = LABELS[i] if i < len(LABELS) else f"S{i+1}"
                label_map[label] = mid
                stmts_block += f'\n> **{label}.** {s["text"]}\n'

            prompt = FEEDBACK_PROMPT.format(
                topic=topic, count=len(others), statements_block=stmts_block
            )

            reviewer_model = next(m for m in models if m["id"] == reviewer_id)
            emit(f"  {reviewer_model['name']} reviewing peers...", level="start")
            resp = await _call_with_retry(reviewer_model, prompt, emit)
            mapped = []
            if resp:
                try:
                    reviews = parse_json_response(resp)
                    for review in reviews:
                        target_mid = label_map.get(review.get("label"))
                        if target_mid:
                            mapped.append({
                                "reviewer": reviewer_model["name"],
                                "target_model": target_mid,
                                "score": review.get("score", 3),
                                "feedback": review.get("feedback", ""),
                            })
                    emit(f"  {reviewer_model['name']} done reviewing", level="done")
                except Exception as e:
                    emit(f"  {reviewer_model['name']} parse failed: {e}", level="error")
            all_feedback[reviewer_id] = mapped

        feedback_by_target = {}
        for reviewer_id, reviews in all_feedback.items():
            for review in reviews:
                tid = review["target_model"]
                if tid not in feedback_by_target:
                    feedback_by_target[tid] = []
                feedback_by_target[tid].append(review)

        round_data["feedback"] = {
            mid: feedback_by_target.get(mid, []) for mid in statements
        }

        # Revision phase
        emit(f"Round {round_num}: Revision phase...", level="phase")
        any_major = False
        rev_results = []

        for model_id, model_data in statements.items():
            my_feedback = feedback_by_target.get(model_id, [])
            if not my_feedback:
                continue

            fb_block = ""
            for i, fb in enumerate(my_feedback, 1):
                fb_block += f'{i}. Score: {fb["score"]}/5 — {fb["feedback"]}\n'

            prompt = REVISION_PROMPT.format(
                topic=topic,
                current_statement=model_data["text"],
                feedback_count=len(my_feedback),
                feedback_block=fb_block,
            )

            rev_model = next(m for m in models if m["id"] == model_id)
            emit(f"  {rev_model['name']} considering revision...", level="start")
            resp = await _call_with_retry(rev_model, prompt, emit)
            if resp:
                try:
                    rev = parse_json_response(resp)
                    score = rev.get("revision_score", 0)
                    label = ["unchanged", "minor revision", "MAJOR revision"][score]
                    emit(f"  {rev_model['name']}: {label} — {rev.get('rationale', '')[:80]}", level="done")
                except Exception as e:
                    emit(f"  {rev_model['name']} revision parse failed: {e}", level="error")
                    rev = {"revision_score": 0, "statement": statements[model_id]["text"], "rationale": "Parse error"}
            else:
                rev = {"revision_score": 0, "statement": statements[model_id]["text"], "rationale": "Call failed"}
            rev_results.append((model_id, rev))

        revisions = {}
        all_unchanged = True
        for model_id, rev in rev_results:
            revisions[model_id] = rev
            score = rev.get("revision_score", 0)
            if score == 2:
                any_major = True
            if score > 0:
                all_unchanged = False
            statements[model_id]["text"] = rev.get("statement", statements[model_id]["text"])

        round_data["revisions"] = revisions

        new_round = {
            "round": round_num + 1,
            "statements": {mid: {"name": s["name"], "text": s["text"]} for mid, s in statements.items()},
            "feedback": {},
            "revisions": {},
        }

        if all_unchanged:
            emit(f"Full convergence after round {round_num} — all models unchanged", level="done")
            result["rounds"].append(new_round)
            break
        elif not any_major:
            emit(f"Convergence reached after round {round_num} — no major revisions (minor only)", level="done")
            result["rounds"].append(new_round)
            break
        elif round_num == max_rounds:
            emit(f"Hit max rounds ({max_rounds}) — stopping", level="info")
            result["rounds"].append(new_round)
        else:
            emit(f"Major revisions detected — continuing to round {round_num + 1}", level="info")
            result["rounds"].append(new_round)
            round_data = new_round

    # Post-hoc analysis
    emit("Running post-hoc analysis (Claude Opus 4.8)...", level="phase")
    stmts_block = ""
    for mid, s in statements.items():
        stmts_block += f'**{s["name"]}:**\n{s["text"]}\n\n'

    analysis_prompt = ANALYSIS_PROMPT.format(
        model_count=len(statements),
        topic=topic,
        statements_block=stmts_block,
    )

    try:
        analysis_resp = await _call_model(COUNCIL_MODELS[0]["id"], analysis_prompt, thinking_level=COUNCIL_MODELS[0].get("thinking", "off"))
        analysis = parse_json_response(analysis_resp)
        result["analysis"] = analysis
        emit("Analysis complete", level="done")
    except Exception as e:
        emit(f"Analysis error: {e}", level="error")
        result["analysis"] = {"summary": f"Analysis failed: {e}", "similarities": [], "differences": []}

    result["completed_at"] = datetime.now().isoformat()
    emit(f"Feedback loop complete — {len(result['rounds'])} rounds, {len(statements)} models", level="done")
    return result
