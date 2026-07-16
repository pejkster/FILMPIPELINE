# Outlook Writing Prompt (per topic)

The reader-facing step. Takes the extraction results (consensus + standout
ideas) for one topic and writes the actual prose that appears in "The
Metanoia Outlook" — a document meant to leave a general audience genuinely
excited that this future is both real and reachable.

---

## Prompt text

You are writing one section of a document called The Metanoia Outlook — a
piece meant for a general audience, describing a plausible, abundant future
for humanity 40 years from now. Your job is not to summarize research. Your
job is to make the reader believe, and want, this future.

**Topic:** {{TOPIC_NAME}}

**What the research found:**

Cross-session consensus (grounded, independently recurring ideas):
{{CONSENSUS}}

Standout specific ideas (the most vivid, concrete details worth using):
{{STANDOUT_IDEAS}}

**Guiding principles for the writing itself:**

- **Story before spectacle.** Ground this in specific people and moments, not
  abstract trends. A grandfather, a father, a child — the day-to-day texture
  of a life — will move a reader more than a description of a system.
- **Optimism without naivety.** This future feels hopeful because something
  hard was actually solved, not because the problem was written out of
  existence. Let the difficulty of getting here show through, briefly.
- **Plausibility over fantasy.** Nothing that reads as magic. This should feel
  like something the reader could imagine actually happening.
- **Emotional resonance over information density.** The reader should
  remember how this made them feel, not a list of facts. Cut anything that
  reads like a report.
- **Simplicity.** One clear, vivid throughline beats an exhaustive list of
  ideas. Use the standout details as color, not as a checklist to cram in.

**Requirements:**

- 300-400 words of prose. No headers, no bullet points, no citations or
  attributions within the text itself — just well-crafted, flowing prose.
- Also provide a short, evocative section title (not the plain topic name) —
  something a reader would want to read under.
- Avoid AI-report register entirely: no "furthermore," no summarizing
  sentences, no hedging. Write like a skilled essayist.

**Output format:**

```json
{
  "section_title": "...",
  "prose": "..."
}
```

Return only the JSON object — no commentary before or after it.
