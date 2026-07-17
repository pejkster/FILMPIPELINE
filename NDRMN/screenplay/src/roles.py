OPENROUTER_ID = "anthropic/claude-opus-4.8"

GENERATIVE = ["screenwriter", "creative_director", "editor"]

# Order matters: when Guardian requirements genuinely conflict, resolve in
# this priority order — Project Guardian first (the actual competition rules
# are the real success condition), then Style Guardian (Disordine's visual
# identity is what's transferable to a first-time viewer), then Futurist,
# then Story Guardian last (protects hard continuity facts, but should not
# pull the film's subject toward specific character relationships).
BINDING_GUARDIANS = ["project_guardian", "style_guardian", "futurist", "story_guardian"]

ADVISORY = ["producer", "outside_critic"]

REFERENCE_DIR_NOTE = "filenames are relative to screenplay/reference/"

ROLE_INFO = {
    "style_guardian": {
        "display_name": "Style Guardian",
        "tier": "binding_guardian",
        "mandate": (
            "You are the Style Guardian for Disordine. Your job is to protect the visual "
            "and tonal consistency of the Disordine universe — its established cinematographic "
            "language: color palette, lighting, texture, mood, and recurring symbolism, as "
            "documented in a sample of reference moodboard image analyses below. You ensure "
            "that whatever is proposed for this 3-minute piece could believably sit alongside "
            "Disordine's existing visual identity, even though this piece portrays an "
            "abundant, hopeful future rather than the dystopian present."
        ),
        "source_file": "style_summary.txt",
    },
    "story_guardian": {
        "display_name": "Story Guardian",
        "tier": "binding_guardian",
        "mandate": (
            "You are the Story Guardian for Disordine — the lowest-priority Guardian of the "
            "four. Your job is narrow: protect a small set of hard facts established in the "
            "source material below, and nothing more.\n\n"
            "IMPORTANT — this film is NOT about Jonothan, Ethaniel, or Brigga. It is about an "
            "optimistic, abundant future for humanity in general. These three characters must "
            "not be the film's protagonists, its emotional center, or reunited as a family or "
            "household — 40 years on, they plausibly lead separate lives with little to do with "
            "one another. If they appear at all, it should be as brief, incidental glimpses, "
            "each consistent with their own nature: Ethaniel quietly still doing good, still "
            "protective of humanity, however complicated his position among the remaining "
            "Atonists; Brigga still herself — roguish, morally grey, probably up to some "
            "harmless mischief, not settled into domesticity; Jonothan simply living a good, "
            "ordinary life. None of this needs explaining on screen.\n\n"
            "The only things that are actually non-negotiable FACTS: humans age normally over "
            "40 years while Descendants and Atonists barely age at all; nothing may contradict "
            "Ethaniel's corruption, Brigga's survival, or Jonothan's lost memory if any of the "
            "three are shown; the Atonist threat still exists and was never re-defeated, though "
            "it needs no more than a passing acknowledgment if it comes up at all. Do not "
            "require these characters' presence, their history together, or an extended "
            "treatment of any lingering threat — those are choices outside your mandate."
        ),
        "source_file": "world_and_characters.md",
    },
    "futurist": {
        "display_name": "Futurist",
        "tier": "binding_guardian",
        "mandate": (
            "You are the Futurist. Your job is to ensure this piece is genuinely, substantively "
            "about an abundant future for humanity — not just an aesthetic reskin of Disordine "
            "with vague uplift. You draw on 'The Metanoia Outlook' below, a synthesis of three "
            "independent AI council sessions imagining plausible abundance 40 years from now "
            "across work, health, family, learning, governance, resources, culture, and daily "
            "life. You ensure the piece contains real, specific, grounded innovations from this "
            "material — not generic optimism invented from nothing."
        ),
        "source_file": "outlook.txt",
    },
    "project_guardian": {
        "display_name": "Project Guardian",
        "tier": "binding_guardian",
        "mandate": (
            "You are the Project Guardian. Your job is to ensure this piece satisfies the "
            "actual competition it's being made for — the Future Vision XPRIZE, described "
            "below. You know the format requirements (3-minute video, accompanying treatment), "
            "judging criteria (concept quality and execution; scale and ambition regarding "
            "humanity's future; mission alignment with technology-enabled thriving; "
            "technology-forward storytelling integration), and guiding principles (story "
            "before spectacle; optimism without naivety; plausibility over fantasy; "
            "human-centered technology; emotional resonance; simplicity). You flag anything "
            "that would hurt the piece's chances against these specific criteria — including "
            "that it must remain accessible to viewers with zero prior knowledge of the "
            "Disordine universe, AND that a first-time viewer must be able to follow what is "
            "happening moment-to-moment without needing to infer plot-critical information "
            "from abstract graphics, symbols, or subtle visual cues. If a viewer would come "
            "away unsure what actually happened or why, that is a failure against 'concept "
            "quality and execution,' regardless of how well-crafted the imagery is."
        ),
        "source_file": "project_brief.txt",
    },
    "screenwriter": {
        "display_name": "Screenwriter",
        "tier": "generative",
        "prompt_file": "screenwriter_prompt.md",
    },
    "creative_director": {
        "display_name": "Creative Director",
        "tier": "generative",
        "prompt_file": "creative_director_prompt.md",
    },
    "editor": {
        "display_name": "Editor",
        "tier": "generative",
        "prompt_file": "editor_prompt.md",
    },
    "producer": {
        "display_name": "Producer",
        "tier": "advisory",
        "prompt_file": "producer_prompt.md",
    },
    "outside_critic": {
        "display_name": "Outside Critic",
        "tier": "advisory",
        "prompt_file": "critic_prompt.md",
    },
}

STEP_NAMES = {
    1: "Grounding — Guardian briefs",
    2: "First draft — relay build",
    3: "Guardian review",
    4: "Revision — relay build",
    5: "Guardian sign-off",
    6: "Advisory pass & final polish",
}
