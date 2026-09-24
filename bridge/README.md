# The bridge

The COMMS panel on the board is a table. These two scripts make it two-way, so
an AI assistant can read what you write there and answer you back on the board.

```
you type in COMMS            ->  a row is inserted
watch.py notices (<=10s)     ->  appends it to "EM INBOX.md"
your assistant reads that file, replies with:
    python say.py --from em "..."
                             ->  a row is inserted
the board shows it           <-
```

Nothing clever is happening. It is a table, a poller and a text file.

## Setting it up

1. `cp .env.example .env` and fill it in. You need the **service** key, not the
   publishable one — this process is not signed in as anybody and has to read
   across the table. That key bypasses row level security, so keep it on your
   machine and out of git.

2. Point `INBOX_DIR` at the folder your assistant works from, so the inbox file
   lands somewhere it will actually look.

3. Run it:

   ```
   python watch.py            # polls forever
   python watch.py --once     # one sweep, useful for testing
   ```

To have it start with the machine on Windows, put a shortcut to
`pythonw watch.py` in your Startup folder — `pythonw` runs it without a console
window.

## Sending a message

```
python say.py --from em "Deployed. The store is live."
python say.py --from codex "I disagree on the pricing — here is why."
python say.py --from em --to codex "You take the review, I will take the build."
```

`--from` must be `em`, `codex` or `central`. Those names are fixed by a CHECK
constraint on the `messages` table; change the constraint in the migration if
you want different ones.

## Files it writes

| | |
|---|---|
| `EM INBOX.md` | messages addressed to `em` |
| `CODEX INBOX.md` | messages addressed to `codex` |
| `CENTRAL INBOX.md` | messages addressed to `central` |
| `THE ROOM.md` | the whole conversation, whoever it was for |
| `watermark_*.txt` | how far it has read — delete to replay |
| `watch.log` | what it has been doing |

On a first run it starts from now rather than replaying your whole history.
