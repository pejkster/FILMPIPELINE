from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos

STATIC_DIR = Path(__file__).resolve().parent.parent / "webapp" / "static"

_FONT_DIR = Path("/System/Library/Fonts/Supplemental")
_FONT_FAMILY = "Arial"
_FONT_FILES = {
    "": "Arial.ttf",
    "B": "Arial Bold.ttf",
    "I": "Arial Italic.ttf",
    "BI": "Arial Bold Italic.ttf",
}


def _register_fonts(pdf: FPDF):
    for style, filename in _FONT_FILES.items():
        pdf.add_font(_FONT_FAMILY, style, str(_FONT_DIR / filename))


def _set_font(pdf: FPDF, style: str, size: int):
    pdf.set_font(_FONT_FAMILY, style, size)


def _mc(pdf: FPDF, h: float, text: str):
    """multi_cell that always resets the cursor to the left margin afterward —
    fpdf2's default (new_x=RIGHT) otherwise leaves the next call with ~0 width."""
    pdf.multi_cell(0, h, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)


def _line(pdf: FPDF, h: float, text: str):
    pdf.cell(0, h, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)


def _item_block(pdf: FPDF, item: dict):
    _set_font(pdf, "B", 11)
    _mc(pdf, 6, f"- {item.get('theme', '')}")
    _set_font(pdf, "", 11)
    pdf.set_x(pdf.l_margin + 5)
    _mc(pdf, 6, item.get("detail", ""))
    pdf.ln(1)


def build_report_pdf(run_row, topic_analyses, output_path: Path) -> Path:
    """topic_analyses: list of (topic_row, analysis_dict) tuples, in topic order."""
    pdf = FPDF()
    _register_fonts(pdf)
    pdf.set_auto_page_break(auto=True, margin=15)

    pdf.add_page()
    _set_font(pdf, "B", 20)
    _mc(pdf, 12, "Metanoia Council — Analysis Report")
    _set_font(pdf, "", 12)
    label = run_row["label"] or f"Run {run_row['id']}"
    _mc(pdf, 8, f"{label}  ·  run {run_row['id']}  ·  started {run_row['started_at']}")

    for topic, analysis in topic_analyses:
        pdf.add_page()
        _set_font(pdf, "B", 16)
        _mc(pdf, 10, topic["name"])
        pdf.ln(2)

        summary = analysis.get("summary")
        if summary:
            _set_font(pdf, "I", 11)
            _mc(pdf, 6, summary)
            pdf.ln(4)

        _set_font(pdf, "B", 13)
        _line(pdf, 8, "Similarities")
        for item in analysis.get("similarities", []):
            _item_block(pdf, item)

        pdf.ln(3)
        _set_font(pdf, "B", 13)
        _line(pdf, 8, "Differences")
        for item in analysis.get("differences", []):
            _item_block(pdf, item)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(output_path))
    return output_path
