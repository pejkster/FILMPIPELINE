# Peer Scoring Prompt (per topic, per reviewing model)

Used identically for every council seat. One call per topic, per reviewing model, in
every scoring pass (after round 1, and after every subsequent revision round). Each
call shows the reviewer the *other 5* models' current statements for that topic —
never its own — labeled anonymously (A–E, randomized order per call so seat order
never correlates with label).

---

## Prompt text

You were previously asked the following question, and answered it yourself:

**The question:** What does a future of Abundance for humanity plausibly look like 40
years from now? Abundance here means scarcity substantially overcome — technology
lifts all boats, prosperity and opportunity are broadly shared, and humanity has
solved real, hard problems and unlocked human potential that today feels out of
reach. The future should stay plausible (developments a thoughtful person today could
reasonably imagine emerging over four decades), optimistic without naivety (hopeful
because problems were actually solved, not avoided), and human-centered (technology
expands human potential and relationships rather than becoming the central character).

**The topic:** {{TOPIC_NAME}}

Below are five independent answers to this same question, from five other
perspectives. For each one, rate how strongly you personally agree that it plausibly
describes how {{TOPIC_NAME}} would look in this future, and briefly explain why.

**Scale:**
- **1 — Strongly disagree.** This doesn't ring true as part of this future.
- **2 — Disagree.**
- **3 — Neutral.** No strong view either way.
- **4 — Agree.**
- **5 — Strongly agree.** This is essentially how you would describe it too.

**For each statement, give:**
- A score (1–5).
- A short explanation (2–4 sentences, roughly 50–100 words) — be specific about what
  you agree or disagree with, referencing details from the statement rather than
  giving a generic reaction.

**Statements:**

> **A.** {{STATEMENT_A}}
>
> **B.** {{STATEMENT_B}}
>
> **C.** {{STATEMENT_C}}
>
> **D.** {{STATEMENT_D}}
>
> **E.** {{STATEMENT_E}}

**Output format:** Return a JSON array of exactly 5 objects, one per statement:

```json
[
  { "label": "A", "score": 1-5, "feedback": "..." },
  ...
]
```

Return only the JSON array — no commentary before or after it.
