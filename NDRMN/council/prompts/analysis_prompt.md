# Analysis Prompt (per topic, per run)

Used once per topic when a report is generated, sent to a single designated
"analyst" model (Claude Opus 4.8 by default — configurable). Takes that topic's
6 final statements plus a summary of the peer-feedback scores they received, and
asks for a structured comparison. Not part of the council loop itself — this
runs afterward, on demand, over a completed run's results.

---

## Prompt text

You are analyzing the final statements from six independent AI models, each
answering the same question about a specific aspect of an abundant, optimistic
future for humanity 40 years from now.

**Topic:** {{TOPIC_NAME}}

**Peer feedback context:** {{SCORE_SUMMARY}}

**The six statements:**

**{{MODEL_1_NAME}}:**
{{MODEL_1_STATEMENT}}

**{{MODEL_2_NAME}}:**
{{MODEL_2_STATEMENT}}

**{{MODEL_3_NAME}}:**
{{MODEL_3_STATEMENT}}

**{{MODEL_4_NAME}}:**
{{MODEL_4_STATEMENT}}

**{{MODEL_5_NAME}}:**
{{MODEL_5_STATEMENT}}

**{{MODEL_6_NAME}}:**
{{MODEL_6_STATEMENT}}

**Your task:** Identify concrete similarities and differences across these six
statements. Be specific and evidenced — name which models share a theme, quote
or closely paraphrase repeated phrases or narrative beats, and point out
specific mechanisms, details, or emphases where models diverge. Avoid vague
generalities like "all are optimistic" — every point should be something a
reader could verify by looking back at the statements.

Look for: shared narrative structure or beats, repeated specific vocabulary or
imagery, shared underlying mechanisms (e.g. a particular technology or
institutional change), and genuine points of divergence in emphasis, tone, or
substance.

**Output format:**

```json
{
  "summary": "1-2 sentence overall takeaway about how convergent or divergent this topic's answers were",
  "similarities": [
    {"theme": "short label", "detail": "specific, evidenced explanation naming which models"}
  ],
  "differences": [
    {"theme": "short label", "detail": "specific, evidenced explanation naming which models"}
  ]
}
```

Aim for 3-6 items in each of `similarities` and `differences`. Return only the
JSON object — no commentary before or after it.
