# Style Chunk Summary Prompt (map step)

Used once per batch of ~50 moodboard image analyses. Identifies recurring
visual patterns within that batch, rather than re-listing every entry —
feeds into a final synthesis pass across all batches.

---

## Prompt text

Below are cinematographic analyses of {{ENTRY_COUNT}} reference images for a
film called Disordine, covering their color palette, lighting, mood, and
symbolism.

{{ENTRIES}}

**Your task:** Identify the recurring visual patterns across this batch — not
a list of individual images, but what repeats. Cover:

- **Color palette patterns** — what dominates across this batch, and any
  notable exceptions
- **Lighting patterns** — recurring qualities, sources, contrast levels
- **Mood patterns** — the emotional register(s) that keep recurring
- **Symbolism patterns** — recurring motifs, objects, or themes

Note both what's dominant and what's a genuine, distinct minority pattern
worth preserving — don't flatten everything into one description if the
batch actually contains real variety.

**Output format:**

```json
{
  "color_palette_patterns": "...",
  "lighting_patterns": "...",
  "mood_patterns": "...",
  "symbolism_patterns": "..."
}
```

Return only the JSON object — no commentary before or after it.
