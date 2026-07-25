"""Builds the weekly email and slide outline from a selected topic.

Each topic in topics.json has a list of `sections`; every section is a
dict with a `heading` (the slide title / agenda item) and `details` (the
actual factual bullet points shown on that slide). Older topics that still
use a flat `key_points` list are supported too.
"""

from datetime import date


def get_sections(topic):
    """Return a normalized list of {heading, details} for a topic.

    Supports both the newer `sections` format (heading + factual details)
    and the older `key_points` format (headings only, no details).
    """
    if topic.get("sections"):
        return topic["sections"]
    return [{"heading": kp, "details": []} for kp in topic.get("key_points", [])]


def build_email(topic, sender_name="Your Safety Training Team", for_date=None):
    """Return (subject, body_text) for the weekly training email."""
    for_date = for_date or date.today()
    week_of = for_date.strftime("%B %d, %Y")

    subject = f"Weekly Safety Training: {topic['title']} (Week of {week_of})"

    sections = get_sections(topic)
    points = "\n".join(f"  • {s['heading']}" for s in sections)

    body = f"""Hello team,

This week's safety training topic is: {topic['title']}

{topic['summary']}

What we'll cover:
{points}

Official FMCSA reference:
{topic['source_url']}

Please review the attached slides. If you have questions, reply to this
email and we'll cover them in the next session.

Stay safe out there,
{sender_name}
"""
    return subject, body


def build_slide_outline(topic, for_date=None):
    """Return a list of slides; each slide is a dict with title + bullets.

    This is a ready-to-use outline you can paste into PowerPoint or Google
    Slides (one slide per list item). Content slides are populated with the
    actual FMCSA facts from each section's `details`.
    """
    for_date = for_date or date.today()
    week_of = for_date.strftime("%B %d, %Y")
    sections = get_sections(topic)

    slides = []

    # Title slide
    slides.append({
        "title": topic["title"],
        "bullets": [
            "Weekly Safety Training",
            f"Week of {week_of}",
            "Source: FMCSA (fmcsa.dot.gov)",
        ],
    })

    # Overview slide
    overview = [topic["summary"]]
    if topic.get("regulation"):
        overview.append(f"Regulation: {topic['regulation']}")
    slides.append({
        "title": "Overview",
        "bullets": overview,
    })

    # Agenda slide
    slides.append({
        "title": "What We'll Cover",
        "bullets": [s["heading"] for s in sections],
    })

    # One content slide per section, filled with the real facts.
    for section in sections:
        bullets = list(section.get("details") or [
            "Key requirement / best practice:",
            "Why it matters for safety and compliance:",
            "How it applies to our operation:",
        ])
        slides.append({
            "title": section["heading"],
            "bullets": bullets,
        })

    # Resources slide
    slides.append({
        "title": "Resources & Questions",
        "bullets": [
            f"FMCSA reference: {topic['source_url']}",
            f"Regulation: {topic['regulation']}" if topic.get("regulation") else
            "Verify details against the current FMCSA page before presenting.",
            "Questions? Reply to the training email.",
        ],
    })

    return slides


def render_outline_text(topic, slides):
    """Render the slide outline as plain text for saving to a file."""
    lines = [f"SLIDE OUTLINE — {topic['title']}", "=" * 60, ""]
    for i, slide in enumerate(slides, 1):
        lines.append(f"Slide {i}: {slide['title']}")
        for b in slide["bullets"]:
            lines.append(f"    - {b}")
        lines.append("")
    return "\n".join(lines)
