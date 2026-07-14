"""Dashboard API — serves pipeline state, checkpoint actions, and Runware generation."""

import json
import uuid
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
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
        "name": "LLM Council",
        "icon": "🧠",
        "description": "Narrative research, vision, and story generation",
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


def load_stage_config(stage: int) -> dict:
    config_path = PIPELINE_ROOT / STAGE_DIRS[stage] / "config" / "stage.yaml"
    if not config_path.exists():
        return {}
    import yaml
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
    """Save a generated artifact to the stage's output directory."""
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


# ── Stage run ─────────────────────────────────────────────────

class RunCouncilRequest(BaseModel):
    phase_id: str | None = None


@app.post("/api/stages/{stage}/run")
async def run_stage_endpoint(stage: int):
    return JSONResponse({
        "ok": True,
        "message": f"Stage {stage} ({STAGE_META[stage]['name']}) triggered",
        "note": "Use /api/council/run for Stage 1",
    })


@app.post("/api/council/run")
async def run_council(req: RunCouncilRequest):
    """Run the LLM Council — optionally a specific phase."""
    import importlib

    council_mod = importlib.import_module("pipeline.01_llm_council.council")
    LLMCouncil = council_mod.LLMCouncil

    try:
        council = LLMCouncil()
        artifacts = await council.run_council(req.phase_id)

        return JSONResponse({
            "ok": True,
            "phase": req.phase_id or "all",
            "artifacts_produced": len(artifacts),
            "message": f"Council produced {len(artifacts)} artifact(s)",
        })
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/api/council/phases")
async def get_council_phases():
    """Get the council phase structure and status."""
    import yaml

    config_path = PIPELINE_ROOT / "01_llm_council" / "config" / "stage.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    artifacts = load_stage_artifacts(1)

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

        phases.append({
            "id": phase["id"],
            "name": phase["name"],
            "description": phase["description"],
            "parallel": phase["parallel"],
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
    """Generate an image via Runware and save as an artifact."""
    from pipeline.shared.services.runware_service import get_runware_service

    try:
        service = get_runware_service()
        images = await service.generate_image(
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            width=req.width,
            height=req.height,
            model=req.model,
            number_results=req.number_results,
            steps=req.steps,
            cfg_scale=req.cfg_scale,
            seed=req.seed,
        )

        artifact = save_generation_artifact(
            stage=req.stage,
            artifact_type=req.artifact_type,
            content={
                "label": req.label or req.prompt[:80],
                "prompt": req.prompt,
                "negative_prompt": req.negative_prompt,
                "model": req.model,
                "dimensions": f"{req.width}x{req.height}",
                "images": images,
            },
        )
        return JSONResponse({"ok": True, "artifact": artifact, "images": images})

    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.post("/api/generate/character")
async def generate_character(req: GenerateCharacterRequest):
    """Generate a character reference sheet via Runware."""
    from pipeline.shared.services.runware_service import get_runware_service

    try:
        service = get_runware_service()
        views = await service.generate_character_sheet(
            name=req.name,
            description=req.description,
            style_prompt=req.style_prompt,
        )

        artifact = save_generation_artifact(
            stage=2,
            artifact_type="character_profile",
            content={
                "name": req.name,
                "description": req.description,
                "style_prompt": req.style_prompt,
                "views": views,
            },
        )
        return JSONResponse({"ok": True, "artifact": artifact, "views": views})

    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.post("/api/generate/environment")
async def generate_environment(req: GenerateEnvironmentRequest):
    """Generate environment concept art via Runware."""
    from pipeline.shared.services.runware_service import get_runware_service

    try:
        service = get_runware_service()
        images = await service.generate_environment(
            name=req.name,
            description=req.description,
            style_prompt=req.style_prompt,
        )

        artifact = save_generation_artifact(
            stage=2,
            artifact_type="environment_spec",
            content={
                "name": req.name,
                "description": req.description,
                "style_prompt": req.style_prompt,
                "images": images,
            },
        )
        return JSONResponse({"ok": True, "artifact": artifact, "images": images})

    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.post("/api/generate/shot")
async def generate_shot(req: GenerateShotRequest):
    """Generate a cinematic shot frame via Runware."""
    from pipeline.shared.services.runware_service import get_runware_service

    try:
        service = get_runware_service()
        images = await service.generate_shot(
            description=req.description,
            style_prompt=req.style_prompt,
            width=req.width,
            height=req.height,
        )

        artifact = save_generation_artifact(
            stage=3,
            artifact_type="shot_image",
            content={
                "description": req.description,
                "style_prompt": req.style_prompt,
                "dimensions": f"{req.width}x{req.height}",
                "images": images,
            },
        )
        return JSONResponse({"ok": True, "artifact": artifact, "images": images})

    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.post("/api/generate/upscale")
async def upscale_image(req: UpscaleRequest):
    """Upscale an image via Runware."""
    from pipeline.shared.services.runware_service import get_runware_service

    try:
        service = get_runware_service()
        result = await service.upscale_image(
            image_url=req.image_url,
            upscale_factor=req.upscale_factor,
        )
        return JSONResponse({"ok": True, "result": result})

    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
