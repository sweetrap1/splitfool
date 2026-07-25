"""Weekly training topic selection.

Picks a new FMCSA training topic each week, avoiding recent repeats.
Selection history is stored in state.json so the rotation continues
where it left off from one run to the next.
"""

import json
import os
from datetime import date, datetime

TOPICS_FILE = os.path.join(os.path.dirname(__file__), "topics.json")
STATE_FILE = os.path.join(os.path.dirname(__file__), "state.json")


def load_topics(path=TOPICS_FILE):
    """Return the list of topic dicts from topics.json."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    topics = data.get("topics", [])
    if not topics:
        raise ValueError(f"No topics found in {path}")
    return topics


def load_state(path=STATE_FILE):
    """Return persisted state, or a fresh empty state if none exists."""
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"history": []}


def save_state(state, path=STATE_FILE):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def _iso_week_key(d):
    """A stable 'YYYY-Www' key for the ISO week containing date d."""
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def select_topic(topics, state, for_date=None):
    """Choose the topic for the given date's week.

    Rules:
    - If this ISO week was already assigned a topic, return that same topic
      (re-running mid-week is safe and idempotent).
    - Otherwise pick the topic used least recently (or never used), so the
      full catalog cycles before anything repeats.

    Returns (topic_dict, week_key, already_assigned_bool).
    """
    for_date = for_date or date.today()
    week_key = _iso_week_key(for_date)
    history = state.get("history", [])

    # Already picked something for this week? Reuse it.
    for entry in history:
        if entry.get("week") == week_key:
            topic = next((t for t in topics if t["id"] == entry["topic_id"]), None)
            if topic:
                return topic, week_key, True

    # Rank topics by how recently they were used (never-used first).
    last_used_index = {}
    for i, entry in enumerate(history):
        last_used_index[entry["topic_id"]] = i

    def sort_key(t):
        # Topics never used sort before used ones; among used, oldest first.
        return last_used_index.get(t["id"], -1)

    ordered = sorted(topics, key=sort_key)
    chosen = ordered[0]
    return chosen, week_key, False


def record_selection(state, topic, week_key, path=STATE_FILE):
    """Persist that `topic` was chosen for `week_key`."""
    state.setdefault("history", []).append({
        "week": week_key,
        "topic_id": topic["id"],
        "title": topic["title"],
        "selected_at": datetime.now().isoformat(timespec="seconds"),
    })
    save_state(state, path)
    return state
