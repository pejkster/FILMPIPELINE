from pathlib import Path

from fpdf import FPDF

from src.pdf_utils import line, mc, register_fonts, set_font

STATIC_DIR = Path(__file__).resolve().parent.parent / "webapp" / "static"


def _item_block(pdf: FPDF, item: dict):
    set_font(pdf, "B", 11)
    mc(pdf, 6, f"- {item.get('theme', '')}")
    set_font(pdf, "", 11)
    pdf.set_x(pdf.l_margin + 5)
    mc(pdf, 6, item.get("detail", ""))
    pdf.ln(1)


def build_report_pdf(run_row, topic_analyses, output_path: Path) -> Path:
    """topic_analyses: list of (topic_row, analysis_dict) tuples, in topic order."""
    pdf = FPDF()
    register_fonts(pdf)
    pdf.set_auto_page_break(auto=True, margin=15)

    pdf.add_page()
    set_font(pdf, "B", 20)
    mc(pdf, 12, "Metanoia Council — Analysis Report")
    set_font(pdf, "", 12)
    label = run_row["label"] or f"Run {run_row['id']}"
    mc(pdf, 8, f"{label}  ·  run {run_row['id']}  ·  started {run_row['started_at']}")

    for topic, analysis in topic_analyses:
        pdf.add_page()
        set_font(pdf, "B", 16)
        mc(pdf, 10, topic["name"])
        pdf.ln(2)

        summary = analysis.get("summary")
        if summary:
            set_font(pdf, "I", 11)
            mc(pdf, 6, summary)
            pdf.ln(4)

        set_font(pdf, "B", 13)
        line(pdf, 8, "Similarities")
        for item in analysis.get("similarities", []):
            _item_block(pdf, item)

        pdf.ln(3)
        set_font(pdf, "B", 13)
        line(pdf, 8, "Differences")
        for item in analysis.get("differences", []):
            _item_block(pdf, item)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(output_path))
    return output_path
