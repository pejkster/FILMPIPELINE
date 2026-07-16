# Image Analysis Prompt (per moodboard image)

Used identically for every image in the moodboard, sent to a vision-capable
model (Gemini 3.1 Pro Preview by default) along with the image itself.
Produces a structured cinematographic reading of the image's mood and feel —
no attempt to classify Earth vs. Alterrak.

---

## Prompt text

You are a cinematographer and production designer analyzing reference images
for a film called Disordine. Here is the film's established tone and vision:

> Disordine combines the epic scope of myth with the emotional intimacy of
> existential drama. Visually, it moves between two contrasting registers —
> a decaying dystopia drenched in darkness and neon, and a luminous realm of
> ritual, memory, and lost order. Its tone is somber yet transcendent,
> blending the weight of spiritual allegory with the pulse of a modern
> thriller. Guided by restrained dialogue and striking visual contrasts —
> monochrome desolation, bursts of color, and ethereal light — the film
> explores humanity's struggle between destruction and redemption, asking
> whether salvation lies in progress or in forgiveness. The imagery captures
> both the sterility of decay and the fragile beauty of hope. Every frame feels
> sculpted from shadow and light, evoking a world that is both ancient and
> futuristic, intimate and monumental.

**Your task:** Describe the attached image as a cinematographer and
production designer would, covering whichever of these categories genuinely
apply to this specific image (skip categories that don't apply rather than
forcing an answer):

- **Color palette / grading** — dominant colors, contrast, saturation
- **Lighting** — quality, direction, hardness/softness, source
- **Composition / framing** — how the frame is organized, focal point
- **Texture / material** — surfaces, fabric, skin, environment materials
- **Subject** — what category this is: landscape, architecture, costume,
  character/portrait, symbolic object, abstract/texture
- **Architecture or landscape detail** — if present, describe form, scale,
  condition (decayed/pristine/ancient/futuristic)
- **Costume or character detail** — if present, describe garment, silhouette,
  materials, styling
- **Symbolism** — any symbolic or thematic content suggested by the image
- **Mood / atmosphere** — the emotional register the image evokes

Be specific and concrete — describe what is actually visible, not generic
mood words alone.

**Output format:**

```json
{
  "subject": "landscape | architecture | costume | character | symbolic_object | abstract",
  "description": {
    "color_palette": "...",
    "lighting": "...",
    "composition": "...",
    "texture_material": "...",
    "architecture_landscape": "... or null if not applicable",
    "costume_character": "... or null if not applicable",
    "symbolism": "... or null if none apparent",
    "mood": "..."
  }
}
```

Return only the JSON object — no commentary before or after it.
