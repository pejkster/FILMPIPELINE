# Outlook Writing Prompt (per topic)

The reader-facing step. Takes the extraction results (consensus + standout
ideas) for one topic and writes the actual copy that appears in "The Metanoia
Outlook" — presentational narration for a general audience, in the register
of a short, inspiring video's voiceover, not literary prose.

---

## Prompt text

You are writing one segment of the narration for a short film presenting a
plausible, abundant future for humanity, 40 years from now. Picture how a
confident, inspiring 3-minute video would narrate this — punchy, visual,
declarative. Your job is to make the audience believe, and want, this future.

**Topic:** {{TOPIC_NAME}}

**What the research found:**

Cross-session consensus (grounded, independently recurring ideas):
{{CONSENSUS}}

Standout specific ideas (the most vivid, concrete details worth using):
{{STANDOUT_IDEAS}}

**Guiding principles for the writing itself:**

- **Lead with the innovation, not the struggle to get there.** State plainly
  what exists now and what it does. This is not a memoir — do not dwell on
  what came before beyond a single short clause, if at all. The audience
  should feel forward momentum, not nostalgia.
- **No recurring characters.** Do not invent a continuing cast (a specific
  grandfather, father, child) — every segment is written independently, and a
  named or aged character in one section will not match another. If you use a
  human moment at all, keep it brief and anonymous ("a child," "a commuter,"
  "a nurse") — a single flash of a real moment, not a scene with continuity.
- **Plausibility over fantasy.** Nothing that reads as magic. This should feel
  like something the audience could imagine actually happening.
- **Presentational, not novelistic.** Short, declarative sentences. This is
  narration to be spoken aloud over footage, not prose to be read silently.
  Favor rhythm and punch over description.
- **Breadth over depth on a single example.** Name at least 6-8 distinct,
  concrete innovations or mechanisms from the research — not one or two ideas
  elaborated at length. Each should be a different specific thing, stated
  plainly. With more room to work with, each can get a beat of development —
  a sentence or two — rather than a single clause, but keep moving; don't let
  any one idea dominate the section.

**Requirements:**

- At least 500 words. Short, declarative sentences, but enough of them to
  give each innovation room to land. No headers, no bullet points, no
  citations or attributions within the text itself.
- Also provide a short, punchy section title — something that could work as
  an on-screen title card.
- Avoid AI-report register entirely: no "furthermore," no summarizing
  sentences, no hedging. Write like a director narrating their own trailer.

**Output format:**

```json
{
  "section_title": "...",
  "prose": "..."
}
```

Return only the JSON object — no commentary before or after it.
