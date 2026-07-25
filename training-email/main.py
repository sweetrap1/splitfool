#!/usr/bin/env python3
"""Weekly FMCSA training email automation.

Picks a new training topic each week, writes the email and a slide outline,
and (optionally) sends the email to your staff list through Gmail.

Typical use:
    python main.py                 # pick this week's topic, preview + save files
    python main.py --send          # ...and actually email the staff list
    python main.py --date 2026-08-03   # generate for a specific week

Nothing is emailed unless you pass --send. Configuration lives in config.json
(copy config.example.json to config.json and fill it in).
"""

import argparse
import json
import os
from datetime import date, datetime

import content
import selector
import sender

HERE = os.path.dirname(__file__)
CONFIG_FILE = os.path.join(HERE, "config.json")
OUTPUT_DIR = os.path.join(HERE, "output")


def load_config():
    if not os.path.exists(CONFIG_FILE):
        return {}
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_date(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


def write_outputs(topic, week_key, subject, body, outline_text, for_date):
    """Save the email and outline to the output/ folder; return file paths."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    stamp = for_date.strftime("%Y-%m-%d")
    base = f"{stamp}_{topic['id']}"

    email_path = os.path.join(OUTPUT_DIR, f"{base}_email.txt")
    with open(email_path, "w", encoding="utf-8") as f:
        f.write(f"Subject: {subject}\n\n{body}")

    outline_path = os.path.join(OUTPUT_DIR, f"{base}_slides.txt")
    with open(outline_path, "w", encoding="utf-8") as f:
        f.write(outline_text)

    return email_path, outline_path


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                      formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--date", type=parse_date, default=None,
                        help="Generate for the week containing this date (YYYY-MM-DD). Defaults to today.")
    parser.add_argument("--send", action="store_true",
                        help="Actually send the email via Gmail. Without this, only previews/files are produced.")
    parser.add_argument("--no-record", action="store_true",
                        help="Do not write this pick to the rotation history (useful for testing).")
    args = parser.parse_args()

    for_date = args.date or date.today()
    config = load_config()

    # 1. Select the week's topic.
    topics = selector.load_topics()
    state = selector.load_state()
    topic, week_key, already = selector.select_topic(topics, state, for_date)

    # 2. Build the email + slide outline.
    sender_name = config.get("sender_name", "Your Safety Training Team")
    subject, body = content.build_email(topic, sender_name=sender_name, for_date=for_date)
    slides = content.build_slide_outline(topic, for_date=for_date)
    outline_text = content.render_outline_text(topic, slides)

    # 3. Save output files.
    email_path, outline_path = write_outputs(topic, week_key, subject, body, outline_text, for_date)

    # 4. Print a preview.
    print("=" * 64)
    print(f"Week {week_key}  —  Topic: {topic['title']}")
    if already:
        print("(This week was already assigned this topic; reusing it.)")
    print("=" * 64)
    print(f"Subject: {subject}\n")
    print(body)
    print("-" * 64)
    print(f"Email saved to:   {email_path}")
    print(f"Outline saved to: {outline_path}")
    print(f"Slides in outline: {len(slides)}")
    print("-" * 64)

    # 5. Record the pick so the rotation advances (unless suppressed).
    if not already and not args.no_record:
        selector.record_selection(state, topic, week_key)

    # 6. Optionally send.
    if args.send:
        sender_email = config.get("gmail_address")
        app_password = os.environ.get("GMAIL_APP_PASSWORD") or config.get("gmail_app_password")
        recipients_file = config.get("recipients_file", os.path.join(HERE, "recipients.txt"))

        missing = []
        if not sender_email:
            missing.append("gmail_address (in config.json)")
        if not app_password:
            missing.append("GMAIL_APP_PASSWORD env var (or gmail_app_password in config.json)")
        if not os.path.exists(recipients_file):
            missing.append(f"recipients file at {recipients_file}")
        if missing:
            print("\nCannot send — missing:")
            for m in missing:
                print(f"  - {m}")
            print("See README.md for setup. The files above were still generated.")
            return

        recipients = sender.load_recipients(recipients_file)
        # The slide outline is attached as a text file. Swap this for your
        # .pptx once you've built the deck from the outline.
        count = sender.send_email(
            subject=subject,
            body=body,
            sender_email=sender_email,
            app_password=app_password,
            recipients=recipients,
            attachments=[outline_path],
            reply_to=config.get("reply_to"),
        )
        print(f"\nSent to {count} recipient(s) via Gmail (BCC).")
    else:
        print("\nPreview only. Re-run with --send to email the staff list.")


if __name__ == "__main__":
    main()
