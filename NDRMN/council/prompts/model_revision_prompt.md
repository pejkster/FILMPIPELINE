# Revision Prompt (per topic, per model, per round)

Used identically for every council seat. Sent once per topic, per model, per round —
but only for topics still open (i.e. a "2" — major revision — occurred somewhere on
that topic in the previous round). Once a round passes with no major revisions on a
topic, that topic's loop closes and this prompt stops being sent for it.

Like the other two prompts, this is a stateless call: the model's own current
statement is re-supplied in full each time, since no conversation memory carries over
between calls. Peer feedback is shown without reviewer identity attached — the author
sees five (score, feedback) reactions, not who gave them.

---

## Prompt text

You previously gave the following statement in response to this question:

**The question:** What does a future of Abundance for humanity plausibly look like 40
years from now? Abundance here means scarcity substantially overcome — technology
lifts all boats, prosperity and opportunity are broadly shared, and humanity has
solved real, hard problems and unlocked human potential that today feels out of
reach. The future should stay plausible, optimistic without naivety, and
human-centered.

**The topic:** {{TOPIC_NAME}}

**Your statement:**

> {{CURRENT_STATEMENT}}

**How five other perspectives reacted to it:**

1. Score: {{SCORE_1}}/5 — {{FEEDBACK_1}}
2. Score: {{SCORE_2}}/5 — {{FEEDBACK_2}}
3. Score: {{SCORE_3}}/5 — {{FEEDBACK_3}}
4. Score: {{SCORE_4}}/5 — {{FEEDBACK_4}}
5. Score: {{SCORE_5}}/5 — {{FEEDBACK_5}}

**Your task:** Decide whether to revise your statement.

Disagreement from others is not, by itself, a reason to change your view. Only revise
if the feedback surfaces something you find genuinely compelling — a gap in your own
reasoning, a more plausible mechanism, a detail worth sharpening. If you still believe
your original statement is right, keep it exactly as it is.

Classify your own change using this scale:

- **0 — Unchanged.** Your statement is identical to before.
- **1 — Minor revision.** Wording, emphasis, or supporting detail changed; your core
  position is the same.
- **2 — Major revision.** The core claim or position itself changed.

**Requirements if you revise:**
- Keep it 150–250 words.
- Keep the same concrete, scene-level, specific-claim style as your original.
- Do not reference existing fictional franchises, brands, or real living people.

**Output format:**

```json
{
  "revision_score": 0-2,
  "statement": "...",
  "rationale": "1-3 sentences on why you kept it, softened it, or changed it"
}
```

If unchanged, `"statement"` should be your original text verbatim, and
`"revision_score"` must be `0`.

Return only the JSON object — no commentary before or after it.
