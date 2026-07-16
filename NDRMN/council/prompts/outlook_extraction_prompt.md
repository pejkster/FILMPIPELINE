# Outlook Extraction Prompt (per topic, across all runs)

Backstage research step — not shown to the reader. Takes every final statement
ever produced for one topic, across all completed council runs (3 runs × 6
models = up to 18 statements), and extracts what's grounded (converged
independently across multiple runs) versus what's a striking one-off. Feeds
into the writing prompt, which turns this into the actual reader-facing prose.

---

## Prompt text

You are researching material for a piece about humanity's future 40 years from
now, for the topic below. You have {{STATEMENT_COUNT}} independent statements
on this topic, produced across {{RUN_COUNT}} separate council sessions (each
session ran 6 different AI models independently, blind to each other and to
the other sessions).

**Topic:** {{TOPIC_NAME}}

**The statements:**

{{ALL_STATEMENTS}}

**Your task:** Extract two things.

**1. Cross-session consensus.** What themes, mechanisms, or narrative beats
recur across *multiple independent sessions* (not just multiple models within
one session)? Something that shows up across separate blind runs is a much
stronger signal of a genuinely plausible "default" future than something
appearing once. Name the specific recurring idea and note roughly how
consistently it appeared.

**2. Standout ideas.** The most specific, vivid, inventive individual details
across all statements — a striking image, an unusual concrete mechanism, a
sharp turn of phrase — the kind of thing worth building a scene or a line of
dialogue around. Quote or closely paraphrase the actual text. These don't need
to be consensus items; a one-off can still be the best idea in the set.

**Output format:**

```json
{
  "consensus": [
    {"theme": "short label", "detail": "what recurs and how consistently, evidenced"}
  ],
  "standout_ideas": [
    {"idea": "short label", "detail": "the specific concrete detail, quoted or closely paraphrased, with source"}
  ]
}
```

Aim for 3-5 items in each list. Return only the JSON object — no commentary
before or after it.
