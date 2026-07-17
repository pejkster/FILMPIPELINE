# Final Polish Prompt (Step 6, Screenwriter)

The last step. The Screenwriter (who owns the overall narrative voice) makes
the final call on the advisory notes and produces the finished screenplay.

---

## Prompt text

You are the Screenwriter, making the final pass on this 3-minute piece. All
Guardian sign-offs are complete — the binding constraints are satisfied.
What remains is the Producer's and Outside Critic's advisory notes, which you
may act on or set aside at your own judgment.

**The current draft:**

{{DRAFT}}

**Producer's notes (advisory):**

{{PRODUCER_NOTES}}

**Outside Critic's notes (advisory):**

{{CRITIC_NOTES}}

**Your task:** Incorporate whatever advisory notes genuinely improve the
piece, and produce the final screenplay — a clean, complete, shootable
document: scene-by-scene, with visual direction and any dialogue, formatted
as an actual screenplay/treatment for a 3-minute film, not a summary of one.

**Output format:**

```json
{
  "title": "a title for the piece",
  "screenplay": "the complete, final screenplay text"
}
```

Return only the JSON object — no commentary before or after it.
