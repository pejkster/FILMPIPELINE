"""Dashboard API — serves pipeline state, checkpoint actions, and Runware generation."""

import asyncio
import json
import uuid
from datetime import datetime
from pathlib import Path

import yaml
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

load_dotenv()

PIPELINE_ROOT = Path(__file__).parent.parent / "pipeline"
UI_DIR = Path(__file__).parent

app = FastAPI(title="Metaninoa Pipeline")
app.mount("/static", StaticFiles(directory=UI_DIR / "static"), name="static")
templates = Jinja2Templates(directory=UI_DIR / "templates")

STAGE_DIRS = {
    1: "01_llm_council",
    2: "02_worldbuilding",
    3: "03_production",
}

STAGE_META = {
    1: {
        "name": "Idea",
        "icon": "💡",
        "description": "Research, vision synthesis, narrative, and treatment",
        "color": "#6366f1",
    },
    2: {
        "name": "Worldbuilding",
        "icon": "🌍",
        "description": "Characters, environments, and visual consistency",
        "color": "#f59e0b",
    },
    3: {
        "name": "Production",
        "icon": "🎬",
        "description": "Shot generation, audio, and final composition",
        "color": "#10b981",
    },
}

# ── Background job tracking ──────────────────────────────────

jobs: dict[str, dict] = {}


def load_stage_config(stage: int) -> dict:
    config_path = PIPELINE_ROOT / STAGE_DIRS[stage] / "config" / "stage.yaml"
    if not config_path.exists():
        return {}
    with open(config_path) as f:
        return yaml.safe_load(f)


def load_stage_artifacts(stage: int) -> list[dict]:
    output_dir = PIPELINE_ROOT / STAGE_DIRS[stage] / "outputs"
    artifacts = []
    if not output_dir.exists():
        return artifacts
    for path in sorted(output_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text())
            data["_filename"] = path.name
            artifacts.append(data)
        except (json.JSONDecodeError, KeyError):
            continue
    return artifacts


def get_stage_status(stage: int, artifacts: list[dict]) -> str:
    if not artifacts:
        return "idle"
    statuses = [a.get("approval", "pending") for a in artifacts]
    if all(s == "approved" for s in statuses):
        return "approved"
    if any(s == "rejected" for s in statuses):
        return "rejected"
    if any(s == "revision_requested" for s in statuses):
        return "revision"
    return "pending"


def save_generation_artifact(stage: int, artifact_type: str, content: dict) -> dict:
    output_dir = PIPELINE_ROOT / STAGE_DIRS[stage] / "outputs"
    output_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    artifact_id = str(uuid.uuid4())
    filename = f"{artifact_type}_{timestamp}.json"

    data = {
        "id": artifact_id,
        "type": artifact_type,
        "stage": stage,
        "version": 1,
        "approval": "pending",
        "notes": "",
        "created_at": datetime.now().isoformat(),
        "content": content,
    }
    (output_dir / filename).write_text(json.dumps(data, indent=2))
    data["_filename"] = filename
    return data


# ── Page routes ──────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse(request, "dashboard.html")


# ── Pipeline state API ───────────────────────────────────────

@app.get("/api/pipeline")
async def get_pipeline_state():
    stages = []
    for stage_num in [1, 2, 3]:
        config = load_stage_config(stage_num)
        artifacts = load_stage_artifacts(stage_num)
        status = get_stage_status(stage_num, artifacts)
        meta = STAGE_META[stage_num]
        stages.append({
            "stage": stage_num,
            "name": meta["name"],
            "icon": meta["icon"],
            "description": meta["description"],
            "color": meta["color"],
            "status": status,
            "artifact_count": len(artifacts),
            "artifacts": artifacts,
            "config": config,
        })
    return JSONResponse({"stages": stages})


# ── Artifact checkpoint actions ──────────────────────────────

@app.post("/api/artifacts/{stage}/{filename}/approve")
async def approve_artifact(stage: int, filename: str):
    return _update_artifact_status(stage, filename, "approved")


@app.post("/api/artifacts/{stage}/{filename}/reject")
async def reject_artifact(stage: int, filename: str):
    return _update_artifact_status(stage, filename, "rejected")


@app.post("/api/artifacts/{stage}/{filename}/revision")
async def request_revision(stage: int, filename: str):
    return _update_artifact_status(stage, filename, "revision_requested")


def _update_artifact_status(stage: int, filename: str, status: str) -> JSONResponse:
    output_dir = PIPELINE_ROOT / STAGE_DIRS[stage] / "outputs"
    path = output_dir / filename
    if not path.exists():
        return JSONResponse({"error": "Artifact not found"}, status_code=404)
    data = json.loads(path.read_text())
    data["approval"] = status
    path.write_text(json.dumps(data, indent=2))
    return JSONResponse({"ok": True, "status": status})


@app.delete("/api/artifacts/{stage}/{filename}")
async def delete_artifact(stage: int, filename: str):
    output_dir = PIPELINE_ROOT / STAGE_DIRS[stage] / "outputs"
    path = output_dir / filename
    if not path.exists():
        return JSONResponse({"error": "Artifact not found"}, status_code=404)
    path.unlink()
    return JSONResponse({"ok": True})


# ── Helpers for multi-stage council support ─────────────────

def _stage_dir(stage: int) -> Path:
    return PIPELINE_ROOT / STAGE_DIRS[stage]


def _find_expert_stage(expert_id: str) -> int | None:
    """Find which stage an expert belongs to by checking configs."""
    for stage_num in [1, 2]:
        config = load_stage_config(stage_num)
        for phase in config.get("phases", []):
            for expert in phase.get("experts", []):
                if expert["id"] == expert_id:
                    return stage_num
    return None


def _results_dir(stage: int) -> Path:
    return _stage_dir(stage) / "outputs" / "experts"


# ── Council: expert detail ───────────────────────────────────

@app.get("/api/council/expert/{expert_id}")
async def get_expert_detail(expert_id: str):
    """Get full details for an expert including their prompt."""
    for stage_num in [1, 2]:
        config = load_stage_config(stage_num)
        for phase in config.get("phases", []):
            for expert in phase.get("experts", []):
                if expert["id"] == expert_id:
                    prompt_path = _stage_dir(stage_num) / expert["prompt_file"]
                    if not prompt_path.exists():
                        prompt_path = PIPELINE_ROOT / "01_llm_council" / expert["prompt_file"]
                    prompt_content = prompt_path.read_text() if prompt_path.exists() else ""

                    return JSONResponse({
                        "id": expert["id"],
                        "role": expert["role"],
                        "phase_id": phase["id"],
                        "phase_name": phase["name"],
                        "prompt_file": expert["prompt_file"],
                        "prompt": prompt_content,
                        "receives": expert.get("receives", []),
                        "stage": stage_num,
                    })

    return JSONResponse({"error": "Expert not found"}, status_code=404)


# ── Council: expert results (individual files) ────────────────

@app.get("/api/council/results")
async def get_council_results(stage: int = 1):
    """Get all individual expert results for the progress view."""
    results = []
    for s in ([stage] if stage else [1, 2]):
        rdir = _results_dir(s)
        if rdir.exists():
            for path in sorted(rdir.glob("*.json")):
                try:
                    data = json.loads(path.read_text())
                    results.append(data)
                except (json.JSONDecodeError, KeyError):
                    continue
    return JSONResponse({"results": results})


@app.get("/api/council/results/{expert_id}")
async def get_expert_result(expert_id: str):
    """Get a single expert's result."""
    for s in [1, 2]:
        path = _results_dir(s) / f"{expert_id}.json"
        if path.exists():
            data = json.loads(path.read_text())
            return JSONResponse(data)
    return JSONResponse({"error": "No result for this expert"}, status_code=404)


# ── Council: prompt editing ───────────────────────────────────

class SavePromptRequest(BaseModel):
    content: str


@app.put("/api/council/expert/{expert_id}/prompt")
async def save_expert_prompt(expert_id: str, req: SavePromptRequest):
    """Save edited prompt for an expert."""
    config = load_stage_config(1)
    for phase in config["phases"]:
        for expert in phase["experts"]:
            if expert["id"] == expert_id:
                prompt_path = PIPELINE_ROOT / "01_llm_council" / expert["prompt_file"]
                prompt_path.write_text(req.content)
                return JSONResponse({"ok": True})
    return JSONResponse({"error": "Expert not found"}, status_code=404)


# ── Council: clear results ────────────────────────────────────

@app.post("/api/council/results/clear")
async def clear_council_results():
    """Clear all individual expert results."""
    results_dir = PIPELINE_ROOT / STAGE_DIRS[1] / "outputs" / "experts"
    if results_dir.exists():
        for path in results_dir.glob("*.json"):
            path.unlink()
    # Also clear the synthesis
    synth_path = PIPELINE_ROOT / STAGE_DIRS[1] / "outputs" / "experts" / "_synthesis.json"
    if synth_path.exists():
        synth_path.unlink()
    return JSONResponse({"ok": True})


# ── Council: clear by phase / expert ─────────────────────────

@app.delete("/api/council/results/{expert_id}")
async def delete_expert_result(expert_id: str):
    """Delete a single expert's result."""
    for s in [1, 2]:
        path = _results_dir(s) / f"{expert_id}.json"
        if path.exists():
            path.unlink()
            return JSONResponse({"ok": True})
    return JSONResponse({"error": "Not found"}, status_code=404)


@app.post("/api/council/results/clear/{phase_id}")
async def clear_phase_results(phase_id: str):
    """Clear all expert results for a specific phase."""
    cleared = 0
    for s in [1, 2]:
        rdir = _results_dir(s)
        if not rdir.exists():
            continue
        for path in rdir.glob("*.json"):
            if path.name.startswith("_"):
                continue
            try:
                data = json.loads(path.read_text())
                if data.get("phase_id") == phase_id:
                    path.unlink()
                    cleared += 1
            except (json.JSONDecodeError, KeyError):
                continue
    return JSONResponse({"ok": True, "cleared": cleared})


# ── Council: rerun single expert ─────────────────────────────

class RerunExpertRequest(BaseModel):
    custom_prompt: str | None = None


@app.post("/api/council/expert/{expert_id}/rerun")
async def rerun_expert(expert_id: str, req: RerunExpertRequest):
    """Rerun a single expert, optionally with a custom prompt override."""
    import importlib
    council_mod = importlib.import_module("pipeline.01_llm_council.council")

    config = load_stage_config(1)
    expert_config = None
    phase_id = None
    for phase in config["phases"]:
        for expert in phase["experts"]:
            if expert["id"] == expert_id:
                expert_config = expert
                phase_id = phase["id"]
                break

    if not expert_config:
        return JSONResponse({"error": "Expert not found"}, status_code=404)

    council = council_mod.LLMCouncil()
    council._load_prior_outputs()

    ec = council_mod.ExpertConfig(
        id=expert_config["id"],
        role=expert_config["role"],
        prompt_file=expert_config["prompt_file"],
        receives=expert_config.get("receives", []),
    )

    # Find the matching PhaseConfig object
    phase_obj = next((p for p in council.phases if p.id == phase_id), None)

    try:
        if req.custom_prompt:
            context = council._build_phase_context(phase_obj) if phase_obj else ""
            user_message = (
                "Produce your deliverable now. Follow your instructions precisely. "
                "Be thorough, specific, and vivid. This is for a real film competition "
                "with a $3.5 million prize — bring your best work."
            )
            if context:
                user_message = context + "\n\n---\n\n" + user_message
            content = await council._call_llm(req.custom_prompt, user_message)
            output = council_mod.ExpertOutput(
                expert_id=ec.id, role=ec.role, phase_id=phase_id, content=content
            )
            council.outputs[ec.id] = output
        else:
            output = await council.run_expert(ec, phase_obj or phase_id)

        _save_expert_result(output.expert_id, output.role, phase_id, output.content)
        return JSONResponse({
            "ok": True,
            "result": {
                "expert_id": output.expert_id,
                "role": output.role,
                "phase_id": phase_id,
                "content": output.content,
                "timestamp": output.timestamp.isoformat(),
            }
        })
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ── Council: chat with expert ────────────────────────────────

class ChatExpertRequest(BaseModel):
    message: str


@app.post("/api/council/expert/{expert_id}/chat")
async def chat_with_expert(expert_id: str, req: ChatExpertRequest):
    """Send a follow-up message to an expert, using their output as context."""
    import importlib
    council_mod = importlib.import_module("pipeline.01_llm_council.council")

    # Load existing result
    result_path = PIPELINE_ROOT / STAGE_DIRS[1] / "outputs" / "experts" / f"{expert_id}.json"
    if not result_path.exists():
        return JSONResponse({"error": "No existing output to chat with"}, status_code=400)

    result_data = json.loads(result_path.read_text())

    # Load the expert's original prompt as system prompt
    config = load_stage_config(1)
    system_prompt = ""
    for phase in config["phases"]:
        for expert in phase["experts"]:
            if expert["id"] == expert_id:
                prompt_path = PIPELINE_ROOT / "01_llm_council" / expert["prompt_file"]
                if prompt_path.exists():
                    system_prompt = prompt_path.read_text()
                break

    # Load chat history
    chat_path = PIPELINE_ROOT / STAGE_DIRS[1] / "outputs" / "experts" / f"{expert_id}_chat.json"
    chat_history = []
    if chat_path.exists():
        chat_history = json.loads(chat_path.read_text())

    # Build user message with original output as context
    user_message = (
        f"Here is your previous output:\n\n{result_data['content']}\n\n---\n\n"
        f"The user has a follow-up question or request:\n\n{req.message}"
    )

    council = council_mod.LLMCouncil()
    try:
        response = await council._call_llm(system_prompt, user_message)

        chat_entry = {
            "user": req.message,
            "assistant": response,
            "timestamp": datetime.now().isoformat(),
        }
        chat_history.append(chat_entry)
        chat_path.write_text(json.dumps(chat_history, indent=2))

        return JSONResponse({"ok": True, "response": response, "history": chat_history})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/api/council/expert/{expert_id}/chat")
async def get_expert_chat(expert_id: str):
    """Get chat history for an expert."""
    chat_path = PIPELINE_ROOT / STAGE_DIRS[1] / "outputs" / "experts" / f"{expert_id}_chat.json"
    if not chat_path.exists():
        return JSONResponse({"history": []})
    return JSONResponse({"history": json.loads(chat_path.read_text())})


# ── Council: synthesize results ───────────────────────────────

SYNTHESIS_PROMPTS = {
    1: """You are a synthesis expert. You receive research outputs from multiple domain experts about a hopeful future for humanity.

Produce a clear, structured synthesis with:
1. **Top 5 Key Takeaways** — the most important cross-cutting insights
2. **Common Themes** — patterns that appear across multiple experts
3. **Tensions & Trade-offs** — where experts disagree or identify competing priorities
4. **Strongest Visual Opportunities** — the most cinematic moments suggested across all experts
5. **Recommended Focus Areas** — what the film should prioritize given all inputs

Be concise and specific. This is for a 3-minute cinematic trailer about an abundant future.""",

    2: """You are a worldbuilding synthesis expert. You receive outputs from world design experts who have built the rules, characters, environments, and sensory reality of a near-future world.

Your job is to distill their work into **production-ready briefs** that downstream visual artists can act on directly.

Produce a structured synthesis with these exact sections:

## World Summary
A single-paragraph description of this world — its core identity, what makes it feel real, what makes it feel different from today.

## Character Briefs
For each major character the experts defined:
- **Name & Role** — who they are in the story
- **Visual Description** — age, build, face, hair, skin tone, distinguishing features (be specific enough for image generation)
- **Wardrobe** — what they wear, materials, colors, style (everyday + any special outfits)
- **Emotional Register** — how they carry themselves, default expression, body language
- **Key Props** — objects they interact with

## Environment Briefs
For each key location the experts defined:
- **Name & Function** — what this place is and what happens here
- **Spatial Description** — scale, layout, key architectural features
- **Materials & Surfaces** — what it's made of, textures, how light interacts with surfaces
- **Time of Day & Lighting** — default lighting mood, color temperature
- **Atmosphere** — sounds, smells, temperature, how it feels to be there
- **Camera Opportunities** — the 2-3 most cinematic angles or moments in this space

## Visual Style Guide
- **Color Palette** — 5-7 primary colors with hex codes and where each is used
- **Material Language** — the dominant materials and textures (organic tech, wood+light, etc.)
- **Lighting Philosophy** — how light behaves in this world, golden hour vs cool blue, natural vs artificial
- **Technology Aesthetic** — how tech looks and feels, what it's made of, how people interact with it
- **Typography & Signage** — if text appears in-world, what does it look like

## The Bridge
3-5 visual moments that show the connection from today to this world — what the audience can recognize from their own life, transformed.

Be extremely specific and visual. Every description should be concrete enough that an image generation model could act on it.""",
}


@app.post("/api/council/synthesize")
async def synthesize_results(stage: int = 1):
    """Run an LLM call to synthesize all expert outputs into production-ready briefs."""
    results_dir = PIPELINE_ROOT / STAGE_DIRS.get(stage, STAGE_DIRS[1]) / "outputs" / "experts"
    if not results_dir.exists():
        return JSONResponse({"error": "No expert results to synthesize"}, status_code=400)

    expert_texts = []
    for path in sorted(results_dir.glob("*.json")):
        if path.name.startswith("_"):
            continue
        data = json.loads(path.read_text())
        expert_texts.append(f"## {data['role']}\n\n{data['content'][:3000]}")

    if not expert_texts:
        return JSONResponse({"error": "No expert results to synthesize"}, status_code=400)

    combined = "\n\n---\n\n".join(expert_texts)
    system_prompt = SYNTHESIS_PROMPTS.get(stage, SYNTHESIS_PROMPTS[1])

    import importlib
    council_mod = importlib.import_module("pipeline.01_llm_council.council")
    council = council_mod.LLMCouncil(stage=stage)
    try:
        result = await council._call_llm(system_prompt, f"Synthesize these expert outputs into production-ready briefs:\n\n{combined}")
        synth_path = results_dir / "_synthesis.json"
        synth_data = {
            "content": result,
            "timestamp": datetime.now().isoformat(),
            "expert_count": len(expert_texts),
            "stage": stage,
        }
        synth_path.write_text(json.dumps(synth_data, indent=2))

        # For Stage 2, auto-extract structured briefs for generation cards
        briefs_data = None
        if stage == 2:
            try:
                briefs_data = await _extract_briefs(council, result)
                briefs_path = results_dir / "_briefs.json"
                briefs_path.write_text(json.dumps(briefs_data, indent=2))
            except Exception:
                pass

        resp = {"ok": True, "synthesis": synth_data}
        if briefs_data:
            resp["briefs"] = briefs_data
        return JSONResponse(resp)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


BRIEFS_EXTRACTION_PROMPT = """You are extracting structured data from a worldbuilding synthesis document. Parse the synthesis and extract every character and environment into a structured JSON format that can be used directly for image generation.

For characters, write a detailed visual prompt that an image generation model can use — focus on physical appearance, clothing, posture, and setting. Do NOT include abstract traits like "brave" — only what a camera would see.

For environments, write a detailed scene prompt — architecture, materials, lighting, atmosphere, time of day, camera angle.

For the style guide, extract the color palette and overall aesthetic direction.

Return ONLY valid JSON in this exact format:

```json
{
  "characters": [
    {
      "name": "Character Name",
      "role": "Their role in the story",
      "description": "2-3 sentence character summary for context",
      "visual_prompt": "Detailed visual description for image generation: age, ethnicity, build, face, hair, skin, clothing materials and colors, pose, expression, setting, lighting. 50-80 words.",
      "style_prompt": "grounded sci-fi, organic materials, warm palette, cinematic portrait"
    }
  ],
  "environments": [
    {
      "name": "Location Name",
      "function": "What happens here",
      "description": "2-3 sentence location summary",
      "visual_prompt": "Detailed scene description for image generation: architecture, materials, scale, lighting, atmosphere, time of day, camera angle, foreground/midground/background elements. 50-80 words.",
      "style_prompt": "grounded sci-fi, organic architecture, golden hour, cinematic wide shot"
    }
  ],
  "style": {
    "palette": [
      {"name": "color name", "hex": "#hex", "usage": "where this color appears"}
    ],
    "aesthetic": "One paragraph describing the overall visual aesthetic",
    "lighting": "One paragraph on lighting philosophy",
    "materials": "One paragraph on dominant materials and textures"
  }
}
```

Extract ALL characters and environments mentioned. Be thorough with visual prompts — they must be specific enough for consistent image generation."""


async def _extract_briefs(council, synthesis_content: str) -> dict:
    """Extract structured briefs from synthesis markdown."""
    result = await council._call_llm(
        BRIEFS_EXTRACTION_PROMPT,
        f"Extract structured briefs from this synthesis:\n\n{synthesis_content}"
    )
    text = result.strip()
    import re
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        text = match.group(1)
    return json.loads(text)


@app.post("/api/council/synthesize-phase")
async def synthesize_phase(phase_id: str, stage: int = 1):
    """Synthesize outputs from a single phase."""
    results_dir = PIPELINE_ROOT / STAGE_DIRS.get(stage, STAGE_DIRS[1]) / "outputs" / "experts"
    if not results_dir.exists():
        return JSONResponse({"error": "No results directory"}, status_code=400)

    config = load_stage_config(stage)
    phase_config = next((p for p in config["phases"] if p["id"] == phase_id), None)
    if not phase_config:
        return JSONResponse({"error": "Phase not found"}, status_code=404)

    expert_ids = {e["id"] for e in phase_config["experts"]}
    expert_texts = []
    for path in sorted(results_dir.glob("*.json")):
        if path.name.startswith("_"):
            continue
        data = json.loads(path.read_text())
        if data.get("expert_id") in expert_ids:
            expert_texts.append(f"## {data['role']}\n\n{data['content'][:3000]}")

    if not expert_texts:
        return JSONResponse({"error": "No expert results for this phase"}, status_code=400)

    combined = "\n\n---\n\n".join(expert_texts)
    phase_name = phase_config["name"]

    system_prompt = f"""You are a synthesis expert. You receive outputs from the "{phase_name}" phase experts.

Produce a clear, structured synthesis of their work:
1. **Key Findings** — the most important insights from this phase
2. **Common Ground** — where experts agree
3. **Tensions** — where experts disagree or identify trade-offs
4. **Actionable Outputs** — specific decisions, descriptions, or specs that downstream work can build on
5. **Open Questions** — what still needs resolution

Be concise and specific. Focus on what's actionable."""

    import importlib
    council_mod = importlib.import_module("pipeline.01_llm_council.council")
    council = council_mod.LLMCouncil(stage=stage)
    try:
        result = await council._call_llm(system_prompt, f"Synthesize these {phase_name} phase outputs:\n\n{combined}")
        synth_path = results_dir / f"_synthesis_{phase_id}.json"
        synth_data = {
            "content": result,
            "phase_id": phase_id,
            "phase_name": phase_name,
            "timestamp": datetime.now().isoformat(),
            "expert_count": len(expert_texts),
            "stage": stage,
        }
        synth_path.write_text(json.dumps(synth_data, indent=2))
        return JSONResponse({"ok": True, "synthesis": synth_data})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/api/council/synthesis")
async def get_synthesis(stage: int = 1):
    """Get the saved synthesis if it exists."""
    stage_dir = STAGE_DIRS.get(stage, STAGE_DIRS[1])
    synth_path = PIPELINE_ROOT / stage_dir / "outputs" / "experts" / "_synthesis.json"
    if not synth_path.exists():
        return JSONResponse({"synthesis": None})
    data = json.loads(synth_path.read_text())
    return JSONResponse({"synthesis": data})


@app.get("/api/council/briefs")
async def get_briefs(stage: int = 2):
    """Get extracted structured briefs for generation cards."""
    stage_dir = STAGE_DIRS.get(stage, STAGE_DIRS[2])
    briefs_path = PIPELINE_ROOT / stage_dir / "outputs" / "experts" / "_briefs.json"
    if not briefs_path.exists():
        return JSONResponse({"briefs": None})
    data = json.loads(briefs_path.read_text())
    return JSONResponse({"briefs": data})


@app.post("/api/council/briefs/extract")
async def extract_briefs_from_synthesis(stage: int = 2):
    """Re-extract structured briefs from existing synthesis."""
    stage_dir = STAGE_DIRS.get(stage, STAGE_DIRS[stage])
    synth_path = PIPELINE_ROOT / stage_dir / "outputs" / "experts" / "_synthesis.json"
    if not synth_path.exists():
        return JSONResponse({"error": "No synthesis found"}, status_code=400)

    synth = json.loads(synth_path.read_text())
    import importlib
    council_mod = importlib.import_module("pipeline.01_llm_council.council")
    council = council_mod.LLMCouncil(stage=stage)
    try:
        briefs = await _extract_briefs(council, synth["content"])
        briefs_path = PIPELINE_ROOT / stage_dir / "outputs" / "experts" / "_briefs.json"
        briefs_path.write_text(json.dumps(briefs, indent=2))
        return JSONResponse({"ok": True, "briefs": briefs})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ── Council: phases ──────────────────────────────────────────

@app.get("/api/council/phases")
async def get_council_phases(stage: int = 1):
    config = load_stage_config(stage)
    artifacts = load_stage_artifacts(stage)

    phases = []
    for phase in config["phases"]:
        phase_artifacts = [
            a for a in artifacts
            if a.get("content", {}).get("phase") == phase["id"]
        ]
        phase_status = "idle"
        if phase_artifacts:
            approvals = [a.get("approval", "pending") for a in phase_artifacts]
            if all(s == "approved" for s in approvals):
                phase_status = "approved"
            elif any(s == "rejected" for s in approvals):
                phase_status = "rejected"
            else:
                phase_status = "pending"

        mode = phase.get("mode", "sequential" if not phase.get("parallel", False) else "parallel")
        phases.append({
            "id": phase["id"],
            "name": phase["name"],
            "description": phase["description"],
            "mode": mode,
            "context_level": phase.get("context_level", "none"),
            "include_prior_stage_context": phase.get("include_prior_stage_context",
                config.get("include_prior_stage_context", False)),
            "checkpoint": phase["checkpoint"],
            "expert_count": len(phase["experts"]),
            "experts": [
                {"id": e["id"], "role": e["role"]}
                for e in phase["experts"]
            ],
            "status": phase_status,
            "artifacts": phase_artifacts,
        })

    return JSONResponse({"phases": phases})


# ── Council: phase mode toggle ────────────────────────────────

class SetPhaseModeRequest(BaseModel):
    mode: str  # "parallel" or "sequential"


class SetContextLevelRequest(BaseModel):
    context_level: str  # "none", "basic", "futurax", "disordine"


class UpdatePhaseExpertsRequest(BaseModel):
    experts: list[dict]  # [{"id": "...", "role": "...", "prompt_file": "..."}]


@app.put("/api/council/phase/{phase_id}/mode")
async def set_phase_mode(phase_id: str, req: SetPhaseModeRequest, stage: int = 1):
    """Toggle a phase between parallel and sequential mode."""
    if req.mode not in ("parallel", "sequential"):
        return JSONResponse({"error": "Mode must be 'parallel' or 'sequential'"}, status_code=400)

    config_path = _stage_dir(stage) / "config" / "stage.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    found = False
    for phase in config["phases"]:
        if phase["id"] == phase_id:
            phase["mode"] = req.mode
            phase.pop("parallel", None)
            found = True
            break

    if not found:
        return JSONResponse({"error": "Phase not found"}, status_code=404)

    with open(config_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False)

    return JSONResponse({"ok": True, "mode": req.mode})


# ── Council: context level per phase ─────────────────────────

@app.get("/api/council/phase/{phase_id}/context-level")
async def get_phase_context_level(phase_id: str):
    config = load_stage_config(1)
    for phase in config["phases"]:
        if phase["id"] == phase_id:
            return JSONResponse({"context_level": phase.get("context_level", "none")})
    return JSONResponse({"error": "Phase not found"}, status_code=404)


@app.put("/api/council/phase/{phase_id}/context-level")
async def set_phase_context_level(phase_id: str, req: SetContextLevelRequest, stage: int = 1):
    valid = ["none", "basic", "futurax", "disordine"]
    if req.context_level not in valid:
        return JSONResponse({"error": f"Must be one of: {valid}"}, status_code=400)

    config_path = _stage_dir(stage) / "config" / "stage.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    for phase in config["phases"]:
        if phase["id"] == phase_id:
            phase["context_level"] = req.context_level
            with open(config_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False, sort_keys=False)
            return JSONResponse({"ok": True, "context_level": req.context_level})

    return JSONResponse({"error": "Phase not found"}, status_code=404)


# ── Council: prior stage context toggle ───────────────────

@app.get("/api/council/phase/{phase_id}/prior-context")
async def get_phase_prior_context(phase_id: str, stage: int = 1):
    config = load_stage_config(stage)
    stage_level = config.get("include_prior_stage_context", False)
    for phase in config["phases"]:
        if phase["id"] == phase_id:
            enabled = phase.get("include_prior_stage_context", stage_level)
            return JSONResponse({"include_prior_stage_context": enabled})
    return JSONResponse({"error": "Phase not found"}, status_code=404)


class SetPriorContextRequest(BaseModel):
    enabled: bool


@app.put("/api/council/phase/{phase_id}/prior-context")
async def set_phase_prior_context(phase_id: str, req: SetPriorContextRequest, stage: int = 1):
    config_path = _stage_dir(stage) / "config" / "stage.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    for phase in config["phases"]:
        if phase["id"] == phase_id:
            phase["include_prior_stage_context"] = req.enabled
            with open(config_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False, sort_keys=False)
            return JSONResponse({"ok": True, "include_prior_stage_context": req.enabled})

    return JSONResponse({"error": "Phase not found"}, status_code=404)


# ── Council: context preamble preview/edit ───────────────────

@app.get("/api/council/context/{level}")
async def get_context_preamble(level: str):
    if level == "none":
        return JSONResponse({"level": "none", "content": ""})
    path = PIPELINE_ROOT / "01_llm_council" / "prompts" / "context" / f"{level}.md"
    if not path.exists():
        return JSONResponse({"error": "Context level not found"}, status_code=404)
    return JSONResponse({"level": level, "content": path.read_text()})


class SaveContextRequest(BaseModel):
    content: str


@app.put("/api/council/context/{level}")
async def save_context_preamble(level: str, req: SaveContextRequest):
    if level == "none":
        return JSONResponse({"error": "Cannot edit 'none' context"}, status_code=400)
    path = PIPELINE_ROOT / "01_llm_council" / "prompts" / "context" / f"{level}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(req.content)
    return JSONResponse({"ok": True})


@app.get("/api/council/context-levels")
async def list_context_levels():
    levels = []
    for level in ["none", "basic", "futurax", "disordine"]:
        if level == "none":
            levels.append({"id": "none", "name": "None", "description": "No shared preamble"})
        else:
            path = PIPELINE_ROOT / "01_llm_council" / "prompts" / "context" / f"{level}.md"
            content = path.read_text() if path.exists() else ""
            levels.append({"id": level, "name": level.title(), "description": content[:100] + "..." if len(content) > 100 else content})
    return JSONResponse({"levels": levels})


# ── Council: expert registry ─────────────────────────────────

class CreateExpertRequest(BaseModel):
    name: str
    description: str
    goals: str


CREATE_EXPERT_SYSTEM_PROMPT = """You are an expert prompt engineer for an AI film production pipeline. You receive a description of a domain expert and generate a structured system prompt for them.

Follow this exact format — write in second person ("You are..."), be specific and evocative about their expertise, and structure the output clearly:

```
# [Expert Title]

[1-2 paragraphs establishing who they are, their expertise, their perspective. Be specific about what makes them uniquely qualified. Reference real-world knowledge domains, methodologies, or creative traditions they draw from.]

## Your Task

[1 paragraph describing what they need to produce. Be specific about the deliverable.]

## What to Produce

[Structured template with labeled sections for their output. Use markdown headers (##) for each section, with parenthetical guidance under each explaining what goes there. Typically 6-10 sections.]
```

Do NOT include any preamble or explanation outside the prompt itself. Output ONLY the expert prompt content."""


@app.post("/api/council/experts/create")
async def create_expert(req: CreateExpertRequest):
    """Create a new expert by generating a structured prompt from a description."""
    import importlib
    import re
    council_mod = importlib.import_module("pipeline.01_llm_council.council")

    expert_id = re.sub(r'[^a-z0-9]+', '_', req.name.lower()).strip('_')
    prompt_path = PIPELINE_ROOT / "01_llm_council" / "prompts" / "experts" / f"{expert_id}.md"

    if prompt_path.exists():
        return JSONResponse({"error": f"Expert '{expert_id}' already exists"}, status_code=409)

    user_message = (
        f"Create an expert prompt for:\n\n"
        f"**Name:** {req.name}\n"
        f"**Description:** {req.description}\n"
        f"**Goals:** {req.goals}\n\n"
        f"Generate the full expert system prompt now."
    )

    council = council_mod.LLMCouncil()
    try:
        content = await council._call_llm(CREATE_EXPERT_SYSTEM_PROMPT, user_message)
        prompt_path.write_text(content)
        first_line = content.strip().split("\n")[0].replace("# ", "").strip()
        return JSONResponse({
            "ok": True,
            "expert": {
                "id": expert_id,
                "role": first_line,
                "prompt_file": f"prompts/experts/{expert_id}.md",
            }
        })
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/api/council/experts/registry")
async def get_expert_registry():
    """List all available expert prompt files as a registry."""
    prompts_dir = PIPELINE_ROOT / "01_llm_council" / "prompts" / "experts"
    if not prompts_dir.exists():
        return JSONResponse({"experts": []})

    # Map prompt_file -> list of phase IDs where it's used (across all stages)
    assigned_phases = {}
    for stage_num in [1, 2]:
        config = load_stage_config(stage_num)
        for phase in config.get("phases", []):
            for e in phase.get("experts", []):
                pf = e.get("prompt_file", "")
                if pf not in assigned_phases:
                    assigned_phases[pf] = []
                assigned_phases[pf].append(phase["id"])

    experts = []
    for path in sorted(prompts_dir.glob("*.md")):
        expert_id = path.stem
        content = path.read_text()
        first_line = content.strip().split("\n")[0].replace("# ", "").strip()
        prompt_file = f"prompts/experts/{path.name}"
        experts.append({
            "id": expert_id,
            "role": first_line,
            "prompt_file": prompt_file,
            "assigned_phases": assigned_phases.get(prompt_file, []),
        })
    return JSONResponse({"experts": experts})


@app.put("/api/council/phase/{phase_id}/experts")
async def update_phase_experts(phase_id: str, req: UpdatePhaseExpertsRequest, stage: int = 1):
    """Update the expert assignments for a phase."""
    config_path = _stage_dir(stage) / "config" / "stage.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    for phase in config["phases"]:
        if phase["id"] == phase_id:
            phase["experts"] = [
                {"id": e["id"], "role": e["role"], "prompt_file": e["prompt_file"]}
                for e in req.experts
            ]
            with open(config_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False, sort_keys=False)
            return JSONResponse({"ok": True})

    return JSONResponse({"error": "Phase not found"}, status_code=404)


# ── Council: run with SSE streaming ──────────────────────────

class RunCouncilRequest(BaseModel):
    phase_id: str | None = None
    stage: int = 1


@app.post("/api/council/run")
async def run_council_start(req: RunCouncilRequest):
    """Start a council run as a background job. Returns a job_id for SSE polling."""
    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "status": "starting",
        "phase_id": req.phase_id,
        "stage": req.stage,
        "logs": [],
        "started_at": datetime.now().isoformat(),
        "experts_total": 0,
        "experts_done": 0,
        "current_expert": None,
        "running_experts": [],
        "error": None,
    }

    task = asyncio.create_task(_run_council_background(job_id, req.phase_id, req.stage))
    jobs[job_id]["_task"] = task

    return JSONResponse({"ok": True, "job_id": job_id})


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Cancel a running council job."""
    if job_id not in jobs:
        return JSONResponse({"error": "Job not found"}, status_code=404)
    job = jobs[job_id]
    if job["status"] not in ("starting", "running"):
        return JSONResponse({"error": "Job is not running"}, status_code=400)
    job["cancelled"] = True
    task = job.get("_task")
    if task and not task.done():
        task.cancel()
    job["status"] = "cancelled"
    job["running_experts"] = []
    _log(job, "Generation cancelled by user", level="error")
    return JSONResponse({"ok": True})


def _save_expert_result(expert_id: str, role: str, phase_id: str, content: str, stage: int = 1):
    """Save a single expert result as its own JSON file for immediate access."""
    output_dir = PIPELINE_ROOT / STAGE_DIRS[stage] / "outputs" / "experts"
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{expert_id}.json"
    data = {
        "expert_id": expert_id,
        "role": role,
        "phase_id": phase_id,
        "content": content,
        "timestamp": datetime.now().isoformat(),
    }
    path.write_text(json.dumps(data, indent=2))


SUMMARY_SYSTEM_PROMPT = """You are a concise summarizer. You receive the full output of a domain expert who was asked to produce research or creative work for a film project.

Produce a clear, structured summary with:
- A one-sentence executive takeaway
- 4-6 key points as bullet points — each should be a complete, specific insight (not a vague category name)
- Keep each bullet to 1-2 sentences max

Do NOT truncate or cut off mid-sentence. Every point should be complete and self-contained.
Write in plain text with markdown bullet points. No headers needed."""


async def _summarize_expert_output(expert_id: str):
    """Run an LLM call to summarize a single expert's output. Saves alongside the result."""
    import importlib
    council_mod = importlib.import_module("pipeline.01_llm_council.council")

    result_path = None
    for s in [1, 2]:
        p = _results_dir(s) / f"{expert_id}.json"
        if p.exists():
            result_path = p
            break
    if not result_path:
        return None

    data = json.loads(result_path.read_text())
    council = council_mod.LLMCouncil()
    summary = await council._call_llm(
        SUMMARY_SYSTEM_PROMPT,
        f"Summarize this {data['role']} output:\n\n{data['content']}"
    )

    data["summary"] = summary
    data["summary_timestamp"] = datetime.now().isoformat()
    result_path.write_text(json.dumps(data, indent=2))
    return summary


@app.post("/api/council/expert/{expert_id}/summarize")
async def summarize_expert(expert_id: str):
    """Generate an LLM summary for a single expert's output."""
    try:
        summary = await _summarize_expert_output(expert_id)
        if summary is None:
            return JSONResponse({"error": "No result to summarize"}, status_code=404)
        return JSONResponse({"ok": True, "summary": summary})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ── Feedback loop: multi-model debate ────────────────────────

feedback_loops: dict[str, dict] = {}


class StartFeedbackLoopRequest(BaseModel):
    max_rounds: int = 3


@app.post("/api/council/expert/{expert_id}/feedback-loop")
async def start_feedback_loop(expert_id: str, req: StartFeedbackLoopRequest):
    """Start a multi-model feedback loop on an expert's output."""
    # Find the expert result
    result_path = None
    for s in [1, 2]:
        p = _results_dir(s) / f"{expert_id}.json"
        if p.exists():
            result_path = p
            break
    if not result_path:
        return JSONResponse({"error": "No expert output to run feedback loop on"}, status_code=404)

    data = json.loads(result_path.read_text())

    loop_id = str(uuid.uuid4())[:8]
    feedback_loops[loop_id] = {
        "status": "running",
        "expert_id": expert_id,
        "expert_role": data["role"],
        "max_rounds": req.max_rounds,
        "events": [],
        "result": None,
        "error": None,
    }

    async def _run():
        from pipeline.shared.services.feedback_loop import run_feedback_loop
        loop = feedback_loops[loop_id]
        try:
            def on_event(evt):
                loop["events"].append(evt)

            result = await run_feedback_loop(
                expert_output=data["content"],
                expert_role=data["role"],
                max_rounds=req.max_rounds,
                on_event=on_event,
            )
            loop["result"] = result
            loop["status"] = "complete"

            # Save alongside expert result
            loop_path = result_path.parent / f"{expert_id}_feedback_loop.json"
            loop_path.write_text(json.dumps(result, indent=2, default=str))

        except Exception as e:
            loop["status"] = "error"
            loop["error"] = str(e)
            import traceback
            loop["events"].append({"message": f"ERROR: {e}", "level": "error", "time": datetime.now().strftime("%H:%M:%S")})
            traceback.print_exc()

    asyncio.create_task(_run())
    return JSONResponse({"ok": True, "loop_id": loop_id})


@app.get("/api/council/expert/{expert_id}/feedback-loop")
async def get_feedback_loop_result(expert_id: str):
    """Get saved feedback loop result for an expert."""
    for s in [1, 2]:
        path = _results_dir(s) / f"{expert_id}_feedback_loop.json"
        if path.exists():
            data = json.loads(path.read_text())
            return JSONResponse({"ok": True, "result": data})
    return JSONResponse({"ok": True, "result": None})


@app.get("/api/feedback-loops/{loop_id}/stream")
async def stream_feedback_loop(loop_id: str):
    """SSE stream of feedback loop progress."""
    if loop_id not in feedback_loops:
        return JSONResponse({"error": "Loop not found"}, status_code=404)

    async def event_generator():
        last_event_count = 0
        while True:
            loop = feedback_loops.get(loop_id)
            if not loop:
                break

            events = loop["events"]
            if len(events) > last_event_count:
                for evt in events[last_event_count:]:
                    data = json.dumps({
                        "type": "log",
                        "time": evt.get("time", ""),
                        "message": evt.get("message", ""),
                        "level": evt.get("level", "info"),
                        "status": loop["status"],
                    })
                    yield f"data: {data}\n\n"
                last_event_count = len(events)

            if loop["status"] in ("complete", "error"):
                data = json.dumps({
                    "type": "done",
                    "status": loop["status"],
                    "error": loop.get("error"),
                })
                yield f"data: {data}\n\n"
                break

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _run_council_background(job_id: str, phase_id: str | None, stage: int = 1):
    """Run council in background, updating job state for SSE consumers."""
    import importlib
    council_mod = importlib.import_module("pipeline.01_llm_council.council")

    job = jobs[job_id]
    try:
        council = council_mod.LLMCouncil(stage=stage)
        council._load_prior_outputs()

        phases_to_run = council.phases
        if phase_id:
            phases_to_run = [p for p in council.phases if p.id == phase_id]

        for phase in phases_to_run:
            job["status"] = "running"
            job["experts_total"] = len(phase.experts)
            job["experts_done"] = 0
            job["phase_name"] = phase.name
            job["phase_id"] = phase.id
            is_parallel = phase.mode == "parallel"

            # Read context_level from config
            raw_config = load_stage_config(stage)
            ctx_level = "none"
            for pc in raw_config["phases"]:
                if pc["id"] == phase.id:
                    ctx_level = pc.get("context_level", "none")
                    break

            has_prior = phase.include_prior_stage_context and stage > 1
            prior_label = f", prior stage context: {'ON' if has_prior else 'OFF'}" if stage > 1 else ""
            _log(job, f"Phase: {phase.name} ({len(phase.experts)} experts, mode: {phase.mode}, context: {ctx_level}{prior_label})", level="phase")
            if has_prior:
                prior_count = sum(1 for o in council.outputs.values()
                    if not any(o.phase_id == p.id for p in council.phases))
                _log(job, f"Prior stage context: {prior_count} outputs loaded", level="info")
            if phase.previous_phase:
                prev_count = sum(1 for o in council.outputs.values() if o.phase_id == phase.previous_phase)
                _log(job, f"Context: {prev_count} outputs from {phase.previous_phase} phase", level="info")

            if is_parallel:
                _log(job, f"Launching {len(phase.experts)} experts in parallel...", level="info")

            results = []
            if is_parallel:
                async def run_and_track(expert):
                    job["running_experts"].append(expert.id)
                    job["current_expert"] = expert.role
                    _log(job, f"Starting: {expert.role}", level="start", expert=expert.id)
                    try:
                        output = await council.run_expert(expert, phase, parallel=True, context_level=ctx_level)
                    finally:
                        if expert.id in job["running_experts"]:
                            job["running_experts"].remove(expert.id)
                    job["experts_done"] += 1
                    _save_expert_result(expert.id, expert.role, phase.id, output.content, stage=stage)
                    _log(job, f"Complete: {expert.role} ({len(output.content)} chars)", level="done", expert=expert.id)
                    return output

                tasks = [run_and_track(e) for e in phase.experts]
                results = list(await asyncio.gather(*tasks))
            else:
                for idx, expert in enumerate(phase.experts):
                    if job.get("cancelled"):
                        _log(job, "Cancelled — stopping before next expert", level="error")
                        raise asyncio.CancelledError()
                    job["running_experts"] = [expert.id]
                    job["current_expert"] = expert.role
                    _log(job, f"[{idx+1}/{len(phase.experts)}] Starting: {expert.role} (sequential + intra-phase context)", level="start", expert=expert.id)
                    _log(job, f"Calling LLM: {council.llm_config['model']}...", level="info")
                    output = await council.run_expert(expert, phase, include_intra_phase=True, context_level=ctx_level)
                    job["running_experts"] = []
                    results.append(output)
                    job["experts_done"] += 1
                    _save_expert_result(expert.id, expert.role, phase.id, output.content, stage=stage)
                    _log(job, f"Complete: {expert.role} ({len(output.content)} chars)", level="done", expert=expert.id)

            # Auto-summarize all completed experts
            for expert in phase.experts:
                _log(job, f"Summarizing {expert.role}...", level="info")
                try:
                    await _summarize_expert_output(expert.id)
                    _log(job, f"Summary ready: {expert.role}", level="done", expert=expert.id)
                except Exception:
                    _log(job, f"Summary failed for {expert.role} (non-critical)", level="info")


            council.save_phase_artifact(phase, results)
            _log(job, f"Artifact saved for phase: {phase.name}", level="save")

            if phase.checkpoint:
                _log(job, f"CHECKPOINT — {phase.name} requires human review before next phase", level="checkpoint")
                break

        job["status"] = "complete"
        job["current_expert"] = None
        _log(job, "All done — results saved to artifacts", level="done")

    except asyncio.CancelledError:
        job["status"] = "cancelled"
        job["running_experts"] = []
        job["current_expert"] = None
        _log(job, "Generation stopped", level="error")
    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)
        import traceback
        _log(job, f"ERROR: {e}", level="error")
        _log(job, traceback.format_exc(), level="error")


def _log(job: dict, msg: str, level: str = "info", expert: str | None = None):
    ts = datetime.now().strftime("%H:%M:%S")
    job["logs"].append({"time": ts, "message": msg, "level": level, "expert": expert})


@app.get("/api/jobs/active")
async def get_active_jobs():
    """Return any currently running jobs so the frontend can reconnect after refresh."""
    active = []
    for job_id, job in jobs.items():
        if job["status"] in ("starting", "running"):
            active.append({
                "job_id": job_id,
                "status": job["status"],
                "phase_id": job.get("phase_id"),
                "phase_name": job.get("phase_name"),
                "experts_done": job.get("experts_done", 0),
                "experts_total": job.get("experts_total", 0),
                "running_experts": job.get("running_experts", []),
                "current_expert": job.get("current_expert"),
            })
    return JSONResponse({"jobs": active})


@app.get("/api/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Poll job status."""
    if job_id not in jobs:
        return JSONResponse({"error": "Job not found"}, status_code=404)
    return JSONResponse(jobs[job_id])


@app.get("/api/jobs/{job_id}/stream")
async def stream_job(job_id: str):
    """SSE stream of job progress."""
    if job_id not in jobs:
        return JSONResponse({"error": "Job not found"}, status_code=404)

    async def event_generator():
        last_log_count = 0
        while True:
            job = jobs.get(job_id)
            if not job:
                break

            current_logs = job["logs"]
            if len(current_logs) > last_log_count:
                for log in current_logs[last_log_count:]:
                    data = json.dumps({
                        "type": "log",
                        "time": log["time"],
                        "message": log["message"],
                        "level": log.get("level", "info"),
                        "expert": log.get("expert"),
                        "status": job["status"],
                        "experts_done": job["experts_done"],
                        "experts_total": job["experts_total"],
                        "current_expert": job["current_expert"],
                        "running_experts": job.get("running_experts", []),
                        "phase_name": job.get("phase_name"),
                    })
                    yield f"data: {data}\n\n"
                last_log_count = len(current_logs)

            if job["status"] in ("complete", "error", "cancelled"):
                data = json.dumps({
                    "type": "done",
                    "status": job["status"],
                    "error": job.get("error"),
                })
                yield f"data: {data}\n\n"
                break

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Stage run placeholder ────────────────────────────────────

@app.post("/api/stages/{stage}/run")
async def run_stage_endpoint(stage: int):
    return JSONResponse({
        "ok": True,
        "message": f"Stage {stage} ({STAGE_META[stage]['name']}) triggered",
        "note": "Use /api/council/run for Stage 1",
    })


# ── Runware generation API ───────────────────────────────────

class GenerateImageRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    model: str = "runware:101@1"
    number_results: int = 1
    steps: int = 30
    cfg_scale: float = 7.0
    seed: int | None = None
    stage: int = 2
    artifact_type: str = "concept"
    label: str = ""


class GenerateCharacterRequest(BaseModel):
    name: str
    description: str
    style_prompt: str = ""


class GenerateEnvironmentRequest(BaseModel):
    name: str
    description: str
    style_prompt: str = ""


class GenerateShotRequest(BaseModel):
    description: str
    style_prompt: str = ""
    width: int = 1920
    height: int = 1080


class UpscaleRequest(BaseModel):
    image_url: str
    upscale_factor: int = 2


@app.post("/api/generate/image")
async def generate_image(req: GenerateImageRequest):
    from pipeline.shared.services.runware_service import get_runware_service
    try:
        service = get_runware_service()
        images = await service.generate_image(
            prompt=req.prompt, negative_prompt=req.negative_prompt,
            width=req.width, height=req.height, model=req.model,
            number_results=req.number_results, steps=req.steps,
            cfg_scale=req.cfg_scale, seed=req.seed,
        )
        artifact = save_generation_artifact(
            stage=req.stage, artifact_type=req.artifact_type,
            content={"label": req.label or req.prompt[:80], "prompt": req.prompt,
                     "negative_prompt": req.negative_prompt, "model": req.model,
                     "dimensions": f"{req.width}x{req.height}", "images": images},
        )
        return JSONResponse({"ok": True, "artifact": artifact, "images": images})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.post("/api/generate/character")
async def generate_character(req: GenerateCharacterRequest):
    from pipeline.shared.services.runware_service import get_runware_service
    try:
        service = get_runware_service()
        views = await service.generate_character_sheet(
            name=req.name, description=req.description, style_prompt=req.style_prompt)
        artifact = save_generation_artifact(
            stage=2, artifact_type="character_profile",
            content={"name": req.name, "description": req.description,
                     "style_prompt": req.style_prompt, "views": views})
        return JSONResponse({"ok": True, "artifact": artifact, "views": views})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.post("/api/generate/environment")
async def generate_environment(req: GenerateEnvironmentRequest):
    from pipeline.shared.services.runware_service import get_runware_service
    try:
        service = get_runware_service()
        images = await service.generate_environment(
            name=req.name, description=req.description, style_prompt=req.style_prompt)
        artifact = save_generation_artifact(
            stage=2, artifact_type="environment_spec",
            content={"name": req.name, "description": req.description,
                     "style_prompt": req.style_prompt, "images": images})
        return JSONResponse({"ok": True, "artifact": artifact, "images": images})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.post("/api/generate/shot")
async def generate_shot(req: GenerateShotRequest):
    from pipeline.shared.services.runware_service import get_runware_service
    try:
        service = get_runware_service()
        images = await service.generate_shot(
            description=req.description, style_prompt=req.style_prompt,
            width=req.width, height=req.height)
        artifact = save_generation_artifact(
            stage=3, artifact_type="shot_image",
            content={"description": req.description, "style_prompt": req.style_prompt,
                     "dimensions": f"{req.width}x{req.height}", "images": images})
        return JSONResponse({"ok": True, "artifact": artifact, "images": images})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.post("/api/generate/upscale")
async def upscale_image(req: UpscaleRequest):
    from pipeline.shared.services.runware_service import get_runware_service
    try:
        service = get_runware_service()
        result = await service.upscale_image(
            image_url=req.image_url, upscale_factor=req.upscale_factor)
        return JSONResponse({"ok": True, "result": result})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
