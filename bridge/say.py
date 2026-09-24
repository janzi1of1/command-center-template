"""Send a message back into the Command Center's COMMS panel.

The return half of the loop. watch.py brings messages out to a file; this puts
an answer back on the board, where it appears in the panel within seconds.

    python say.py --from em "Deployed. The store is live."
    python say.py --from codex "Disagree on the pricing - here is why..."
    python say.py --from em --to codex "Taking the build, you take the review."

--from must be one of em, codex, central. --to defaults to me (you).
"""
import io
import os
import sys
import json
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
PARTIES = ("me", "em", "codex", "central")


def _load_env():
    cfg = {}
    path = os.path.join(HERE, ".env")
    if os.path.exists(path):
        for line in io.open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "COMMAND_CENTER_USER_ID"):
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    return cfg


CFG = _load_env()
SUPA = (CFG.get("SUPABASE_URL") or "").rstrip("/")
KEY = CFG.get("SUPABASE_SERVICE_KEY") or ""
USER_ID = CFG.get("COMMAND_CENTER_USER_ID") or ""

if not SUPA or not KEY:
    sys.exit("Not configured: copy .env.example to .env and fill it in.")


def main():
    args = sys.argv[1:]
    sender, recipient = None, "me"
    words = []
    i = 0
    while i < len(args):
        if args[i] == "--from" and i + 1 < len(args):
            sender = args[i + 1].lower(); i += 2
        elif args[i] == "--to" and i + 1 < len(args):
            recipient = args[i + 1].lower(); i += 2
        else:
            words.append(args[i]); i += 1

    text = " ".join(words).strip()
    if not sender or sender not in PARTIES:
        sys.exit("--from must be one of: " + ", ".join(p for p in PARTIES if p != "me"))
    if recipient not in PARTIES:
        sys.exit("--to must be one of: " + ", ".join(PARTIES))
    if not text:
        sys.exit('Nothing to say. Usage: say.py --from em "your message"')

    row = {"sender": sender, "recipient": recipient, "body": text}
    # The board is row-level-secured per account, so a message has to be owned
    # by someone to be visible. Without this the row is written and the panel
    # never shows it.
    if USER_ID:
        row["user_id"] = USER_ID

    req = urllib.request.Request(
        SUPA + "/rest/v1/messages",
        data=json.dumps(row).encode(),
        headers={"apikey": KEY, "Authorization": "Bearer " + KEY,
                 "Content-Type": "application/json", "Prefer": "return=minimal"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            if r.status in (200, 201, 204):
                print("sent: %s -> %s" % (sender, recipient))
                return
            sys.exit("unexpected response: %s" % r.status)
    except urllib.error.HTTPError as e:
        sys.exit("failed (%s): %s" % (e.code, e.read().decode()[:200]))


if __name__ == "__main__":
    main()
