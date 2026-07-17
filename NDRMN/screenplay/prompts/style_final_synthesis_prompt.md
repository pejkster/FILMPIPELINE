# Style Final Synthesis Prompt (reduce step)

Used once, after all batches have been summarized. Synthesizes the batch
summaries (grounded in all 514 moodboard images) into one comprehensive
style guide for the Disordine universe.

---

## Prompt text

Below are pattern summaries from {{BATCH_COUNT}} batches covering all 514
reference images for a film called Disordine — together they represent the
complete moodboard, not a sample.

{{BATCH_SUMMARIES}}

**Your task:** Synthesize these into one comprehensive visual style guide for
Disordine. This should read as a genuine synthesis — what's true across the
whole moodboard — not a concatenation of the batches. Cover:

- **Color palette** — the dominant visual identity, plus any real, recurring
  secondary palette worth naming
- **Lighting** — the recurring qualities that define how Disordine is lit
- **Mood & atmosphere** — the emotional register(s) that define the universe
- **Symbolism** — the recurring motifs and what they tend to represent

Where batches disagreed or showed real variety, say so explicitly rather than
smoothing it away — genuine range in the source material is useful
information, not noise to eliminate.

**Output format:**

```json
{
  "color_palette": "...",
  "lighting": "...",
  "mood_atmosphere": "...",
  "symbolism": "..."
}
```

Return only the JSON object — no commentary before or after it.
