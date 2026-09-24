# Command Center

A single board for running a business: today's work split into three phases,
the week and the month above it, the ventures you are running, and a message
panel. One person, several businesses, one screen.

It runs on your own Supabase project and deploys as a Cloudflare Worker. Nothing
is shared with anyone else — your data lives in a database only you control.

---

## Setting it up

You need a [Supabase](https://supabase.com) account and a
[Cloudflare](https://dash.cloudflare.com) account. Both have free tiers that are
enough for this.

### 1. Make a Supabase project

Create one at [supabase.com/dashboard](https://supabase.com/dashboard). When it
finishes, open **SQL Editor**, paste in the whole of:

```
supabase/migrations/20260923000000_full_schema.sql
```

and run it. That builds all thirteen tables with row level security switched on,
so every row is tied to the account that created it.

Then, from **Project Settings → API**, copy two things:

- the **Project URL**
- the **publishable / anon key**

### 2. Point the app at it

```bash
cp .env.example .env
```

and fill in those two values. There is deliberately no fallback: if these are
missing the app refuses to start rather than quietly connecting to somebody
else's database.

### 3. Run it

```bash
npm install
npm run dev
```

Open the address it prints, create an account, and you have an empty board.

### 4. Put it online

```bash
powershell -ExecutionPolicy Bypass -File deploy.ps1
```

It builds and deploys to Cloudflare Workers. Set `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in your environment first, and change the worker `name`
in `.output/server/wrangler.json` so it does not collide with anyone else's.

> This is a Cloudflare **Worker**, not Pages. Pushing to GitHub deploys nothing —
> you have to run the deploy script.

---

## What is in it

| | |
|---|---|
| **Ventures** | the businesses you are running, with phase plans on each |
| **Today** | dawn / midday / dusk, with a traffic light per item |
| **This week** and **This month** | longer horizons that feed into the day |
| **Comms** | messages between you and whatever assistants you wire up |
| **Personal** | kept behind the focus button, out of the way |

Tasks carry an owner, a venture tag and a schedule, and move from month to week
to day as their date approaches.

---

## The tables

Thirteen, all row-level-secured to the signed-in user:

`ventures` · `venture_phases` · `tasks` · `goals` · `results` · `milestones` ·
`habits` · `habit_logs` · `reminders` · `upcoming_payments` · `messages` ·
`bus` · `health_runs`

The migration is generated from a live database rather than written by hand, so
it matches what actually runs.

---

## Talking to AI assistants

The **Comms** panel is a table — `messages`, with a sender, a recipient and a
body. On its own it is a notes feed. `bridge/` is what makes it two-way:

```
you type in Comms         ->  a row is inserted
bridge/watch.py notices   ->  appends it to "EM INBOX.md" on disk
your assistant reads that file and replies with:
    python bridge/say.py --from em "..."
                          ->  a row is inserted
the panel shows it        <-
```

So an assistant running on your machine — Claude Code, Codex, anything that can
read a file and run a command — can read what you write on the board and answer
you there. Point `INBOX_DIR` at the folder it works out of and it will find the
file on its own.

See `bridge/README.md`. It needs the **service** key, so it stays on your
machine and never ships with the app.

The four parties (`me`, `em`, `codex`, `central`) are fixed by a CHECK
constraint on the `messages` table — change it in the migration if you want
different names.

---

## A word on the optional pieces

Some parts of the original expect services that are not included here — a voice
assistant, a site health checker, agents that post into `comms`. They are not
required. The board works on its own, and those panels simply stay empty until
something writes to them.

---

## Licence

Use it, change it, run it for yourself. No warranty.
