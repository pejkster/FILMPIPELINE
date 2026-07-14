"""Runware API integration for image generation across pipeline stages."""

import os
import asyncio
import uuid
from pathlib import Path
from datetime import datetime

from dotenv import load_dotenv
from runware import Runware, IImageInference, IImageUpscale

load_dotenv()

PIPELINE_ROOT = Path(__file__).parent.parent.parent
ASSETS_DIR = PIPELINE_ROOT / "02_worldbuilding" / "assets"
SHOTS_DIR = PIPELINE_ROOT / "03_production" / "shots"


class RunwareService:
    def __init__(self):
        self.api_key = os.getenv("RUNWARE_API_KEY")
        if not self.api_key:
            raise ValueError("RUNWARE_API_KEY not set in environment")
        self._client: Runware | None = None

    async def _connect(self) -> Runware:
        if self._client is None:
            self._client = Runware(api_key=self.api_key)
            await self._client.connect()
        return self._client

    async def generate_image(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        model: str = "runware:101@1",
        number_results: int = 1,
        steps: int = 30,
        cfg_scale: float = 7.0,
        seed: int | None = None,
    ) -> list[dict]:
        """Generate images from a text prompt. Returns list of {url, seed} dicts."""
        client = await self._connect()

        params = {
            "positivePrompt": prompt,
            "model": model,
            "numberResults": number_results,
            "height": height,
            "width": width,
            "steps": steps,
            "CFGScale": cfg_scale,
            "outputFormat": "PNG",
        }
        if negative_prompt:
            params["negativePrompt"] = negative_prompt
        if seed is not None:
            params["seed"] = seed

        request = IImageInference(**params)
        images = await client.imageInference(requestImage=request)

        results = []
        for img in images:
            results.append({
                "url": img.imageURL,
                "seed": getattr(img, "seed", None),
            })
        return results

    async def upscale_image(
        self,
        image_url: str,
        upscale_factor: int = 2,
    ) -> dict:
        """Upscale an image. Returns {url}."""
        client = await self._connect()

        payload = IImageUpscale(
            inputImage=image_url,
            upscaleFactor=upscale_factor,
        )
        results = await client.imageUpscale(upscaleGanPayload=payload)
        return {"url": results[0].imageURL}

    async def generate_character_sheet(
        self,
        name: str,
        description: str,
        style_prompt: str = "",
    ) -> list[dict]:
        """Generate a character reference sheet with front/3-quarter/profile views."""
        base_prompt = f"character reference sheet, {name}, {description}"
        if style_prompt:
            base_prompt = f"{base_prompt}, {style_prompt}"

        views = {
            "front": f"{base_prompt}, front view, full body, white background, character design sheet",
            "three_quarter": f"{base_prompt}, three quarter view, full body, white background, character design sheet",
            "profile": f"{base_prompt}, side profile view, full body, white background, character design sheet",
        }

        results = []
        for view_name, prompt in views.items():
            images = await self.generate_image(
                prompt=prompt,
                negative_prompt="blurry, low quality, deformed, multiple characters",
                width=768,
                height=1024,
            )
            if images:
                results.append({
                    "view": view_name,
                    "url": images[0]["url"],
                    "seed": images[0]["seed"],
                    "prompt": prompt,
                })
        return results

    async def generate_environment(
        self,
        name: str,
        description: str,
        style_prompt: str = "",
    ) -> list[dict]:
        """Generate environment concept art."""
        base_prompt = f"cinematic environment concept art, {name}, {description}"
        if style_prompt:
            base_prompt = f"{base_prompt}, {style_prompt}"

        images = await self.generate_image(
            prompt=base_prompt,
            negative_prompt="blurry, low quality, text, watermark",
            width=1920,
            height=1080,
            number_results=2,
        )
        return images

    async def generate_shot(
        self,
        description: str,
        style_prompt: str = "",
        width: int = 1920,
        height: int = 1080,
    ) -> list[dict]:
        """Generate a cinematic shot frame."""
        prompt = f"cinematic film still, {description}"
        if style_prompt:
            prompt = f"{prompt}, {style_prompt}"

        images = await self.generate_image(
            prompt=prompt,
            negative_prompt="blurry, low quality, text, watermark, amateur",
            width=width,
            height=height,
        )
        return images


_service: RunwareService | None = None


def get_runware_service() -> RunwareService:
    global _service
    if _service is None:
        _service = RunwareService()
    return _service
