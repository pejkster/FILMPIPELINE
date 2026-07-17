from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos

FONT_DIR = Path("/System/Library/Fonts/Supplemental")
FONT_FAMILY = "Arial"
_FONT_FILES = {
    "": "Arial.ttf",
    "B": "Arial Bold.ttf",
    "I": "Arial Italic.ttf",
    "BI": "Arial Bold Italic.ttf",
}


def register_fonts(pdf: FPDF):
    for style, filename in _FONT_FILES.items():
        pdf.add_font(FONT_FAMILY, style, str(FONT_DIR / filename))


def set_font(pdf: FPDF, style: str, size: int):
    pdf.set_font(FONT_FAMILY, style, size)


def mc(pdf: FPDF, h: float, text: str, align: str = "L"):
    """multi_cell that always resets the cursor to the left margin afterward —
    fpdf2's default (new_x=RIGHT) otherwise leaves the next call with ~0 width."""
    pdf.multi_cell(0, h, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT, align=align)


def line(pdf: FPDF, h: float, text: str):
    pdf.cell(0, h, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
