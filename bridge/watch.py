"""Carry messages from the Command Center out to your AI assistants.

The COMMS panel is a table. This is the thing that makes it two-way: it polls
that table and writes whatever is addressed to an assistant into a plain
markdown file on disk, where Claude Code or Codex will read it. say.py is the
return path.

There is no magic in it. Type in COMMS, a row is inserted; this notices within
ten seconds and appends it to that assistant's inbox file; the assistant reads
the file and replies with say.py, which inserts a row that shows up back in the
panel. That is the whole loop.

    python watch.py            poll forever
    python watch.py --once     one sweep, then exit

Configure it with a .env next to this file - see .env.example. Nothing is
hardcoded, so this runs on any machine and against any project.
"""
import io
import os
import re
import sys
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------- config ----
def _load_env():
    """A .env beside this file, falling back to the real environment."""
    cfg = {}
    path = os.path.join(HERE, ".env")
    if os.path.exists(path):
        for line in io.open(path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "INBOX_DIR", "POLL_SECONDS"):
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    return cfg


CFG = _load_env()
SUPA = (CFG.get("SUPABASE_URL") or "").rstrip("/")

# The SERVICE key, not the publishable one. Rows are row-level-secured to the
# account that wrote them, and this process is not signed in as anybody - it
# needs to read across the table. Keep it out of the app and out of git.
KEY = CFG.get("SUPABASE_SERVICE_KEY") or ""

# Where the inbox files are written. Point this at whatever folder your
# assistant actually works out of, or leave it beside this script.
INBOX_DIR = CFG.get("INBOX_DIR") or HERE
POLL = int(CFG.get("POLL_SECONDS") or 10)

# Who can be written to. These must match the CHECK constraint on messages.
AGENTS = ["em", "codex", "central"]

if not SUPA or not KEY:
    sys.exit("Not configured: copy .env.example to .env and fill it in.")

H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}
LOG = os.path.join(HERE, "watch.log")


def rest(path):
    req = urllib.request.Request(SUPA + "/rest/v1/" + path, headers=H)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode()
    return json.loads(raw) if raw.strip() else []


def note(line):
    print("%s  %s" % (datetime.now().strftime("%H:%M:%S"), line))
    try:
        with io.open(LOG, "a", encoding="utf-8") as f:
            f.write("%s  %s\n" % (datetime.now().isoformat(timespec="seconds"), line))
    except Exception:
        pass


HEADER = """# {who} INBOX — from the Command Center

Messages addressed to **{who}** from the board. Written by `bridge/watch.py`,
append-only — do not edit by hand.

Reply with:

    python bridge/say.py --from {lower} "your message"

which puts your answer back in the COMMS panel.

---
"""


def _append(path, header, body):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    if not os.path.exists(path):
        io.open(path, "w", encoding="utf-8").write(header)
    with io.open(path, "a", encoding="utf-8") as f:
        f.write(body)


def _mark_path(name):
    return os.path.join(HERE, "watermark_%s.txt" % re.sub(r"\W", "", name))


def _since(name):
    try:
        return io.open(_mark_path(name), encoding="utf-8").read().strip()
    except Exception:
        # First run: start from now rather than replaying the whole history.
        # Timezone-aware, because the column is timestamptz - a naive value
        # compares wrong either side of the machine's offset.
        return datetime.now(timezone.utc).isoformat(timespec="seconds")


def deliver(agent):
    """Anything addressed to this agent since we last looked."""
    since = _since(agent)
    try:
        rows = rest("messages?select=sender,recipient,body,created_at"
                    "&recipient=eq.%s&created_at=gt.%s"
                    "&order=created_at.asc&limit=200"
                    % (agent, urllib.parse.quote(since, safe="")))
    except Exception as e:
        note("read failed for %s: %s" % (agent, str(e)[:90]))
        return 0
    if not rows:
        return 0

    body = "".join(
        "\n## %s · from %s\n\n%s\n" % (
            (m.get("created_at") or "")[:19].replace("T", " "),
            (m.get("sender") or "?").upper(),
            (m.get("body") or "").strip())
        for m in rows)

    path = os.path.join(INBOX_DIR, "%s INBOX.md" % agent.upper())
    try:
        _append(path, HEADER.format(who=agent.upper(), lower=agent), body)
    except Exception as e:
        note("could not write %s: %s" % (path, str(e)[:90]))
        return 0

    # Advance only after a successful write, so a failure is retried rather
    # than silently skipped forever.
    io.open(_mark_path(agent), "w", encoding="utf-8").write(rows[-1]["created_at"])
    note("%d message(s) -> %s" % (len(rows), os.path.basename(path)))
    return len(rows)


ROOM_HEADER = """# THE ROOM — the whole conversation

Every message between you and your assistants, in order. Written by
`bridge/watch.py`, append-only.

---
"""


def mirror_room():
    """One transcript of everything, whoever it was addressed to."""
    since = _since("room")
    try:
        rows = rest("messages?select=sender,recipient,body,created_at"
                    "&created_at=gt.%s&order=created_at.asc&limit=200"
                    % urllib.parse.quote(since, safe=""))
    except Exception as e:
        note("room read failed: %s" % str(e)[:90])
        return 0
    if not rows:
        return 0
    body = "".join(
        "\n**%s → %s** · %s\n\n%s\n" % (
            (m.get("sender") or "?").upper(),
            (m.get("recipient") or "?").upper(),
            (m.get("created_at") or "")[:19].replace("T", " "),
            (m.get("body") or "").strip())
        for m in rows)
    try:
        _append(os.path.join(INBOX_DIR, "THE ROOM.md"), ROOM_HEADER, body)
    except Exception as e:
        note("could not write THE ROOM.md: %s" % str(e)[:90])
        return 0
    io.open(_mark_path("room"), "w", encoding="utf-8").write(rows[-1]["created_at"])
    note("mirrored %d turn(s) into THE ROOM.md" % len(rows))
    return len(rows)


def sweep():
    n = sum(deliver(a) for a in AGENTS)
    return n + mirror_room()


def main():
    once = "--once" in sys.argv
    note("watching %s -> %s (%s)"
         % (SUPA.split("//")[-1][:28], INBOX_DIR,
            "one sweep" if once else "every %ds" % POLL))
    while True:
        try:
            sweep()
        except Exception as e:
            note("sweep error: %s" % str(e)[:120])
        if once:
            return
        time.sleep(POLL)


if __name__ == "__main__":
    main()
