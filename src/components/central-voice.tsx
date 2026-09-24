// Central's live voice — OpenAI Realtime over WebRTC, embedded in the cockpit.
// No LiveKit, no popup. Tap to call; tap again to hang up. Central can act on the
// board via tools (executed here against Supabase with the user's session).
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getCentralRealtimeToken,
  centralWebSearch,
  emSystemStatus,
  emLeaveForEm,
} from "@/lib/central-voice.functions";
import { toast } from "sonner";

type Status = "idle" | "connecting" | "live" | "error";

// Tool schemas the realtime model can call. Execution happens client-side below.
const TOOLS = [
  {
    type: "function",
    name: "add_task",
    description: "Add a task to your Command Center board.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "The task text." },
        horizon: { type: "string", enum: ["today", "week", "month"] },
      },
      required: ["title"],
    },
  },
  {
    type: "function",
    name: "whats_on_my_plate",
    description: "Read the current open tasks from the board.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "search_web",
    description:
      "Look something up on the LIVE web — weather, news, current facts, prices, anything you don't already know.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "remember",
    description: "Save a durable fact for EM to curate into long-term memory (CORTEX).",
    parameters: {
      type: "object",
      properties: { fact: { type: "string" } },
      required: ["fact"],
    },
  },
  {
    type: "function",
    name: "delegate_to_em",
    description: "Hand a build / research / complex job to EM (Claude).",
    parameters: {
      type: "object",
      properties: { task: { type: "string" } },
      required: ["task"],
    },
  },
  {
    type: "function",
    name: "investigate",
    description:
      "Kick off a DEEP investigation that reads the actual files/database (takes ~a minute).",
    parameters: {
      type: "object",
      properties: { task: { type: "string" } },
      required: ["task"],
    },
  },
];

// EM's line answers a different question: not "what's on today" but "does it
// actually work". So it gets the systems, not the diary.
const EM_TOOLS = [
  {
    type: "function",
    name: "system_status",
    description:
      "Check LIVE whether your sites and the cockpit database are actually up. Use this before answering any question about whether something is up, live, or deployed. Never guess at status.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "leave_for_em",
    description:
      "Queue a real build/fix job for the Claude Code EM, who can write code. Use this whenever you are asked for something to be built, changed, deployed or investigated in the code.",
    parameters: {
      type: "object",
      properties: { task: { type: "string" } },
      required: ["task"],
    },
  },
  TOOLS.find((t) => t.name === "whats_on_my_plate")!,
  TOOLS.find((t) => t.name === "add_task")!,
  TOOLS.find((t) => t.name === "search_web")!,
];

export function CentralVoice({
  userId,
  persona = "central",
}: {
  userId: string;
  persona?: "central" | "em";
}) {
  const [status, setStatus] = useState<Status>("idle");
  // diagnostics for the one-sided-transcript bug (see handleEvent)
  const seenEvents = useRef<Set<string>>(new Set());
  const diagErrors = useRef<string[]>([]);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const busTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef = useRef<string>("");

  const today = () => new Date().toISOString().slice(0, 10);

  // Poll the two-brain bus for replies addressed to Central (EM's answers to
  // delegated jobs, deep-investigation results) and have her speak them.
  async function pollBus() {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    try {
      const { data: rows } = await (supabase as any)
        .from("bus")
        .select("id,type,result")
        .eq("to_brain", "central")
        .eq("status", "new")
        .order("created_at")
        .limit(3);
      for (const row of rows ?? []) {
        // claim first so the same reply is never spoken twice
        await (supabase as any)
          .from("bus")
          .update({ status: "done", processed_at: new Date().toISOString() })
          .eq("id", row.id);
        const text = (row.result?.text ?? "").trim();
        if (!text) continue;
        const instr =
          row.type === "investigate_result"
            ? "Your own deep investigation just came back. Give the key finding briefly in your own voice, no preamble: " +
              text
            : "EM — your builder counterpart (Claude) — just came back on a job you handed off. Relay this naturally and briefly, in your own voice, no preamble: " +
              text;
        dc.send(JSON.stringify({ type: "response.create", response: { instructions: instr } }));
      }
    } catch {
      /* ignore poll errors */
    }
  }

  async function logTurn(sender: "me" | "em", text: string) {
    try {
      await (supabase as any)
        .from("messages")
        .insert({
          user_id: userId,
          sender,
          recipient: sender === "me" ? persona : "me",
          body: "🎙️ " + text.slice(0, 1500),
          status: "handled",
        });
    } catch {
      /* logging is best-effort */
    }
  }

  async function runTool(name: string, args: any): Promise<string> {
    try {
      if (name === "add_task") {
        const h = ["today", "week", "month"].includes(args?.horizon) ? args.horizon : "today";
        await supabase.from("tasks").insert({
          user_id: userId,
          title: String(args?.title ?? "").slice(0, 200),
          horizon: h,
          pile: "signal",
          assigned_to: "me",
          due_date: h === "today" ? today() : null,
        });
        return `Added "${args?.title}" to ${h}.`;
      }
      if (name === "whats_on_my_plate") {
        const { data } = await supabase
          .from("tasks")
          .select("title,horizon")
          .neq("status", "done")
          .order("horizon")
          .limit(15);
        return data?.length
          ? "Open: " + data.map((r: any) => `${r.title} (${r.horizon})`).join("; ")
          : "Nothing open on the board right now.";
      }
      if (name === "search_web") {
        return await centralWebSearch({
          data: { accessToken: tokenRef.current, query: String(args?.query ?? "") },
        });
      }
      if (name === "remember") {
        await (supabase as any).from("bus").insert({
          user_id: userId,
          from_brain: "central",
          to_brain: "em",
          type: "memory_write",
          payload: { fact: args?.fact },
          status: "new",
        });
        return "Got it — I'll remember that.";
      }
      if (name === "delegate_to_em") {
        // Check the write before claiming it happened. On 2026-09-16 Central
        // told the user "I've handed EM a request for today's weather" and no bus
        // row was ever created - the success sentence was hardcoded, so it was
        // true regardless of what the database did. Confirm, or say it failed.
        const { error: busErr } = await (supabase as any).from("bus").insert({
          user_id: userId,
          from_brain: "central",
          to_brain: "em",
          type: "task_request",
          payload: { title: String(args?.task ?? "").slice(0, 80), detail: args?.task },
          status: "new",
        });
        if (busErr) return "That did NOT save — " + busErr.message + ". Say it again?";
        // Also drop it in COMMS addressed to EM, because that is the queue a
        // human can actually see. A bus row nobody renders is a silent one.
        await (supabase as any).from("messages").insert({
          user_id: userId,
          sender: "me",
          recipient: "em",
          status: "new",
          body: "☎️ (via Central) " + String(args?.task ?? "").slice(0, 1500),
        });
        return "Handed to EM and it's in COMMS, marked unread.";
      }
      if (name === "system_status") {
        return await emSystemStatus({ data: { accessToken: tokenRef.current } });
      }
      if (name === "leave_for_em") {
        return await emLeaveForEm({
          data: { accessToken: tokenRef.current, task: String(args?.task ?? "") },
        });
      }
      if (name === "investigate") {
        await (supabase as any).from("bus").insert({
          user_id: userId,
          from_brain: "central",
          to_brain: "central_agent",
          type: "investigate",
          payload: { task: args?.task },
          status: "new",
        });
        return "On it — digging into that now with my tools. I'll tell you what I find in a minute.";
      }
    } catch (e: any) {
      return "That didn't go through — " + (e?.message ?? String(e));
    }
    return "Unknown tool.";
  }

  async function handleEvent(ev: any, dc: RTCDataChannel) {
    // your half of every call went unsaved from 2026-07-13 to 2026-09-16 and
    // nothing said so: the assistant transcript kept writing, so the board
    // looked alive while holding only one side. Record what the server actually
    // sends, so the next failure is readable instead of invisible.
    seenEvents.current.add(ev.type);
    if (ev.type === "error" || ev.error) {
      diagErrors.current.push(
        JSON.stringify(ev.error ?? ev).slice(0, 300),
      );
    }

    // assistant spoken transcript → log to board as Central
    if (ev.type === "response.output_audio_transcript.done" && ev.transcript) {
      logTurn("em", ev.transcript);
    }
    // user speech transcript → log to board as the user.
    // Event names have moved between Realtime API versions, so accept any
    // input-transcription "completed" event rather than one exact string, and
    // read the transcript from either place it has lived.
    if (
      /input_audio_transcription\.(completed|done)$/.test(ev.type ?? "") ||
      (ev.type === "conversation.item.done" && ev.item?.role === "user")
    ) {
      const text =
        ev.transcript ??
        ev.item?.content?.find((c: any) => c.transcript)?.transcript ??
        ev.item?.content?.find((c: any) => c.text)?.text;
      if (text && String(text).trim()) logTurn("me", String(text).trim());
    }
    // tool call
    if (ev.type === "response.function_call_arguments.done") {
      let args: any = {};
      try {
        args = JSON.parse(ev.arguments || "{}");
      } catch {
        /* ignore */
      }
      const result = await runTool(ev.name, args);
      dc.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: ev.call_id, output: result },
        }),
      );
      dc.send(JSON.stringify({ type: "response.create" }));
    }
  }

  async function start() {
    try {
      setStatus("connecting");
      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess.session?.access_token ?? "";
      tokenRef.current = accessToken;
      const tok = await getCentralRealtimeToken({ data: { accessToken, persona } });

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // remote audio (Central's voice)
      const audio = audioRef.current ?? new Audio();
      audio.autoplay = true;
      (audio as any).playsInline = true;
      audioRef.current = audio;
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
        audio.play().catch(() => {});
      };

      // local mic
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = mic;
      mic.getTracks().forEach((t) => pc.addTrack(t, mic));

      // events channel
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onopen = () => {
        dc.send(
          JSON.stringify({
            type: "session.update",
            session: {
              // The GA Realtime API requires session.type. Without it the whole
              // update can be rejected, and a rejected update is silent - which
              // is one candidate for why input transcription never turned on.
              type: "realtime",
              tools: persona === "em" ? EM_TOOLS : TOOLS,
              tool_choice: "auto",
              audio: {
                input: {
                  turn_detection: { type: "server_vad" },
                  transcription: { model: "gpt-4o-mini-transcribe" },
                },
              },
            },
          }),
        );
        setStatus("live");
        if (busTimerRef.current) clearInterval(busTimerRef.current);
        busTimerRef.current = setInterval(pollBus, 4000);
      };
      dc.onmessage = (e) => {
        try {
          handleEvent(JSON.parse(e.data), dc);
        } catch {
          /* ignore malformed */
        }
      };

      // offer → OpenAI → answer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const r = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(tok.model)}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: { Authorization: `Bearer ${tok.value}`, "Content-Type": "application/sdp" },
        },
      );
      if (!r.ok) throw new Error(`WebRTC ${r.status}: ${(await r.text()).slice(0, 140)}`);
      await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
    } catch (e: any) {
      console.error("[central-voice]", e);
      toast.error("Central voice: " + (e?.message ?? String(e)));
      setStatus("error");
      teardown(false);
    }
  }

  function teardown(resetIdle = true) {
    if (busTimerRef.current) {
      clearInterval(busTimerRef.current);
      busTimerRef.current = null;
    }
    try {
      dcRef.current?.close();
    } catch {
      /* ignore */
    }
    try {
      pcRef.current?.close();
    } catch {
      /* ignore */
    }
    try {
      micRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    // One diagnostic row per call, so a broken transcript can be read out of
    // the database instead of needing someone to watch a browser console.
    // Only speak up when something is WRONG. A healthy call writes nothing -
    // a diagnostic on every call is noise, and noise gets ignored, which is how
    // the original bug survived two months. Root cause was a session.update
    // missing session.type:"realtime": the GA API rejected it silently, input
    // transcription stayed off, and your half of every call vanished while
    // Central's kept saving, so the board looked fine.
    if (seenEvents.current.size) {
      const types = [...seenEvents.current].sort();
      const sawUser = types.some((t) => t.includes("input_audio_transcription"));
      if (!sawUser || diagErrors.current.length) {
        void logTurn(
          "em",
          "⚠️ DIAG voice call — user transcript events: " +
            (sawUser ? "YES" : "NONE — your side of this call was NOT saved") +
            (diagErrors.current.length
              ? " | errors: " + diagErrors.current.slice(0, 3).join(" ~ ")
              : "") +
            " | events: " +
            types.join(", "),
        );
      }
      seenEvents.current = new Set();
      diagErrors.current = [];
    }
    dcRef.current = null;
    pcRef.current = null;
    micRef.current = null;
    if (resetIdle) setStatus("idle");
  }

  const busy = status === "live" || status === "connecting";
  const who = persona === "em" ? "EM" : "CENTRAL";
  const label =
    status === "connecting"
      ? "◍ …"
      : status === "live"
        ? `◉ ${who}`
        : `📞 ${who}`;

  return (
    <>
      {/* In-DOM audio element — reliable playback on mobile (iOS/Safari) */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      <button
        onClick={() => (busy ? teardown() : start())}
        title={busy ? "End Central voice call" : "Call Central — live voice (OpenAI)"}
        className={`mono text-[10px] tracking-widest px-2 py-1 border rounded-sm ${
          busy
            ? "border-primary text-primary bg-primary/10 animate-pulse"
            : "border-border text-muted-foreground hover:text-primary"
        }`}
      >
        {label}
      </button>
    </>
  );
}
