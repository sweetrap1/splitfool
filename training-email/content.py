"""Builds the weekly email and slide outline from a selected topic."""

from datetime import date


def build_email(topic, sender_name="Your Safety Training Team", for_date=None):
    """Return (subject, body_text) for the weekly training email."""
    for_date = for_date or date.today()
    week_of = for_date.strftime("%B %d, %Y")

    subject = f"Weekly Safety Training: {topic['title']} (Week of {week_of})"

    points = "\n".join(f"  • {p}" for p in topic["key_points"])

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
    Slides (one slide per list item).
    """
    for_date = for_date or date.today()
    week_of = for_date.strftime("%B %d, %Y")

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
    slides.append({
        "title": "Overview",
        "bullets": [topic["summary"]],
    })

    # Agenda slide
    slides.append({
        "title": "What We'll Cover",
        "bullets": list(topic["key_points"]),
    })

    # One content slide per key point
    for point in topic["key_points"]:
        slides.append({
            "title": point,
            "bullets": [
                "Key requirement / best practice:",
                "Why it matters for safety and compliance:",
                "How it applies to our operation:",
            ],
        })

    # Resources slide
    slides.append({
        "title": "Resources & Questions",
        "bullets": [
            f"FMCSA reference: {topic['source_url']}",
            "Questions? Reply to the training email.",
            "Thank you for keeping our roads safe.",
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
