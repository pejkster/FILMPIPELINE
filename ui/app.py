"""Research Studio API — LLM council, feedback loops, context guardian, and synthesis."""

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

app = FastAPI(title="Metanoia Research Studio")
app.mount("/static", StaticFiles(directory=UI_DIR / "static"), name="static")
templates = Jinja2Templates(directory=UI_DIR / "templates")


@app.on_event("startup")
async def resume_interrupted_jobs():
    saved = _load_job_state()
    if not saved:
        return
    job_id = saved["job_id"]
    phase_id = saved.get("phase_id")
    stage = saved.get("stage", 1)
    context_text = saved.get("context_text", "")
    experts_done = saved.get("experts_done", [])

    print(f"[RESUME] Resuming job {job_id}: phase={phase_id}, stage={stage}, {len(experts_done)} experts already done — waiting 15s for old connections to clear")
    await asyncio.sleep(15)

    jobs[job_id] = {
        "status": "starting", "phase_id": phase_id, "stage": stage,
        "logs": [], "started_at": datetime.now().isoformat(),
        "experts_total": 0, "experts_done": 0, "current_expert": None,
        "running_experts": [], "error": None,
    }
    _log(jobs[job_id], f"Resuming after server restart ({len(experts_done)} experts already done)", level="phase")
    task = asyncio.create_task(
        _run_council_background(job_id, phase_id, stage, context_text, skip_experts=experts_done)
    )
    jobs[job_id]["_task"] = task

STAGE_DIRS = {
    1: "01_llm_council",
    2: "02_worldbuilding",
}

# ── Background job tracking ──────────────────────────────────

jobs: dict[str, dict] = {}
feedback_loops: dict[str, dict] = {}

JOBS_PATH = Path(__file__).parent / ".active_jobs.json"


def _save_job_state(job_id: str, phase_id: str | None, stage: int, context_text: str, experts_done: list[str]):
    data = {"job_id": job_id, "phase_id": phase_id, "stage": stage,
            "context_text": context_text, "experts_done": experts_done}
    JOBS_PATH.write_text(json.dumps(data))


def _clear_job_state():
    if JOBS_PATH.exists():
        JOBS_PATH.unlink()


def _load_job_state() -> dict | None:
    if JOBS_PATH.exists():
        try:
            return json.loads(JOBS_PATH.read_text())
        except Exception:
            JOBS_PATH.unlink()
    return None

# ── Curated outputs store (in-memory + file-backed) ─────────

CURATED_PATH = PIPELINE_ROOT / "02_worldbuilding" / "outputs" / "_curated.json"


def _load_curated() -> list[dict]:
    if CURATED_PATH.exists():
        return json.loads(CURATED_PATH.read_text())
    return []


def _save_curated(outputs: list[dict]):
    CURATED_PATH.parent.mkdir(parents=True, exist_ok=True)
    CURATED_PATH.write_text(json.dumps(outputs, indent=2))


# ── Config helpers ───────────────────────────────────────────

def load_stage_config(stage: int) -> dict:
    config_path = PIPELINE_ROOT / STAGE_DIRS.get(stage, STAGE_DIRS[1]) / "config" / "stage.yaml"
    if not config_path.exists():
        return {}
    with open(config_path) as f:
        return yaml.safe_load(f)


def _stage_dir(stage: int) -> Path:
    return PIPELINE_ROOT / STAGE_DIRS.get(stage, STAGE_DIRS[1])


def _results_dir(stage: int) -> Path:
    return _stage_dir(stage) / "outputs" / "experts"


# ── Page route ───────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse(request, "dashboard.html")


# ── Council: phases ──────────────────────────────────────────

@app.get("/api/council/phases")
async def get_council_phases(stage: int = 1):
    config = load_stage_config(stage)
    phases = []
    for phase in config.get("phases", []):
        mode = phase.get("mode", "sequential" if not phase.get("parallel", False) else "parallel")
        phases.append({
            "id": phase["id"],
            "name": phase["name"],
            "description": phase["description"],
            "mode": mode,
            "context_level": phase.get("context_level", "none"),
            "include_prior_stage_context": phase.get("include_prior_stage_context",
                config.get("include_prior_stage_context", False)),
            "checkpoint": phase.get("checkpoint", False),
            "experts": [
                {"id": e["id"], "role": e["role"], "prompt_file": e.get("prompt_file", "")}
                for e in phase.get("experts", [])
            ],
            "guardians": [
                {"id": g["id"], "role": g["role"], "prompt_file": g.get("prompt_file", "")}
                for g in phase.get("guardians", [])
            ],
            "status": "idle",
        })
    return JSONResponse({"phases": phases})


# ── Council: expert detail ───────────────────────────────────

@app.get("/api/council/expert/{expert_id}")
async def get_expert_detail(expert_id: str):
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
                        "prompt": prompt_content,
                        "stage": stage_num,
                    })
    return JSONResponse({"error": "Expert not found"}, status_code=404)


# ── Council: expert results ──────────────────────────────────

@app.get("/api/council/results")
async def get_council_results(stage: int = 1):
    results = []
    rdir = _results_dir(stage)
    if rdir.exists():
        for path in sorted(rdir.glob("*.json")):
            if path.name.startswith("_"):
                continue
            try:
                data = json.loads(path.read_text())
                if "role" in data and "content" in data:
                    results.append(data)
            except (json.JSONDecodeError, KeyError):
                continue
    return JSONResponse({"results": results})


@app.get("/api/council/results/{expert_id}")
async def get_expert_result(expert_id: str):
    for s in [1, 2]:
        path = _results_dir(s) / f"{expert_id}.json"
        if path.exists():
            return JSONResponse(json.loads(path.read_text()))
    return JSONResponse({"error": "No result"}, status_code=404)


@app.delete("/api/council/results/{expert_id}")
async def delete_expert_result(expert_id: str):
    for s in [1, 2]:
        path = _results_dir(s) / f"{expert_id}.json"
        if path.exists():
            path.unlink()
            return JSONResponse({"ok": True})
    return JSONResponse({"error": "Not found"}, status_code=404)


# ── Council: prompt editing ──────────────────────────────────

class SavePromptRequest(BaseModel):
    content: str


@app.put("/api/council/expert/{expert_id}/prompt")
async def save_expert_prompt(expert_id: str, req: SavePromptRequest):
    for stage_num in [1, 2]:
        config = load_stage_config(stage_num)
        for phase in config.get("phases", []):
            for expert in phase.get("experts", []):
                if expert["id"] == expert_id:
                    prompt_path = _stage_dir(stage_num) / expert["prompt_file"]
                    if not prompt_path.exists():
                        prompt_path = PIPELINE_ROOT / "01_llm_council" / expert["prompt_file"]
                    prompt_path.write_text(req.content)
                    return JSONResponse({"ok": True})
    return JSONResponse({"error": "Expert not found"}, status_code=404)


# ── Council: phase mode + context ────────────────────────────

class SetPhaseModeRequest(BaseModel):
    mode: str


class SetContextLevelRequest(BaseModel):
    context_level: str


@app.put("/api/council/phase/{phase_id}/mode")
async def set_phase_mode(phase_id: str, req: SetPhaseModeRequest, stage: int = 1):
    if req.mode not in ("parallel", "sequential"):
        return JSONResponse({"error": "Invalid mode"}, status_code=400)
    config_path = _stage_dir(stage) / "config" / "stage.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)
    for phase in config.get("phases", []):
        if phase["id"] == phase_id:
            phase["mode"] = req.mode
            phase.pop("parallel", None)
            with open(config_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False, sort_keys=False)
            return JSONResponse({"ok": True})
    return JSONResponse({"error": "Phase not found"}, status_code=404)


@app.put("/api/council/phase/{phase_id}/context-level")
async def set_phase_context_level(phase_id: str, req: SetContextLevelRequest, stage: int = 1):
    valid = ["none", "basic", "futurax", "disordine"]
    if req.context_level not in valid:
        return JSONResponse({"error": f"Must be one of: {valid}"}, status_code=400)
    config_path = _stage_dir(stage) / "config" / "stage.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)
    for phase in config.get("phases", []):
        if phase["id"] == phase_id:
            phase["context_level"] = req.context_level
            with open(config_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False, sort_keys=False)
            return JSONResponse({"ok": True})
    return JSONResponse({"error": "Phase not found"}, status_code=404)


class AssignExpertRequest(BaseModel):
    expert_id: str
    role: str = ""
    prompt_file: str = ""

@app.post("/api/council/phase/{phase_id}/experts")
async def add_expert_to_phase(phase_id: str, req: AssignExpertRequest, stage: int = 1):
    config_path = _stage_dir(stage) / "config" / "stage.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)
    for phase in config.get("phases", []):
        if phase["id"] == phase_id:
            if any(e["id"] == req.expert_id for e in phase["experts"]):
                return JSONResponse({"error": "Already assigned"}, status_code=400)
            phase["experts"].append({"id": req.expert_id, "role": req.role, "prompt_file": req.prompt_file})
            with open(config_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False, sort_keys=False)
            return JSONResponse({"ok": True})
    return JSONResponse({"error": "Phase not found"}, status_code=404)

@app.delete("/api/council/phase/{phase_id}/experts/{expert_id}")
async def remove_expert_from_phase(phase_id: str, expert_id: str, stage: int = 1):
    config_path = _stage_dir(stage) / "config" / "stage.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)
    for phase in config.get("phases", []):
        if phase["id"] == phase_id:
            phase["experts"] = [e for e in phase["experts"] if e["id"] != expert_id]
            with open(config_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False, sort_keys=False)
            return JSONResponse({"ok": True})
    return JSONResponse({"error": "Phase not found"}, status_code=404)


@app.post("/api/council/phase/{phase_id}/guardians")
async def add_guardian_to_phase(phase_id: str, req: AssignExpertRequest, stage: int = 1):
    config_path = _stage_dir(stage) / "config" / "stage.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)
    for phase in config.get("phases", []):
        if phase["id"] == phase_id:
            guardians = phase.setdefault("guardians", [])
            if any(g["id"] == req.expert_id for g in guardians):
                return JSONResponse({"error": "Already assigned"}, status_code=400)
            guardians.append({"id": req.expert_id, "role": req.role, "prompt_file": req.prompt_file})
            with open(config_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False, sort_keys=False)
            return JSONResponse({"ok": True})
    return JSONResponse({"error": "Phase not found"}, status_code=404)

@app.delete("/api/council/phase/{phase_id}/guardians/{guardian_id}")
async def remove_guardian_from_phase(phase_id: str, guardian_id: str, stage: int = 1):
    config_path = _stage_dir(stage) / "config" / "stage.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)
    for phase in config.get("phases", []):
        if phase["id"] == phase_id:
            phase["guardians"] = [g for g in phase.get("guardians", []) if g["id"] != guardian_id]
            with open(config_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False, sort_keys=False)
            return JSONResponse({"ok": True})
    return JSONResponse({"error": "Phase not found"}, status_code=404)


# ── Council: expert registry ─────────────────────────────────

@app.get("/api/council/experts/registry")
async def get_expert_registry():
    prompts_dir = PIPELINE_ROOT / "01_llm_council" / "prompts" / "experts"
    if not prompts_dir.exists():
        return JSONResponse({"experts": []})

    assigned_phases = {}
    guardian_phases = {}
    for stage_num in [1, 2]:
        config = load_stage_config(stage_num)
        for phase in config.get("phases", []):
            for e in phase.get("experts", []):
                pf = e.get("prompt_file", "")
                if pf not in assigned_phases:
                    assigned_phases[pf] = []
                assigned_phases[pf].append(phase["id"])
            for g in phase.get("guardians", []):
                pf = g.get("prompt_file", "")
                if pf not in guardian_phases:
                    guardian_phases[pf] = []
                guardian_phases[pf].append(phase["id"])

    experts = []
    for path in sorted(prompts_dir.glob("*.md")):
        expert_id = path.stem
        content = path.read_text()
        lines = content.strip().split("\n")
        first_line = lines[0].replace("# ", "").strip()
        desc = ""
        for line in lines[1:]:
            line = line.strip()
            if line and not line.startswith("#"):
                desc = line[:120]
                break
        prompt_file = f"prompts/experts/{path.name}"
        is_guardian = "guardian" in expert_id.lower() or "guardian" in first_line.lower() or expert_id == "ndrmn_futurist"
        experts.append({
            "id": expert_id,
            "role": first_line,
            "description": desc,
            "prompt_file": prompt_file,
            "assigned_phases": assigned_phases.get(prompt_file, []) + guardian_phases.get(prompt_file, []),
            "is_guardian": is_guardian,
        })
    return JSONResponse({"experts": experts})


CREATE_EXPERT_SYSTEM_PROMPT = """You are an expert prompt engineer for an AI film production pipeline. You receive a description of a domain expert and generate a structured system prompt for them.

Follow this exact format — write in second person ("You are..."), be specific and evocative about their expertise, and structure the output clearly:

```
# [Expert Title]

[1-2 paragraphs establishing who they are, their expertise, their perspective.]

## Your Task

[1 paragraph describing what they need to produce.]

## What to Produce

[Structured template with labeled sections for their output. Use markdown headers (##) for each section. Typically 6-10 sections.]
```

Output ONLY the expert prompt content."""


@app.post("/api/council/experts/create")
async def create_expert(req: dict):
    import importlib
    import re
    council_mod = importlib.import_module("pipeline.01_llm_council.council")

    name = req.get("name", "")
    description = req.get("description", "")
    goals = req.get("goals", "")

    expert_id = re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')
    prompt_path = PIPELINE_ROOT / "01_llm_council" / "prompts" / "experts" / f"{expert_id}.md"

    if prompt_path.exists():
        return JSONResponse({"error": f"Expert '{expert_id}' already exists"}, status_code=409)

    user_message = f"Create an expert prompt for:\n\n**Name:** {name}\n**Description:** {description}\n**Goals:** {goals}"

    council = council_mod.LLMCouncil()
    try:
        content = await council._call_llm(CREATE_EXPERT_SYSTEM_PROMPT, user_message)
        prompt_path.write_text(content)
        first_line = content.strip().split("\n")[0].replace("# ", "").strip()
        return JSONResponse({
            "ok": True,
            "expert": {"id": expert_id, "role": first_line, "prompt_file": f"prompts/experts/{expert_id}.md"},
        })
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ── Council: run with SSE ────────────────────────────────────

class RunCouncilRequest(BaseModel):
    phase_id: str | None = None
    stage: int = 1
    run_mode: str = "phase"
    feedback_rounds: int = 3
    context_text: str = ""


@app.post("/api/council/run")
async def run_council_start(req: RunCouncilRequest):
    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "status": "starting", "phase_id": req.phase_id, "stage": req.stage,
        "logs": [], "started_at": datetime.now().isoformat(),
        "experts_total": 0, "experts_done": 0, "current_expert": None,
        "running_experts": [], "error": None,
    }
    task = asyncio.create_task(_run_council_background(job_id, req.phase_id, req.stage, req.context_text))
    jobs[job_id]["_task"] = task
    return JSONResponse({"ok": True, "job_id": job_id})


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    if job_id not in jobs:
        return JSONResponse({"error": "Job not found"}, status_code=404)
    job = jobs[job_id]
    if job["status"] not in ("starting", "running"):
        return JSONResponse({"error": "Job not running"}, status_code=400)
    job["cancelled"] = True
    task = job.get("_task")
    if task and not task.done():
        task.cancel()
    job["status"] = "cancelled"
    job["running_experts"] = []
    _log(job, "Cancelled by user", level="error")
    return JSONResponse({"ok": True})


def _save_expert_result(expert_id: str, role: str, phase_id: str, content: str, stage: int = 1):
    output_dir = _results_dir(stage)
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{expert_id}.json"
    data = {
        "expert_id": expert_id, "role": role, "phase_id": phase_id,
        "content": content, "timestamp": datetime.now().isoformat(),
    }
    path.write_text(json.dumps(data, indent=2))


SUMMARY_SYSTEM_PROMPT = """You are a concise summarizer. Produce a clear summary with:
- A one-sentence executive takeaway
- 4-6 key points as bullet points — each specific and complete (1-2 sentences max)

Write in plain text with markdown bullet points. No headers needed."""


async def _summarize_expert_output(expert_id: str):
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
    try:
        summary = await _summarize_expert_output(expert_id)
        if summary is None:
            return JSONResponse({"error": "No result to summarize"}, status_code=404)
        return JSONResponse({"ok": True, "summary": summary})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


async def _run_council_background(job_id: str, phase_id: str | None, stage: int = 1, context_text: str = "", skip_experts: list[str] | None = None):
    import importlib
    council_mod = importlib.import_module("pipeline.01_llm_council.council")

    skip = set(skip_experts or [])
    done_ids: list[str] = list(skip)
    job = jobs[job_id]

    try:
        council = council_mod.LLMCouncil(stage=stage)
        council._load_prior_outputs()

        phases_to_run = council.phases
        if phase_id:
            phases_to_run = [p for p in council.phases if p.id == phase_id]

        for phase in phases_to_run:
            job["status"] = "running"
            all_members = list(phase.experts)
            # Load guardians from config (not in council dataclass)
            cfg = load_stage_config(stage)
            for pc in cfg.get("phases", []):
                if pc["id"] == phase.id:
                    for g in pc.get("guardians", []):
                        gconf = council_mod.ExpertConfig(id=g["id"], role=g["role"], prompt_file=g["prompt_file"])
                        if not any(m.id == g["id"] for m in all_members):
                            all_members.append(gconf)
                    break
            remaining = [e for e in all_members if e.id not in skip]
            job["experts_total"] = len(all_members)
            job["experts_done"] = len(all_members) - len(remaining)
            job["phase_name"] = phase.name
            job["phase_id"] = phase.id

            ctx_label = "custom" if context_text else "basic"
            _log(job, f"Phase: {phase.name} ({len(remaining)} remaining of {len(all_members)} experts+guardians, context: {ctx_label})", level="phase")

            _save_job_state(job_id, phase_id, stage, context_text, done_ids)

            for idx, expert in enumerate(remaining):
                if job.get("cancelled"):
                    raise asyncio.CancelledError()
                job["running_experts"] = [expert.id]
                job["current_expert"] = expert.role
                _log(job, f"[{job['experts_done']+1}/{len(all_members)}] Starting: {expert.role}", level="start", expert=expert.id)
                output = None
                for attempt in range(5):
                    try:
                        output = await council.run_expert(expert, phase, context_text=context_text, context_level="basic" if not context_text else "none")
                        break
                    except Exception as e:
                        if "concurrentRequestLimitExceeded" in str(e) and attempt < 4:
                            wait = 15 * (attempt + 1)
                            _log(job, f"Rate limited, retrying {expert.role} in {wait}s...", level="info")
                            await asyncio.sleep(wait)
                        else:
                            raise
                if output is None:
                    raise RuntimeError(f"Failed to get output for {expert.role}")
                job["running_experts"] = []
                job["experts_done"] += 1
                done_ids.append(expert.id)
                _save_expert_result(expert.id, expert.role, phase.id, output.content, stage=stage)
                _log(job, f"Complete: {expert.role} ({len(output.content)} chars)", level="done", expert=expert.id)
                _save_job_state(job_id, phase_id, stage, context_text, done_ids)
                # Auto-summarize immediately after each expert
                _log(job, f"Summarizing {expert.role}...", level="info")
                try:
                    await _summarize_expert_output(expert.id)
                    _log(job, f"Summary ready: {expert.role}", level="done", expert=expert.id)
                except Exception:
                    _log(job, f"Summary failed for {expert.role}", level="info")

            if phase.checkpoint and not phase_id:
                _log(job, f"CHECKPOINT — {phase.name} requires review", level="checkpoint")
                break

        job["status"] = "complete"
        job["current_expert"] = None
        _log(job, "All done", level="done")
        _clear_job_state()

    except asyncio.CancelledError:
        job["status"] = "cancelled"
        job["running_experts"] = []
        job["current_expert"] = None
        _log(job, "Cancelled", level="error")
        _clear_job_state()
    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)
        import traceback
        _log(job, f"ERROR: {e}", level="error")
        _log(job, traceback.format_exc(), level="error")
        _clear_job_state()


def _log(job: dict, msg: str, level: str = "info", expert: str | None = None):
    ts = datetime.now().strftime("%H:%M:%S")
    job["logs"].append({"time": ts, "message": msg, "level": level, "expert": expert})


@app.get("/api/jobs/active")
async def get_active_jobs():
    active = []
    for job_id, job in jobs.items():
        if job["status"] in ("starting", "running"):
            active.append({
                "job_id": job_id, "status": job["status"],
                "phase_id": job.get("phase_id"), "phase_name": job.get("phase_name"),
                "experts_done": job.get("experts_done", 0),
                "experts_total": job.get("experts_total", 0),
                "running_experts": job.get("running_experts", []),
                "current_expert": job.get("current_expert"),
            })
    return JSONResponse({"jobs": active})


@app.get("/api/jobs/{job_id}/stream")
async def stream_job(job_id: str, from_log: int = 0):
    if job_id not in jobs:
        return JSONResponse({"error": "Job not found"}, status_code=404)

    async def event_generator():
        last_log_count = from_log
        while True:
            job = jobs.get(job_id)
            if not job:
                break
            current_logs = job["logs"]
            if len(current_logs) > last_log_count:
                for log in current_logs[last_log_count:]:
                    data = json.dumps({
                        "type": "log", "time": log["time"], "message": log["message"],
                        "level": log.get("level", "info"), "expert": log.get("expert"),
                        "status": job["status"],
                        "experts_done": job["experts_done"], "experts_total": job["experts_total"],
                        "current_expert": job["current_expert"],
                        "running_experts": job.get("running_experts", []),
                        "phase_name": job.get("phase_name"),
                    })
                    yield f"data: {data}\n\n"
                last_log_count = len(current_logs)
            if job["status"] in ("complete", "error", "cancelled"):
                yield f"data: {json.dumps({'type': 'done', 'status': job['status'], 'error': job.get('error')})}\n\n"
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(event_generator(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Feedback Loop ────────────────────────────────────────────

class StartFeedbackLoopRequest(BaseModel):
    max_rounds: int = 3


@app.post("/api/council/expert/{expert_id}/feedback-loop")
async def start_feedback_loop(expert_id: str, req: StartFeedbackLoopRequest):
    result_path = None
    for s in [1, 2]:
        p = _results_dir(s) / f"{expert_id}.json"
        if p.exists():
            result_path = p
            break
    if not result_path:
        return JSONResponse({"error": "No output to run feedback on"}, status_code=404)

    data = json.loads(result_path.read_text())
    loop_id = str(uuid.uuid4())[:8]
    feedback_loops[loop_id] = {
        "status": "running", "expert_id": expert_id,
        "expert_role": data["role"], "events": [], "result": None, "error": None,
    }

    async def _run():
        from pipeline.shared.services.feedback_loop import run_feedback_loop
        loop = feedback_loops[loop_id]
        try:
            def on_event(evt):
                loop["events"].append(evt)
            result = await run_feedback_loop(
                expert_output=data["content"], expert_role=data["role"],
                max_rounds=req.max_rounds, on_event=on_event,
            )
            loop["result"] = result
            loop["status"] = "complete"
            loop_path = result_path.parent / f"{expert_id}_feedback_loop.json"
            loop_path.write_text(json.dumps(result, indent=2, default=str))
        except Exception as e:
            loop["status"] = "error"
            loop["error"] = str(e)
            import traceback
            traceback.print_exc()

    asyncio.create_task(_run())
    return JSONResponse({"ok": True, "loop_id": loop_id})


@app.get("/api/council/expert/{expert_id}/feedback-loop")
async def get_feedback_loop_result(expert_id: str):
    for s in [1, 2]:
        path = _results_dir(s) / f"{expert_id}_feedback_loop.json"
        if path.exists():
            return JSONResponse({"ok": True, "result": json.loads(path.read_text())})
    return JSONResponse({"ok": True, "result": None})


@app.get("/api/feedback-loops/{loop_id}/stream")
async def stream_feedback_loop(loop_id: str):
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
                        "type": "log", "time": evt.get("time", ""),
                        "message": evt.get("message", ""), "level": evt.get("level", "info"),
                        "status": loop["status"],
                    })
                    yield f"data: {data}\n\n"
                last_event_count = len(events)
            if loop["status"] in ("complete", "error"):
                yield f"data: {json.dumps({'type': 'done', 'status': loop['status'], 'error': loop.get('error')})}\n\n"
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(event_generator(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Context Guardian ─────────────────────────────────────────

CONTEXT_GUARDIAN_PROMPT = """You are the Context Guardian for the Metanoia film project. Evaluate the expert output against the provided reference context.

Return ONLY valid JSON in this exact format:

```json
{{
  "context_name": "{context_name}",
  "score": 7,
  "strengths": [
    {{"id": "s1", "text": "Specific strength description citing concrete elements"}},
    {{"id": "s2", "text": "Another strength"}}
  ],
  "concerns": [
    {{"id": "c1", "text": "Specific concern — what conflicts or diverges from the reference"}},
    {{"id": "c2", "text": "Another concern"}}
  ],
  "suggestions": [
    {{"id": "sg1", "text": "Specific actionable change that would improve alignment"}},
    {{"id": "sg2", "text": "Another suggestion"}}
  ],
  "missing_elements": [
    {{"id": "m1", "text": "Key aspect from the reference that the output should address"}},
    {{"id": "m2", "text": "Another missing element"}}
  ]
}}
```

Be specific and cite concrete elements from both the output and the reference. Score 1-10 where 10 is perfect alignment. Aim for 3-6 items per section."""


@app.get("/api/council/contexts")
async def list_available_contexts():
    """List available context documents."""
    context_dir = PIPELINE_ROOT / "01_llm_council" / "prompts" / "context"
    contexts = []
    if context_dir.exists():
        for path in sorted(context_dir.glob("*.md")):
            if path.stem == "none":
                continue
            content = path.read_text()
            contexts.append({
                "id": path.stem,
                "name": path.stem.replace("_", " ").title(),
                "content": content,
                "size": len(content),
            })
    # Also list custom contexts
    custom_dir = PIPELINE_ROOT / "01_llm_council" / "prompts" / "context" / "custom"
    if custom_dir.exists():
        for path in sorted(custom_dir.glob("*.md")):
            content = path.read_text()
            contexts.append({
                "id": f"custom/{path.stem}",
                "name": f"Custom: {path.stem.replace('_', ' ').title()}",
                "content": content,
                "size": len(content),
                "custom": True,
            })
    return JSONResponse({"contexts": contexts})


class SaveCustomContextRequest(BaseModel):
    name: str
    content: str


@app.post("/api/council/contexts/custom")
async def save_custom_context(req: SaveCustomContextRequest):
    """Save a custom context document."""
    import re
    slug = re.sub(r'[^a-z0-9]+', '_', req.name.lower()).strip('_')
    custom_dir = PIPELINE_ROOT / "01_llm_council" / "prompts" / "context" / "custom"
    custom_dir.mkdir(parents=True, exist_ok=True)
    path = custom_dir / f"{slug}.md"
    path.write_text(f"# {req.name}\n\n{req.content}")
    return JSONResponse({"ok": True, "id": f"custom/{slug}", "name": req.name})


class RunGuardianRequest(BaseModel):
    contexts: list[str] = ["disordine", "futurax"]
    custom_text: str = ""


@app.post("/api/council/expert/{expert_id}/context-guardian")
async def run_context_guardian(expert_id: str, req: RunGuardianRequest):
    result_path = None
    for s in [1, 2]:
        p = _results_dir(s) / f"{expert_id}.json"
        if p.exists():
            result_path = p
            break
    if not result_path:
        return JSONResponse({"error": "No output to check"}, status_code=404)

    data = json.loads(result_path.read_text())

    import importlib
    import re
    council_mod = importlib.import_module("pipeline.01_llm_council.council")
    council = council_mod.LLMCouncil()

    sections = []

    for ctx_id in req.contexts:
        # Load context file
        if ctx_id.startswith("custom/"):
            ctx_path = PIPELINE_ROOT / "01_llm_council" / "prompts" / "context" / "custom" / f"{ctx_id.split('/')[-1]}.md"
        else:
            ctx_path = PIPELINE_ROOT / "01_llm_council" / "prompts" / "context" / f"{ctx_id}.md"

        if not ctx_path.exists():
            continue

        ctx_content = ctx_path.read_text()
        ctx_name = ctx_id.replace("_", " ").replace("custom/", "").title()

        try:
            prompt = CONTEXT_GUARDIAN_PROMPT.format(context_name=ctx_name)
            user_message = f"""## Reference Context: {ctx_name}

{ctx_content}

---

## Expert Output to Evaluate

**Expert:** {data['role']}

{data['content']}

---

Evaluate this expert output against the reference context above. Return structured JSON."""

            response = await council._call_llm(prompt, user_message)
            text = response.strip()
            match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
            if match:
                text = match.group(1)
            section = json.loads(text)
            section["context_name"] = ctx_name
            section["context_id"] = ctx_id
            sections.append(section)
        except Exception as e:
            sections.append({
                "context_name": ctx_name, "context_id": ctx_id,
                "score": 0, "error": str(e),
                "strengths": [], "concerns": [], "suggestions": [], "missing_elements": [],
            })

    # Handle custom text as an additional context
    if req.custom_text.strip():
        ctx_name = "Custom Context"
        try:
            prompt = CONTEXT_GUARDIAN_PROMPT.format(context_name=ctx_name)
            user_message = f"""## Reference Context: {ctx_name}

{req.custom_text}

---

## Expert Output to Evaluate

**Expert:** {data['role']}

{data['content']}

---

Evaluate this expert output against the reference context above. Return structured JSON."""

            response = await council._call_llm(prompt, user_message)
            text = response.strip()
            match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
            if match:
                text = match.group(1)
            section = json.loads(text)
            section["context_name"] = ctx_name
            section["context_id"] = "custom_inline"
            sections.append(section)
        except Exception as e:
            sections.append({
                "context_name": ctx_name, "context_id": "custom_inline",
                "score": 0, "error": str(e),
                "strengths": [], "concerns": [], "suggestions": [], "missing_elements": [],
            })

    result = {
        "expert_id": expert_id,
        "expert_role": data["role"],
        "sections": sections,
        "timestamp": datetime.now().isoformat(),
    }

    guardian_path = result_path.parent / f"{expert_id}_guardian.json"
    guardian_path.write_text(json.dumps(result, indent=2))

    return JSONResponse({"ok": True, "result": result})


@app.get("/api/council/expert/{expert_id}/context-guardian")
async def get_guardian_result(expert_id: str):
    for s in [1, 2]:
        path = _results_dir(s) / f"{expert_id}_guardian.json"
        if path.exists():
            return JSONResponse({"ok": True, "result": json.loads(path.read_text())})
    return JSONResponse({"ok": True, "result": None})


# ── Expert Revision ──────────────────────────────────────────

REVISION_SYSTEM_PROMPT = """You are the same expert who produced the original output below. You are now receiving curated feedback from peer review and context analysis.

Your task: Revise your original output to incorporate the selected feedback. Apply each piece of feedback thoughtfully — don't just append it, weave it naturally into your revised work.

Maintain the same format, depth, and voice as your original output. The revision should read as a complete, polished piece — not a patched version.

If a feedback item contradicts your expertise, you may note why you disagree, but still consider if there's a partial truth worth incorporating."""


class ReviseExpertRequest(BaseModel):
    feedback_items: list[dict]  # [{id, text, source}]


@app.post("/api/council/expert/{expert_id}/revise")
async def revise_expert(expert_id: str, req: ReviseExpertRequest):
    """Revise an expert's output by sending selected feedback items back to the LLM."""
    result_path = None
    stage = 1
    for s in [1, 2]:
        p = _results_dir(s) / f"{expert_id}.json"
        if p.exists():
            result_path = p
            stage = s
            break
    if not result_path:
        return JSONResponse({"error": "No output to revise"}, status_code=404)

    data = json.loads(result_path.read_text())

    # Load the expert's original system prompt
    expert_prompt = ""
    for stage_num in [1, 2]:
        config = load_stage_config(stage_num)
        for phase in config.get("phases", []):
            for expert in phase.get("experts", []):
                if expert["id"] == expert_id:
                    prompt_path = _stage_dir(stage_num) / expert.get("prompt_file", "")
                    if not prompt_path.exists():
                        prompt_path = PIPELINE_ROOT / "01_llm_council" / expert.get("prompt_file", "")
                    if prompt_path.exists():
                        expert_prompt = prompt_path.read_text()
                    break

    feedback_block = "\n\n".join(
        f"**[{item.get('source', 'Feedback')}]** {item['text']}"
        for item in req.feedback_items
    )

    import importlib
    council_mod = importlib.import_module("pipeline.01_llm_council.council")
    council = council_mod.LLMCouncil(stage=stage)

    system = expert_prompt + "\n\n---\n\n" + REVISION_SYSTEM_PROMPT if expert_prompt else REVISION_SYSTEM_PROMPT

    user_message = f"""## Your Original Output

{data['content']}

---

## Selected Feedback to Incorporate ({len(req.feedback_items)} items)

{feedback_block}

---

Now produce your revised output. Apply the feedback thoughtfully. Output the complete revised version."""

    try:
        revised = await council._call_llm(system, user_message)

        # Save revision history
        revisions = data.get("revisions", [])
        revisions.append({
            "previous_content": data["content"],
            "feedback_items": req.feedback_items,
            "timestamp": datetime.now().isoformat(),
        })

        data["content"] = revised
        data["revisions"] = revisions
        data["revised_at"] = datetime.now().isoformat()
        data["revision_count"] = len(revisions)
        # Clear old summary since content changed
        data.pop("summary", None)
        data.pop("summary_timestamp", None)

        result_path.write_text(json.dumps(data, indent=2))

        # Auto-summarize the revised output
        try:
            await _summarize_expert_output(expert_id)
        except Exception:
            pass

        return JSONResponse({"ok": True, "content": revised, "revision_count": len(revisions)})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ── Curated Outputs Collection ───────────────────────────────

@app.get("/api/curated")
async def get_curated():
    return JSONResponse({"outputs": _load_curated()})


class CurateRequest(BaseModel):
    expert_id: str
    role: str
    content: str
    phase_id: str = ""


@app.post("/api/curated")
async def add_curated(req: CurateRequest):
    outputs = _load_curated()
    if any(o["expert_id"] == req.expert_id for o in outputs):
        return JSONResponse({"error": "Already curated"}, status_code=409)
    outputs.append({
        "expert_id": req.expert_id,
        "role": req.role,
        "content": req.content,
        "phase_id": req.phase_id,
        "curated_at": datetime.now().isoformat(),
    })
    _save_curated(outputs)
    return JSONResponse({"ok": True})


@app.delete("/api/curated/{expert_id}")
async def remove_curated(expert_id: str):
    outputs = _load_curated()
    outputs = [o for o in outputs if o["expert_id"] != expert_id]
    _save_curated(outputs)
    return JSONResponse({"ok": True})


@app.post("/api/curated/reset")
async def reset_curated():
    _save_curated([])
    return JSONResponse({"ok": True})


CURATED_SYNTHESIS_PROMPT = """You are a synthesis expert for the Metanoia film project. You receive curated expert outputs that have been reviewed, refined, and approved.

Produce a comprehensive synthesis with:
1. **Unified Vision** — the cohesive narrative and world that emerges from all outputs
2. **Key Takeaways** — the most important cross-cutting insights
3. **Character Summary** — all characters mentioned, with key traits
4. **World Rules** — how this world works, its internal logic
5. **Visual Direction** — aesthetic, color, mood, lighting philosophy
6. **Scene Opportunities** — the most cinematic moments across all outputs
7. **Open Questions** — what still needs resolution

For each section, note which expert(s) the insights come from using [Expert Name] tags.

Be specific and production-ready. This synthesis will be used to generate a Film Brief."""


@app.post("/api/curated/synthesize")
async def synthesize_curated():
    outputs = _load_curated()
    if not outputs:
        return JSONResponse({"error": "No curated outputs"}, status_code=400)

    combined = "\n\n---\n\n".join(
        f"## {o['role']}\n\n{o['content']}" for o in outputs
    )

    import importlib
    council_mod = importlib.import_module("pipeline.01_llm_council.council")
    council = council_mod.LLMCouncil(stage=2)

    try:
        result = await council._call_llm(
            CURATED_SYNTHESIS_PROMPT,
            f"Synthesize these {len(outputs)} curated expert outputs:\n\n{combined}"
        )

        synth_data = {
            "content": result,
            "timestamp": datetime.now().isoformat(),
            "expert_count": len(outputs),
            "experts": [{"expert_id": o["expert_id"], "role": o["role"]} for o in outputs],
        }

        synth_path = _results_dir(2) / "_synthesis.json"
        synth_path.parent.mkdir(parents=True, exist_ok=True)
        synth_path.write_text(json.dumps(synth_data, indent=2))

        return JSONResponse({"ok": True, "synthesis": synth_data})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ── Synthesis ────────────────────────────────────────────────

@app.get("/api/council/synthesis")
async def get_synthesis(stage: int = 1):
    synth_path = _results_dir(stage) / "_synthesis.json"
    if not synth_path.exists():
        return JSONResponse({"synthesis": None})
    return JSONResponse({"synthesis": json.loads(synth_path.read_text())})


@app.post("/api/council/synthesize-phase")
async def synthesize_phase(phase_id: str, stage: int = 1):
    results_dir = _results_dir(stage)
    if not results_dir.exists():
        return JSONResponse({"error": "No results"}, status_code=400)

    config = load_stage_config(stage)
    phase_config = next((p for p in config.get("phases", []) if p["id"] == phase_id), None)
    if not phase_config:
        return JSONResponse({"error": "Phase not found"}, status_code=404)

    expert_ids = {e["id"] for e in phase_config["experts"]}
    expert_texts = []
    for path in sorted(results_dir.glob("*.json")):
        if path.name.startswith("_"):
            continue
        data = json.loads(path.read_text())
        if data.get("expert_id") in expert_ids and "role" in data and "content" in data:
            expert_texts.append(f"## {data['role']}\n\n{data['content'][:3000]}")

    if not expert_texts:
        return JSONResponse({"error": "No results for this phase"}, status_code=400)

    combined = "\n\n---\n\n".join(expert_texts)

    import importlib
    council_mod = importlib.import_module("pipeline.01_llm_council.council")
    council = council_mod.LLMCouncil(stage=stage)
    try:
        result = await council._call_llm(
            f'Synthesize these "{phase_config["name"]}" phase outputs into key findings, common ground, tensions, and actionable outputs.',
            f"Synthesize:\n\n{combined}"
        )
        synth_data = {
            "content": result, "phase_id": phase_id, "phase_name": phase_config["name"],
            "timestamp": datetime.now().isoformat(), "expert_count": len(expert_texts), "stage": stage,
        }
        synth_path = results_dir / f"_synthesis_{phase_id}.json"
        synth_path.write_text(json.dumps(synth_data, indent=2))
        return JSONResponse({"ok": True, "synthesis": synth_data})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ── Film Brief ───────────────────────────────────────────────

FILM_BRIEF_PATH = {
    2: PIPELINE_ROOT / "02_worldbuilding" / "outputs" / "film_brief.json",
}


@app.get("/api/film-brief")
async def get_film_brief(stage: int = 2):
    path = FILM_BRIEF_PATH.get(stage)
    if not path or not path.exists():
        return JSONResponse({"brief": None})
    return JSONResponse({"brief": json.loads(path.read_text())})


FILM_BRIEF_EXTRACTION_PROMPT = """You are extracting a comprehensive Film Production Brief from a synthesis. This brief bridges research and production — everything a director needs.

Return ONLY valid JSON:

```json
{
  "world_summary": "2-3 paragraph summary of this world",
  "narrative_arc": "The trailer's emotional journey in 1 paragraph",
  "characters": [
    {
      "name": "Name", "role": "Role", "description": "3-4 sentences",
      "visual_prompt": "80-120 word visual description for image generation",
      "wardrobe": "Outfit details", "key_moments": "2-3 trailer moments"
    }
  ],
  "environments": [
    {
      "name": "Name", "function": "What happens here", "description": "3-4 sentences",
      "visual_prompt": "80-120 word scene description",
      "lighting": "Lighting details", "atmosphere": "Sensory experience"
    }
  ],
  "scenes": [
    {
      "id": 1, "title": "Scene title", "description": "What happens",
      "location": "Environment name", "characters": ["Names"],
      "time_of_day": "Time", "duration_estimate": "seconds",
      "camera_notes": "Specific camera directions",
      "visual_prompt": "Key frame description", "audio_notes": "Sound design"
    }
  ],
  "art_direction": {
    "visual_identity": "2-3 paragraphs on visual language",
    "color_strategy": "How color evolves",
    "palette": [{"name": "color", "hex": "#hex", "usage": "where used"}],
    "materials_and_textures": "Tactile language"
  },
  "cinematography": {
    "camera_philosophy": "How the camera behaves",
    "lens_choices": "Focal lengths and why",
    "movement_language": "Camera movement style",
    "lighting_philosophy": "How light works",
    "reference_films": "2-4 visual touchstones"
  },
  "production_notes": "Additional production guidance"
}
```

Be extremely specific with visual prompts. Extract ALL characters and environments."""


@app.post("/api/film-brief/extract")
async def extract_film_brief_endpoint(stage: int = 2):
    synth_path = _results_dir(stage) / "_synthesis.json"
    if not synth_path.exists():
        return JSONResponse({"error": "No synthesis found"}, status_code=400)

    synth = json.loads(synth_path.read_text())
    import importlib
    import re
    council_mod = importlib.import_module("pipeline.01_llm_council.council")
    council = council_mod.LLMCouncil(stage=stage)
    try:
        result = await council._call_llm(
            FILM_BRIEF_EXTRACTION_PROMPT,
            f"Extract a Film Brief from:\n\n{synth['content']}"
        )
        text = result.strip()
        match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
        if match:
            text = match.group(1)
        brief = json.loads(text)
        brief["version"] = 1
        brief["created_at"] = datetime.now().isoformat()

        path = FILM_BRIEF_PATH.get(stage)
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(brief, indent=2))

        return JSONResponse({"ok": True, "brief": brief})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ── Stage reset ──────────────────────────────────────────────

@app.post("/api/stages/{stage}/reset")
async def reset_stage(stage: int):
    output_dir = _stage_dir(stage) / "outputs"
    if not output_dir.exists():
        return JSONResponse({"ok": True, "cleared": 0})
    cleared = 0
    for path in output_dir.rglob("*.json"):
        path.unlink()
        cleared += 1
    return JSONResponse({"ok": True, "cleared": cleared})
