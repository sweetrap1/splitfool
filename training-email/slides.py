"""Generate a real PowerPoint (.pptx) deck from a training topic.

Uses python-pptx (pure Python, `pip install python-pptx`) so the whole tool
stays Python-only and portable. Produces a clean, consistent deck that works
for any topic in topics.json:

  - Dark title slide (navy) with the topic and week
  - Light content slides, one per section, with a gold number badge and the
    actual FMCSA facts as bullets
  - Dark closing slide with the FMCSA reference and citation

Design is intentionally template-driven (not per-slide bespoke art) so it
renders reliably for all 16 topics regardless of content length.
"""

from datetime import date

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

import content as content_mod

# --- Palette: DOT safety (deep navy + safety gold on white) ---
NAVY = RGBColor(0x1E, 0x2C, 0x50)      # primary dark
NAVY_DEEP = RGBColor(0x16, 0x20, 0x3A)  # title/closing background
GOLD = RGBColor(0xF4, 0xA9, 0x1F)      # safety-gold accent
INK = RGBColor(0x22, 0x2A, 0x38)       # body text on light
MUTED = RGBColor(0x6B, 0x74, 0x85)     # captions / footers
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT = RGBColor(0xFF, 0xFF, 0xFF)     # content background

SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)

TITLE_FONT = "Calibri"
BODY_FONT = "Calibri"


def _set_bg(slide, rgb):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = rgb


def _textbox(slide, left, top, width, height):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = 0
    tf.margin_right = 0
    tf.margin_top = 0
    tf.margin_bottom = 0
    return box, tf


def _style_run(run, size, color, bold=False, italic=False, font=BODY_FONT):
    run.font.size = Pt(size)
    run.font.color.rgb = color
    run.font.bold = bold
    run.font.italic = italic
    run.font.name = font


def _number_badge(slide, number, left, top, diameter=Inches(0.75)):
    """A gold circle with a white number — the deck's repeating motif."""
    shape = slide.shapes.add_shape(MSO_SHAPE.OVAL, left, top, diameter, diameter)
    shape.fill.solid()
    shape.fill.fore_color.rgb = GOLD
    shape.line.fill.background()
    shape.shadow.inherit = False
    tf = shape.text_frame
    tf.word_wrap = False
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = str(number)
    _style_run(run, 26, NAVY_DEEP, bold=True, font=TITLE_FONT)
    return shape


def _title_slide(prs, topic, week_of, regulation):
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank
    _set_bg(slide, NAVY_DEEP)

    # Gold accent bar of the motif: a small gold square block, not a full stripe
    block = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(0.9), Inches(2.2), Inches(0.9), Inches(0.14))
    block.fill.solid()
    block.fill.fore_color.rgb = GOLD
    block.line.fill.background()
    block.shadow.inherit = False

    # Kicker
    _, tf = _textbox(slide, Inches(0.9), Inches(1.5), Inches(11.5), Inches(0.6))
    r = tf.paragraphs[0].add_run()
    r.text = "WEEKLY SAFETY TRAINING"
    _style_run(r, 18, GOLD, bold=True, font=TITLE_FONT)
    tf.paragraphs[0].font.name = TITLE_FONT

    # Topic title
    _, tf = _textbox(slide, Inches(0.9), Inches(2.6), Inches(11.5), Inches(2.6))
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = topic["title"]
    _style_run(r, 48, WHITE, bold=True, font=TITLE_FONT)

    # Week + source
    _, tf = _textbox(slide, Inches(0.9), Inches(5.6), Inches(11.5), Inches(1.2))
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = f"Week of {week_of}"
    _style_run(r, 20, WHITE, font=BODY_FONT)
    p2 = tf.add_paragraph()
    r = p2.add_run()
    src = "Source: FMCSA (fmcsa.dot.gov)"
    if regulation:
        src += f"   •   {regulation}"
    r.text = src
    _style_run(r, 14, RGBColor(0xB8, 0xC2, 0xD9), font=BODY_FONT)
    return slide


def _overview_slide(prs, topic, regulation):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide, LIGHT)

    _, tf = _textbox(slide, Inches(0.9), Inches(0.7), Inches(11.5), Inches(1.0))
    r = tf.paragraphs[0].add_run()
    r.text = "Overview"
    _style_run(r, 40, NAVY, bold=True, font=TITLE_FONT)

    _, tf = _textbox(slide, Inches(0.9), Inches(2.1), Inches(11.5), Inches(3.0))
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = topic["summary"]
    _style_run(r, 22, INK, font=BODY_FONT)

    if regulation:
        # Citation "pill" (rounded rectangle), no edge stripes.
        pill = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.9), Inches(5.4),
            Inches(6.2), Inches(0.7))
        pill.fill.solid()
        pill.fill.fore_color.rgb = NAVY
        pill.line.fill.background()
        pill.shadow.inherit = False
        ptf = pill.text_frame
        ptf.vertical_anchor = MSO_ANCHOR.MIDDLE
        ptf.margin_left = Inches(0.25)
        pp = ptf.paragraphs[0]
        r = pp.add_run()
        r.text = f"Regulation:  {regulation}"
        _style_run(r, 16, WHITE, bold=True, font=BODY_FONT)
    return slide


def _agenda_slide(prs, headings):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide, LIGHT)

    _, tf = _textbox(slide, Inches(0.9), Inches(0.7), Inches(11.5), Inches(1.0))
    r = tf.paragraphs[0].add_run()
    r.text = "What We'll Cover"
    _style_run(r, 40, NAVY, bold=True, font=TITLE_FONT)

    # Two columns if more than 4 items.
    half = (len(headings) + 1) // 2 if len(headings) > 4 else len(headings)
    columns = [headings[:half], headings[half:]] if headings[half:] else [headings[:half]]
    col_width = Inches(5.6)
    lefts = [Inches(0.9), Inches(7.0)]

    for ci, col in enumerate(columns):
        _, tf = _textbox(slide, lefts[ci], Inches(2.1), col_width, Inches(4.6))
        for i, heading in enumerate(col):
            idx = ci * half + i + 1
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.space_after = Pt(14)
            rn = p.add_run()
            rn.text = f"{idx}.  "
            _style_run(rn, 20, GOLD, bold=True, font=TITLE_FONT)
            rt = p.add_run()
            rt.text = heading
            _style_run(rt, 20, INK, font=BODY_FONT)
    return slide


def _content_slide(prs, number, heading, details, citation):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide, LIGHT)

    # Number badge motif
    _number_badge(slide, number, Inches(0.9), Inches(0.75))

    # Heading (to the right of the badge)
    _, tf = _textbox(slide, Inches(1.95), Inches(0.72), Inches(10.4), Inches(1.3))
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    r = tf.paragraphs[0].add_run()
    r.text = heading
    _style_run(r, 32, NAVY, bold=True, font=TITLE_FONT)

    # Bullets
    _, tf = _textbox(slide, Inches(0.95), Inches(2.35), Inches(11.4), Inches(4.2))
    bullets = details or [
        "Key requirement / best practice",
        "Why it matters for safety and compliance",
        "How it applies to our operation",
    ]
    for i, b in enumerate(bullets):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(14)
        dot = p.add_run()
        dot.text = "▪  "  # small square, matches gold motif when colored
        _style_run(dot, 18, GOLD, bold=True, font=BODY_FONT)
        rt = p.add_run()
        rt.text = b
        _style_run(rt, 18, INK, font=BODY_FONT)

    # Footer citation (muted, low on the slide)
    if citation:
        _, tf = _textbox(slide, Inches(0.95), Inches(6.95), Inches(11.4), Inches(0.4))
        r = tf.paragraphs[0].add_run()
        r.text = citation
        _style_run(r, 11, MUTED, italic=True, font=BODY_FONT)
    return slide


def _closing_slide(prs, topic, regulation):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _set_bg(slide, NAVY_DEEP)

    _, tf = _textbox(slide, Inches(0.9), Inches(1.4), Inches(11.5), Inches(1.2))
    r = tf.paragraphs[0].add_run()
    r.text = "Resources & Questions"
    _style_run(r, 40, WHITE, bold=True, font=TITLE_FONT)

    block = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(0.9), Inches(2.7), Inches(0.9), Inches(0.14))
    block.fill.solid()
    block.fill.fore_color.rgb = GOLD
    block.line.fill.background()
    block.shadow.inherit = False

    _, tf = _textbox(slide, Inches(0.9), Inches(3.1), Inches(11.5), Inches(3.0))
    lines = [
        ("Official FMCSA reference:", 20, GOLD, True),
        (topic["source_url"], 18, WHITE, False),
        ("", 8, WHITE, False),
    ]
    if regulation:
        lines.append((f"Regulation: {regulation}", 18, WHITE, False))
    lines.append(("", 8, WHITE, False))
    lines.append(("Questions? Reply to the training email — we'll cover them next session.",
                  18, RGBColor(0xB8, 0xC2, 0xD9), False))
    for i, (text, size, color, bold) in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        r = p.add_run()
        r.text = text
        _style_run(r, size, color, bold=bold, font=BODY_FONT)
    return slide


def build_pptx(topic, out_path, for_date=None):
    """Build a .pptx deck for `topic` and save it to out_path. Returns out_path."""
    for_date = for_date or date.today()
    week_of = for_date.strftime("%B %d, %Y")
    regulation = topic.get("regulation", "")
    sections = content_mod.get_sections(topic)

    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H

    _title_slide(prs, topic, week_of, regulation)
    _overview_slide(prs, topic, regulation)
    _agenda_slide(prs, [s["heading"] for s in sections])
    for i, section in enumerate(sections, 1):
        _content_slide(prs, i, section["heading"], section.get("details"),
                       f"FMCSA — {regulation}" if regulation else topic["source_url"])
    _closing_slide(prs, topic, regulation)

    prs.save(out_path)
    return out_path
