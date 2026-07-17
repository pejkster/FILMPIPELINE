from pathlib import Path

from fpdf import FPDF

from src.pdf_utils import mc, register_fonts, set_font

STATIC_DIR = Path(__file__).resolve().parent.parent / "webapp" / "static"


def build_screenplay_pdf(title: str, run_label: str, run_id: int, screenplay_text: str, output_path: Path) -> Path:
    pdf = FPDF()
    register_fonts(pdf)
    pdf.set_auto_page_break(auto=True, margin=20)

    pdf.add_page()
    pdf.ln(30)
    set_font(pdf, "B", 26)
    mc(pdf, 13, title)
    set_font(pdf, "I", 12)
    mc(pdf, 7, f"{run_label} — run {run_id}")
    pdf.ln(10)

    set_font(pdf, "", 11)
    mc(pdf, 6, screenplay_text)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(output_path))
    return output_path
