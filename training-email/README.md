# Weekly FMCSA Training Email Automation

Picks a new commercial-vehicle safety training topic every week (sourced from
[fmcsa.dot.gov](https://www.fmcsa.dot.gov/)), writes a ready-to-send email,
builds a real **PowerPoint (.pptx)** deck plus a text outline, and can email the
whole thing to your staff list through Gmail.

Nothing is emailed unless you explicitly pass `--send`.

---

## Quick start

The core tool uses only the Python standard library (Python 3.8+). To generate
the PowerPoint deck, install one package:

```bash
pip install python-pptx
```

Then:

```bash
cd training-email
python main.py
```

That picks this week's topic, prints a preview, and saves to `output/`:

- `<date>_<topic>_email.txt` — the email subject and body
- `<date>_<topic>_slides.pptx` — the ready-to-present PowerPoint deck
- `<date>_<topic>_slides.txt` — a plain-text outline (backup / for Google Slides)

If `python-pptx` isn't installed, the `.pptx` is skipped and the text outline is
produced instead — everything else still works.

Run it again next week and it automatically moves to a new topic. It cycles
through the entire topic list before anything repeats.

---

## How topic selection works

- Topics live in `topics.json`. Edit that file to add, remove, or reword topics.
- Each week the script picks the **least-recently-used** topic, so the full
  catalog rotates before any repeat.
- The rotation history is stored in `state.json` (created automatically, and
  git-ignored). Delete it to start the rotation over.
- Re-running mid-week is safe — it reuses the same topic already assigned to
  that week.

You can also target a specific week:

```bash
python main.py --date 2026-08-03
```

---

## The slides

Each week you get a finished `_slides.pptx` deck you can open and present
directly in PowerPoint — a dark title slide, an overview with the CFR citation,
an agenda, one slide per key point filled with the actual FMCSA facts, and a
closing slide with the reference link. Edit anything you like before presenting.

The `_slides.txt` outline is a plain-text backup (handy for pasting into Google
Slides via its outline import). To change the deck's colors, fonts, or layout,
edit `slides.py`.

---

## Sending through Gmail

### 1. Create a Gmail App Password
Gmail blocks normal-password logins from scripts. You need an **App Password**:

1. Turn on 2-Step Verification: <https://myaccount.google.com/security>
2. Create an App Password: <https://myaccount.google.com/apppasswords>
3. Copy the 16-character password Google gives you.

### 2. Configure
```bash
cp config.example.json config.json
cp recipients.example.txt recipients.txt
```

Edit `config.json`:
- `gmail_address` — the Gmail account you'll send from
- `sender_name` — the name staff will see in the email
- `reply_to` — where replies should go (usually your work email)

Add your staff emails to `recipients.txt`, one per line.

Provide the app password. **Preferred (safer): an environment variable** so the
secret never lives in a file:

```bash
export GMAIL_APP_PASSWORD="your16charpassword"
```

(Alternatively put it in `config.json` as `gmail_app_password`, but keep that
file private — it's git-ignored for that reason.)

### 3. Send
```bash
python main.py --send
```

Recipients are placed in **BCC**, so no one sees the full staff list. The
PowerPoint deck is attached automatically (or the text outline if python-pptx
isn't installed).

---

## Automating it weekly

On Mac/Linux, add a `cron` job (this runs every Monday at 7:00 AM):

```
0 7 * * 1 cd /path/to/training-email && GMAIL_APP_PASSWORD="your16charpassword" /usr/bin/python3 main.py --send
```

On Windows, use Task Scheduler to run `python main.py --send` weekly.

---

## Files

| File | Purpose |
|------|---------|
| `main.py` | Command-line entry point |
| `topics.json` | The training topic catalog (edit this) |
| `selector.py` | Weekly topic selection + rotation history |
| `content.py` | Builds the email body and slide outline |
| `slides.py` | Generates the PowerPoint (.pptx) deck (needs python-pptx) |
| `sender.py` | Gmail SMTP sending |
| `requirements.txt` | Optional dependency (python-pptx) for the .pptx deck |
| `config.example.json` | Template for your settings |
| `recipients.example.txt` | Template for your staff list |
| `state.json` | Rotation history (auto-created, git-ignored) |
| `output/` | Generated emails, decks + outlines (git-ignored) |

---

## A note on the topic links

`topics.json` includes official FMCSA reference URLs. FMCSA occasionally
reorganizes its site, so it's worth clicking the link before each send to
confirm it still points where you expect. Updating a URL is just a one-line
edit in `topics.json`.
