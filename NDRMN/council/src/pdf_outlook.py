from pathlib import Path

from fpdf import FPDF

from src.pdf_utils import mc, register_fonts, set_font

STATIC_DIR = Path(__file__).resolve().parent.parent / "webapp" / "static"


def build_outlook_pdf(run_labels: list, sections: list, output_path: Path) -> Path:
    """sections: list of (topic_row, findings_dict, section_dict) tuples, in
    topic order. section_dict has 'section_title' and 'prose'."""
    pdf = FPDF()
    register_fonts(pdf)
    pdf.set_auto_page_break(auto=True, margin=20)

    # Title page
    pdf.add_page()
    pdf.ln(40)
    set_font(pdf, "B", 28)
    mc(pdf, 14, "The Metanoia Outlook")
    set_font(pdf, "I", 13)
    mc(pdf, 8, "A plausible, abundant future for humanity, 40 years from now.")
    pdf.ln(10)
    set_font(pdf, "", 11)
    mc(pdf, 6, "Synthesized from " + ", ".join(run_labels) + ".")

    # Body — one continuous flow, not a page per topic. auto_page_break
    # handles overflow naturally as the text fills each page.
    pdf.add_page()
    for i, (topic, findings, section) in enumerate(sections):
        if i > 0:
            pdf.ln(10)
        set_font(pdf, "B", 16)
        mc(pdf, 10, section.get("section_title") or topic["name"])
        pdf.ln(4)
        set_font(pdf, "", 12)
        mc(pdf, 7, section.get("prose", ""), align="J")

    # Methodology coda
    pdf.add_page()
    pdf.ln(20)
    set_font(pdf, "B", 14)
    mc(pdf, 8, "A note on how this was made")
    pdf.ln(2)
    set_font(pdf, "I", 10)
    coda = (
        f"This outlook was synthesized from {len(run_labels)} independent council "
        "sessions, each running six of the world's leading AI models — Claude, "
        "GPT, Gemini, Grok, Qwen, and DeepSeek — completely blind to one another "
        "and to each other's sessions. Each model independently proposed its own "
        "vision for every topic, reviewed and rated the other five, and had the "
        "chance to revise its position in light of that feedback. What follows "
        "draws on whatever ideas held up across every one of those independent "
        "sessions, alongside the single most vivid, specific detail each topic "
        "produced along the way."
    )
    mc(pdf, 6, coda)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(output_path))
    return output_path
