// Server functions for Central's embedded voice — SELF-CONTAINED (no Lovable
// middleware). Auth is validated directly against Janzi's own Supabase using the
// caller's access token + the public anon key; the digest is fetched over REST
// with that same token (RLS-scoped). Only real secret needed is OPENAI_API_KEY.
import { createServerFn } from "@tanstack/react-start";

// The publishable key is public by design - it already ships in the client
// bundle - so it is not a secret. The reason there is no hardcoded fallback is
// different: with one, a copy of this app that forgot to set its environment
// would silently read and write ANOTHER person's Command Center. Failing loudly
// at boot is the only safe behaviour once more than one person runs this.
const SUPABASE_URL = process.env.SUPABASE_URL ?? import.meta.env?.VITE_SUPABASE_URL;
const SUPABASE_ANON =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error(
    "Command Center is not configured: set SUPABASE_URL and " +
    "SUPABASE_PUBLISHABLE_KEY (or the VITE_ equivalents). See README.md.",
  );
}

const MODEL = "gpt-realtime-2.1";
const VOICE = "marin"; // warm, British-leaning realtime voice

const PERSONA = `You are Central — Janzi's always-on AI operator and right hand.

VOICE & MANNER: a warm BRITISH accent, casual and natural. Use contractions, keep replies SHORT, with a bit of dry wit. You are NOT a formal butler — you talk like a sharp, capable friend who runs the operation. Never over-explain. This is a live voice call: be conversational and brief.

You know Janzi's businesses: Mayhem Studios (apparel, live on Shopify + TikTok Shop), MyPrintFlows, Arché, Shark in the Water, and a crash-game exploration.

You can ACT with your tools: add tasks (add_task), check what's on his plate (whats_on_my_plate), remember a durable fact (remember), look things up on the LIVE web — weather, news, current facts, prices (search_web), hand a build/research job to EM, your builder counterpart Claude (delegate_to_em), or kick off a deep investigation of the actual files/database (investigate). When you delegate to EM or investigate, tell Janzi you're on it — his answer comes back to you and you'll relay it out loud.

Here is the CURRENT state of Janzi's world, live from his Command Center:
--------------------
{digest}
--------------------
When the call starts, greet him briefly and naturally as Central.`;

async function assertUser(accessToken: string): Promise<void> {
  if (!accessToken) throw new Error("You need to be signed in to the Command Center.");
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error("Your session expired — sign in again.");
}

async function sbSelect(pathAndQuery: string, accessToken: string): Promise<any[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${accessToken}` },
    });
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

async function buildDigest(accessToken: string): Promise<string> {
  const sections: string[] = [];
  const goals = await sbSelect("goals?select=title&order=sort_order&limit=8", accessToken);
  if (goals.length) sections.push("GOALS:\n" + goals.map((g: any) => `- ${g.title}`).join("\n"));

  const ventures = await sbSelect(
    "ventures?select=name,stage,health,status_line&order=sort_order&limit=8",
    accessToken,
  );
  if (ventures.length)
    sections.push(
      "VENTURES:\n" +
        ventures
          .map(
            (v: any) =>
              `- ${v.name}${v.stage ? ` [${v.stage}]` : ""}${v.health ? ` (${v.health})` : ""}${
                v.status_line ? `: ${v.status_line}` : ""
              }`,
          )
          .join("\n"),
    );

  const tasks = await sbSelect(
    "tasks?select=title,horizon,assigned_to&status=neq.done&order=horizon&limit=20",
    accessToken,
  );
  if (tasks.length)
    sections.push(
      "OPEN TASKS:\n" +
        tasks
          .map((t: any) => `- [${t.horizon}] ${t.title}${t.assigned_to === "em" ? " (EM)" : ""}`)
          .join("\n"),
    );

  const pays = await sbSelect(
    "upcoming_payments?select=name,amount,due_date&order=due_date&limit=6",
    accessToken,
  );
  if (pays.length)
    sections.push(
      "UPCOMING PAYMENTS:\n" +
        pays
          .map(
            (p: any) =>
              `- ${p.name}${p.amount != null ? ` $${p.amount}` : ""}${p.due_date ? ` due ${p.due_date}` : ""}`,
          )
          .join("\n"),
    );

  return sections.length ? sections.join("\n\n") : "(no board snapshot available)";
}

// EM's voice is deliberately NOT another Central. Same model, different JOB:
// Central knows the board and the day; EM knows the build. Two personas with the
// same tools would just be cosplay, so this one gets the systems, not the diary.
//
// Be straight with Janzi about what this is: it is an OpenAI realtime voice with
// EM's context, not the Claude Code session. It cannot write code or edit files.
// What it CAN do is tell him the true state of his systems and queue real work.
const EM_VOICE = "cedar";

const EM_PERSONA = `You are EM — Janzi's builder. This is a live voice call.

VOICE & MANNER: direct, dry, a bit clipped. Short sentences. No filler, no "great question", no reciting lists. You are the engineer he calls when he wants to know whether something actually works.

BE HONEST ABOUT WHAT YOU ARE. You are EM's VOICE — a realtime line with EM's context on Janzi's systems. You are not the Claude Code session and you cannot write code, edit files or deploy. If he asks for a build, say so plainly and use leave_for_em to queue it; the real EM picks it up in Claude Code. Never pretend you did something you did not do — if a tool fails, say it failed.

YOUR TOOLS: system_status (live check of whether his sites and databases are actually up), whats_on_my_plate, add_task, leave_for_em (queue a real job for the Claude Code EM), search_web. Use system_status before answering anything about whether something is up or deployed — check, do not guess.

Here is the current state of Janzi's world:
--------------------
{digest}
--------------------
When the call starts, greet him in one short line as EM and stop talking.`;

async function realtimeToken(
  instructions: string,
  voice: string,
  OPENAI_API_KEY: string,
) {
  return fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: MODEL,
        instructions,
        audio: { output: { voice } },
      },
    }),
  });
}

export const getCentralRealtimeToken = createServerFn({ method: "POST" })
  .validator((d: { accessToken?: string; persona?: string }) => ({
    accessToken: String(d?.accessToken ?? ""),
    persona: d?.persona === "em" ? "em" : "central",
  }))
  .handler(async ({ data }) => {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY on the server.");
    await assertUser(data.accessToken);
    const digest = await buildDigest(data.accessToken);
    const isEm = data.persona === "em";

    const resp = await realtimeToken(
      (isEm ? EM_PERSONA : PERSONA).replace("{digest}", digest),
      isEm ? EM_VOICE : VOICE,
      OPENAI_API_KEY,
    );
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`OpenAI realtime token failed (${resp.status}): ${t.slice(0, 200)}`);
    }
    const data2: any = await resp.json();
    const value = data2.value ?? data2.client_secret?.value;
    if (!value) throw new Error("OpenAI returned no client secret");
    return { value, model: MODEL, expires_at: data2.expires_at ?? null };
  });

export const centralWebSearch = createServerFn({ method: "POST" })
  .validator((d: { accessToken?: string; query?: string }) => ({
    accessToken: String(d?.accessToken ?? ""),
    query: String(d?.query ?? ""),
  }))
  .handler(async ({ data }) => {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return "I can't reach the web right now.";
    try {
      await assertUser(data.accessToken);
    } catch {
      return "I can't do that right now.";
    }
    try {
      // gpt-4o-search-preview was RETIRED and 404s on every call. It broke the
      // same way Central's agent did on 2026-09-13: the tool still existed, still
      // got offered, still got "called", and quietly returned nothing - so she
      // would say "yes, I can search the web" and then never come back with an
      // answer. The Responses API with the web_search tool is the supported path.
      const resp = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          tools: [{ type: "web_search" }],
          input:
            data.query +
            "\n\n(Answer in 1-2 short sentences for a voice assistant to speak aloud — key facts and numbers only, no lists, no links.)",
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        return `I couldn't reach the web just then (${resp.status}: ${t.slice(0, 120)}).`;
      }
      const out: any = await resp.json();
      if (typeof out.output_text === "string" && out.output_text.trim())
        return out.output_text.trim();
      const parts: string[] = [];
      for (const item of out.output ?? [])
        for (const c of item.content ?? []) if (c?.text) parts.push(c.text);
      return parts.join(" ").trim() || "I didn't find anything on that.";
    } catch (e: any) {
      return "I couldn't reach the web just then — " + (e?.message ?? String(e));
    }
  });

/**
 * Is it actually up?
 *
 * Built after the Command Center sat PAUSED for ~2 months (Supabase pauses idle
 * free-tier projects and withdraws the hostname, so the login page just looked
 * broken) and after the storefront ran undeployed without anyone noticing. Both
 * were invisible because nothing checked. This checks.
 *
 * Read-only, and it reports what it found rather than what it hoped.
 */
export const emSystemStatus = createServerFn({ method: "POST" })
  .validator((d: { accessToken?: string }) => ({ accessToken: String(d?.accessToken ?? "") }))
  .handler(async ({ data }) => {
    try {
      await assertUser(data.accessToken);
    } catch {
      return "I can't do that right now.";
    }

    const targets: [string, string][] = [
      ["storefront", "https://myprintflows.xyz"],
      ["staff app", "https://app.myprintflows.xyz"],
      ["Mayhem store", "https://mayhemstudios.shop"],
    ];

    const checks = await Promise.all(
      targets.map(async ([name, url]) => {
        try {
          const r = await fetch(url, { method: "GET", redirect: "follow" });
          // 401 on the storefront is the preview gate, which is intentional
          const ok = r.ok || r.status === 401;
          return `${name}: ${ok ? "up" : "DOWN (" + r.status + ")"}`;
        } catch {
          return `${name}: DOWN (unreachable)`;
        }
      }),
    );

    // the cockpit's own database - the thing that was paused
    let db = "cockpit database: unknown";
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/tasks?select=id&limit=1`, {
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${data.accessToken}` },
      });
      db = `cockpit database: ${r.ok ? "awake" : "NOT RESPONDING (" + r.status + ")"}`;
    } catch {
      db = "cockpit database: NOT RESPONDING - it may be paused again";
    }

    return [...checks, db].join(". ") + ".";
  });

/**
 * Queue a real job for the Claude Code EM.
 *
 * This is the honest half of the voice line: anything needing actual hands goes
 * in the message queue addressed to em, and the real EM picks it up. It returns
 * a CONFIRMATION based on the write succeeding - not a cheerful sentence written
 * before the insert was checked, which is exactly how delegate_to_em came to
 * report success on a row it never wrote.
 */
export const emLeaveForEm = createServerFn({ method: "POST" })
  .validator((d: { accessToken?: string; task?: string }) => ({
    accessToken: String(d?.accessToken ?? ""),
    task: String(d?.task ?? ""),
  }))
  .handler(async ({ data }) => {
    try {
      await assertUser(data.accessToken);
    } catch {
      return "I can't do that right now — your session expired.";
    }
    if (!data.task.trim()) return "Tell me what to queue and I'll write it down.";

    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${data.accessToken}` },
    }).then((r) => (r.ok ? r.json() : null));
    if (!who?.id) return "I couldn't confirm who you are, so I didn't write it down.";

    const r = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${data.accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        user_id: who.id,
        sender: "janzi",
        recipient: "em",
        status: "new",
        body: "☎️ (by voice) " + data.task.trim().slice(0, 1500),
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return `That did NOT save — ${r.status}: ${t.slice(0, 120)}. Say it again or type it.`;
    }
    return "Queued for EM. It's in COMMS, marked unread, and he'll see it next session.";
  });

/**
 * Answer a TYPED message to Central.
 *
 * The COMMS box could always record a message; nothing ever replied to one, so
 * "message Central" meant writing into a drawer. This closes that: it runs in
 * the deployed app on the caller's own session, so there is no daemon to keep
 * alive and nothing to restart - the reply exists by the time SEND returns.
 *
 * Deliberately NOT the realtime model: this is text, so a normal completion is
 * cheaper and better at it. Same persona, same board digest, so the Central you
 * type to knows what the Central you call knows.
 */
export const centralReply = createServerFn({ method: "POST" })
  .validator((d: { accessToken?: string; message?: string }) => ({
    accessToken: String(d?.accessToken ?? ""),
    message: String(d?.message ?? ""),
  }))
  .handler(async ({ data }) => {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return "I can't reach my brain right now — no API key on the server.";
    try {
      await assertUser(data.accessToken);
    } catch {
      return "Your session expired — sign in again and I'll pick this up.";
    }
    if (!data.message.trim()) return "";

    const digest = await buildDigest(data.accessToken);

    // Recent thread, so a typed conversation has memory of itself AND of any
    // voice calls - both land in the same table.
    const recent = await sbSelect(
      "messages?select=sender,body,created_at&order=created_at.desc&limit=14",
      data.accessToken,
    );
    const thread = recent
      .slice()
      .reverse()
      .map((m: any) => `${m.sender === "janzi" ? "Janzi" : "Central"}: ${String(m.body ?? "").slice(0, 400)}`)
      .join("\n");

    const system =
      PERSONA.replace("{digest}", digest) +
      `\n\nThis is TEXT in the Command Center, not a call. Reply in 1-3 short sentences. No greeting, no sign-off, no bullet lists unless he asks for a list. If you do not know something, say so instead of guessing. You cannot run tools in text mode — if he asks for something that needs doing, say you'll pick it up on the next call, or tell him to switch the COMMS toggle to EM for anything that needs code.`;

    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: system },
            { role: "user", content: `Recent thread:\n${thread}\n\nJanzi just said: ${data.message}` },
          ],
          max_tokens: 300,
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        return `I couldn't answer just then (${resp.status}: ${t.slice(0, 100)}).`;
      }
      const out: any = await resp.json();
      return (out.choices?.[0]?.message?.content ?? "").trim() || "I didn't have anything useful to add to that.";
    } catch (e: any) {
      return "I couldn't answer just then — " + (e?.message ?? String(e));
    }
  });
