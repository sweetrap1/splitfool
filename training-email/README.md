# Weekly FMCSA Training Email Automation

Picks a new commercial-vehicle safety training topic every week (sourced from
[fmcsa.dot.gov](https://www.fmcsa.dot.gov/)), writes a ready-to-send email and a
slide-by-slide outline you can drop into PowerPoint or Google Slides, and can
email the whole thing to your staff list through Gmail.

Nothing is emailed unless you explicitly pass `--send`.

---

## Quick start

No installation needed — it uses only the Python standard library (Python 3.8+).

```bash
cd training-email
python main.py
```

That picks this week's topic, prints a preview, and saves two files in
`output/`:

- `<date>_<topic>_email.txt` — the email subject and body
- `<date>_<topic>_slides.txt` — the slide outline

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

## Turning the outline into slides

The `_slides.txt` file has one entry per slide (title + bullets). To build the
deck, paste it into PowerPoint's **Outline View** or Google Slides, or ask me to
generate an actual `.pptx` from it — that's a natural next step.

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

Recipients are placed in **BCC**, so no one sees the full staff list. The slide
outline is attached automatically. Once you've built a real `.pptx` deck, you
can attach that instead (ask me and I'll wire it in).

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
| `sender.py` | Gmail SMTP sending |
| `config.example.json` | Template for your settings |
| `recipients.example.txt` | Template for your staff list |
| `state.json` | Rotation history (auto-created, git-ignored) |
| `output/` | Generated emails + outlines (git-ignored) |

---

## A note on the topic links

`topics.json` includes official FMCSA reference URLs. FMCSA occasionally
reorganizes its site, so it's worth clicking the link before each send to
confirm it still points where you expect. Updating a URL is just a one-line
edit in `topics.json`.
