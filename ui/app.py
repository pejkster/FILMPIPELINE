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


# ── Council: expert detail ───────────────────────────────────

@app.get("/api/council/expert/{expert_id}")
async def get_expert_detail(expert_id: str):
    """Get full details for an expert including their prompt."""
    config = load_stage_config(1)
    for phase in config["phases"]:
        for expert in phase["experts"]:
            if expert["id"] == expert_id:
                prompt_path = PIPELINE_ROOT / "01_llm_council" / expert["prompt_file"]
                prompt_content = prompt_path.read_text() if prompt_path.exists() else ""

                # Find any existing output for this expert
                artifacts = load_stage_artifacts(1)
                expert_output = None
                for a in artifacts:
                    for eo in a.get("content", {}).get("expert_outputs", []):
                        if eo.get("expert_id") == expert_id:
                            expert_output = eo

                return JSONResponse({
                    "id": expert["id"],
                    "role": expert["role"],
                    "phase_id": phase["id"],
                    "phase_name": phase["name"],
                    "prompt_file": expert["prompt_file"],
                    "prompt": prompt_content,
                    "receives": expert.get("receives", []),
                    "output": expert_output,
                })

    return JSONResponse({"error": "Expert not found"}, status_code=404)


# ── Council: phases ──────────────────────────────────────────

@app.get("/api/council/phases")
async def get_council_phases():
    config = load_stage_config(1)
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


# ── Council: run with SSE streaming ──────────────────────────

class RunCouncilRequest(BaseModel):
    phase_id: str | None = None


@app.post("/api/council/run")
async def run_council_start(req: RunCouncilRequest):
    """Start a council run as a background job. Returns a job_id for SSE polling."""
    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "status": "starting",
        "phase_id": req.phase_id,
        "logs": [],
        "started_at": datetime.now().isoformat(),
        "experts_total": 0,
        "experts_done": 0,
        "current_expert": None,
        "error": None,
    }

    asyncio.create_task(_run_council_background(job_id, req.phase_id))

    return JSONResponse({"ok": True, "job_id": job_id})


async def _run_council_background(job_id: str, phase_id: str | None):
    """Run council in background, updating job state for SSE consumers."""
    import importlib
    council_mod = importlib.import_module("pipeline.01_llm_council.council")

    job = jobs[job_id]
    try:
        council = council_mod.LLMCouncil()

        phases_to_run = council.phases
        if phase_id:
            phases_to_run = [p for p in council.phases if p.id == phase_id]

        for phase in phases_to_run:
            job["status"] = "running"
            job["experts_total"] = len(phase.experts)
            job["experts_done"] = 0
            _log(job, f"Phase: {phase.name} ({len(phase.experts)} experts)")

            results = []
            if phase.parallel:
                async def run_and_track(expert):
                    job["current_expert"] = expert.role
                    _log(job, f"  Starting: {expert.role}")
                    output = await council.run_expert(expert, phase.id)
                    job["experts_done"] += 1
                    _log(job, f"  Complete: {expert.role} ({len(output.content)} chars)")
                    return output

                tasks = [run_and_track(e) for e in phase.experts]
                results = list(await asyncio.gather(*tasks))
            else:
                for expert in phase.experts:
                    job["current_expert"] = expert.role
                    _log(job, f"  Starting: {expert.role}")
                    output = await council.run_expert(expert, phase.id)
                    results.append(output)
                    job["experts_done"] += 1
                    _log(job, f"  Complete: {expert.role} ({len(output.content)} chars)")

            council.save_phase_artifact(phase, results)
            _log(job, f"Phase complete: {phase.name}")

            if phase.checkpoint:
                _log(job, f"CHECKPOINT — {phase.name} requires review")
                break

        job["status"] = "complete"
        job["current_expert"] = None
        _log(job, "Done")

    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)
        _log(job, f"ERROR: {e}")


def _log(job: dict, msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    job["logs"].append({"time": ts, "message": msg})


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
                        "status": job["status"],
                        "experts_done": job["experts_done"],
                        "experts_total": job["experts_total"],
                        "current_expert": job["current_expert"],
                    })
                    yield f"data: {data}\n\n"
                last_log_count = len(current_logs)

            if job["status"] in ("complete", "error"):
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
