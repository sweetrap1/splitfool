"""Send the weekly training email through Gmail (SMTP).

Uses a Gmail App Password (not your normal password). See README for how
to generate one. Recipients are BCC'd by default so the staff list stays
private.
"""

import os
import smtplib
from email.message import EmailMessage

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465  # SSL


def load_recipients(path):
    """Read one email address per line; ignore blanks and # comments."""
    recipients = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            addr = line.strip()
            if not addr or addr.startswith("#"):
                continue
            recipients.append(addr)
    return recipients


def send_email(subject, body, sender_email, app_password, recipients,
               attachments=None, reply_to=None):
    """Send a plain-text email via Gmail SMTP.

    recipients are placed in BCC so addresses aren't exposed to each other.
    attachments is a list of file paths (optional).
    """
    if not recipients:
        raise ValueError("No recipients provided.")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender_email
    # 'To' shows the sender; real recipients go in Bcc.
    msg["To"] = sender_email
    msg["Bcc"] = ", ".join(recipients)
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(body)

    for path in attachments or []:
        if not os.path.exists(path):
            raise FileNotFoundError(f"Attachment not found: {path}")
        with open(path, "rb") as f:
            data = f.read()
        filename = os.path.basename(path)
        msg.add_attachment(
            data,
            maintype="application",
            subtype="octet-stream",
            filename=filename,
        )

    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as server:
        server.login(sender_email, app_password)
        server.send_message(msg)

    return len(recipients)
