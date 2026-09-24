import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Circle,
  Crosshair,
  Dumbbell,
  Flag,
  LogOut,
  Plus,
  Power,
  Repeat,
  Satellite,
  Target,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CentralVoice } from "@/components/central-voice";
import {
  loadAll,
  type Goal,
  type Habit,
  type HabitLog,
  type Milestone,
  type Result,
  type Task,
  type UpcomingPayment,
  type Venture,
} from "@/lib/command-center-data";
import { WORKOUT_PLAN_LEN, workoutForDay, weekOfDay } from "@/lib/workout-plan";
import { toast } from "sonner";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "COMMAND CENTER" },
      { name: "description", content: "Personal mission-control: goals, tasks, habits, results." },
    ],
  }),
  component: CommandCenter,
});

/* ---------------- clock ---------------- */
function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
const pad = (n: number) => n.toString().padStart(2, "0");

/* ---------------- helpers ---------------- */
// LOCAL date (not UTC) — the board is day-driven, so local day is what matters.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// The current Mon–Sun week as an ordered list of days.
function weekDays(): { date: string; short: string; dow: number }[] {
  const d = new Date();
  const dow = d.getDay(); // 0=Sun..6=Sat
  const mon = new Date(d);
  mon.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  const out: { date: string; short: string; dow: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(mon);
    dd.setDate(mon.getDate() + i);
    out.push({ date: ymd(dd), short: dd.toLocaleDateString("en-US", { weekday: "short" }), dow: dd.getDay() });
  }
  return out;
}
function computeStreak(logs: HabitLog[], habitId: string) {
  const set = new Set(
    logs.filter((l) => l.habit_id === habitId && l.done).map((l) => l.log_date),
  );
  let streak = 0;
  const d = new Date();
  for (;;) {
    const key = d.toISOString().slice(0, 10);
    if (set.has(key)) {
      streak++;
      d.setUTCDate(d.getUTCDate() - 1);
    } else break;
  }
  return streak;
}

/* ---------------- main ---------------- */
function CommandCenter() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const now = useClock();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        navigate({ to: "/auth" });
      } else {
        setUserId(data.user.id);
      }
    });
  }, [navigate]);

  const { data, isLoading } = useQuery({
    queryKey: ["command-center", userId],
    enabled: !!userId,
    queryFn: async () => {
      // ensureSeed() used to run here. It refills the board with demo goals and
      // tasks any time it finds goals empty - which made a deliberate wipe
      // impossible: the board was cleared, the cockpit was opened, and it
      // immediately reinstated a set of example goals. An empty board is now
      // a legitimate state. The seed stays in the codebase for a genuinely new
      // account; it just no longer fires on every load.
      return loadAll(userId!);
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["command-center", userId] });

  // SAVE & SYNC. Every panel already writes straight to the database, so
  // nothing here is "unsaved" - what was missing is EM and Codex being TOLD.
  // This posts a snapshot of the board into COMMS addressed to EM; the watcher
  // carries it to EM INBOX.md and mirrors it into THE ROOM.md, which Codex
  // reads. One button, and both of them know what changed.
  const [syncing, setSyncing] = useState(false);
  async function syncToAgents() {
    if (syncing || !data) return;
    setSyncing(true);
    try {
      const { goals: g, tasks: t, ventures: v, milestones: m } = data;
      const open = t.filter((x: any) => x.status !== "done");
      const lines = [
        "BOARD SNAPSHOT — " + new Date().toLocaleString(),
        "",
        "OBJECTIVES (" + g.length + ")",
        ...g.map((x: any) => "  - " + x.title),
        "",
        "VENTURES (" + v.length + ")",
        ...v.map(
          (x: any) =>
            "  - " + x.name + " [" + (x.health ?? "?") + "] " + (x.stage ?? "") +
            (x.focus ? " — focus: " + x.focus : ""),
        ),
        "",
        "OPEN TASKS (" + open.length + ")",
        ...open.map((x: any) => "  - [" + (x.horizon ?? "?") + "] " + x.title),
        "",
        "MILESTONES (" + m.length + ")",
      ];
      const { error } = await (supabase as any).from("messages").insert({
        user_id: userId,
        sender: "me",
        recipient: "em",
        status: "new",
        body: lines.join(String.fromCharCode(10)),
      });
      if (error) toast.error("Sync failed — " + error.message);
      else toast.success("Synced — EM and Codex have the board.");
    } catch (e: any) {
      toast.error("Sync failed — " + (e?.message ?? String(e)));
    } finally {
      setSyncing(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  if (!userId || isLoading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background hud-grid">
        <div className="mono text-xs text-primary tracking-widest animate-pulse">
          ◉ BOOTING COMMAND CENTER…
        </div>
      </div>
    );
  }

  const { goals, tasks, habits, habitLogs, results, milestones, ventures } = data;

  return (
    <div className={`min-h-screen bg-background text-foreground ${focusMode ? "focus-mode" : ""}`}>
      <TopBar
        now={now}
        focusMode={focusMode}
        onToggleFocus={() => setFocusMode((f) => !f)}
        onSignOut={signOut}
        onSync={syncToAgents}
        syncing={syncing}
        userId={userId}
        ventures={ventures}
        onChange={invalidate}
      />

      <main className="px-3 sm:px-4 py-4 space-y-4 max-w-[1600px] mx-auto">
        {/* Ventures leads: the cockpit exists to run the businesses, so the
            portfolio is the first thing read after the message feed. No
            data-focus-hide here - a panel promoted to the top should not
            vanish the moment FOCUS goes on. */}
        <div data-focus-hide>
          <VenturesPanel ventures={ventures} />
        </div>
        {/* payments deliberately empty: the cockpit is business-only as of
            2026-09-17. Billing and personal tracking came off the board. */}
        <div data-focus-hide>
        <BriefingPanel
          goals={goals}
          tasks={tasks}
          payments={[]}
          userId={userId}
          ventures={ventures}
          onChange={invalidate}
        />
        </div>
        <div data-focus-hide style={{ "--primary": "#f97316", "--ring": "#f97316" } as React.CSSProperties}>
          <WeeklyBrief tasks={tasks} userId={userId} ventures={ventures} onChange={invalidate} />
        </div>
        <div data-focus-hide style={{ "--primary": "#a78bfa", "--ring": "#a78bfa" } as React.CSSProperties}>
          <MonthlyBrief tasks={tasks} userId={userId} ventures={ventures} onChange={invalidate} />
        </div>
        {focusMode && (
          <div
            style={{ "--primary": "#fb7185", "--ring": "#fb7185" } as React.CSSProperties}
          >
            <PersonalBrief
              tasks={tasks}
              userId={userId}
              ventures={ventures}
              onChange={invalidate}
            />
          </div>
        )}
        {/* COMMS closes the page. It moved off the top on 2026-09-17: the
            cockpit leads with the businesses, and the line to EM and Codex is
            where you end up, not what you land on. */}
        {/* stays up in PERSONAL too: the line to EM and Codex should not
            depend on which board you happen to be looking at */}
        <CommsPanel userId={userId} />
      </main>

      <footer className="border-t border-border px-4 py-2 mono text-[10px] text-muted-foreground flex justify-between">
        <span>COMMAND CENTER v1.0 · PRIVATE OPERATIONS</span>
        <span>NODE-01 · SECURE</span>
      </footer>
    </div>
  );
}


/* Eastern time, everywhere. The cockpit is read from a phone and a laptop that
   may not agree on a timezone; the business only runs in one. */
const ET_ZONE = "America/New_York";

function etParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_ZONE,
    hour12: true,
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) p[part.type] = part.value;
  return p;
}

function etHour(d: Date): number {
  // Its own 24-hour formatter: the display one is 12-hour now, and phase
  // boundaries compared against a 12-hour number would put 1pm in the morning.
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_ZONE,
    hour12: false,
    hour: "2-digit",
  });
  const h = f.formatToParts(d).find((x) => x.type === "hour")?.value ?? "0";
  return parseInt(h, 10) % 24;
}

/* ---------------- top bar ---------------- */
function TopBar({
  now,
  focusMode,
  onToggleFocus,
  onSignOut,
  onSync,
  syncing,
  userId,
  ventures,
  onChange,
}: {
  onSync: () => void;
  syncing: boolean;
  userId: string;
  ventures: Venture[];
  onChange: () => void;
  now: Date | null;
  focusMode: boolean;
  onToggleFocus: () => void;
  onSignOut: () => void;
}) {
  // Eastern, not UTC. This read four hours ahead for months.
  const p = now ? etParts(now) : null;
  const clock = p ? `${p.hour}:${p.minute}:${p.second} ${p.dayPeriod ?? ""}`.trim() : "--:--:--";
  const date = p ? `${p.weekday} ${p.month} ${p.day} ${p.year}` : "------";

  return (
    <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-10">
      <div className="flex items-center justify-between px-3 sm:px-4 py-3 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative">
            <div className="size-9 rounded-sm border border-primary/60 flex items-center justify-center bg-primary/10">
              <Satellite className="size-4 text-primary" />
            </div>
            <span className="absolute -right-1 -top-1 size-2 rounded-full bg-ok pulse-dot" />
          </div>
          <div className="min-w-0">
            <div className="mono text-sm font-semibold tracking-widest text-primary truncate">
              COMMAND CENTER
            </div>
            <div className="mono text-[10px] text-ok tracking-wider">
              ● STATUS: ONLINE
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleFocus}
            className={`mono text-[10px] tracking-widest px-3 py-2 border rounded-sm flex items-center gap-1.5 ${
              focusMode
                ? "border-accent text-accent bg-accent/10 shadow-[0_0_10px] shadow-accent/40"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Crosshair className="size-3" />
            {focusMode ? "● PERSONAL" : "PERSONAL"}
          </button>
          <ItemDialog
            userId={userId}
            onChange={onChange}
            ventures={ventures}
            trigger={
              <button
                title="Add something"
                className="mono text-[14px] leading-none border border-primary/60 text-primary hover:bg-primary/10 px-2.5 py-1.5 rounded-sm"
              >
                +
              </button>
            }
          />
          <button
            onClick={onSync}
            disabled={syncing}
            title="Send the current board to EM and Codex"
            className="mono text-[10px] tracking-widest border border-ok/60 text-ok hover:bg-ok/10 px-2 py-1 rounded-sm disabled:opacity-40"
          >
            {syncing ? "SYNCING…" : "SAVE & SYNC"}
          </button>
          <div className="hidden sm:block text-right mono pr-2">
            <div className="text-sm text-primary tracking-widest" suppressHydrationWarning>{clock} ET</div>
            <div className="text-[10px] text-muted-foreground" suppressHydrationWarning>{date}</div>
          </div>
          <button
            onClick={onSignOut}
            className="size-9 border border-border rounded-sm flex items-center justify-center text-muted-foreground hover:text-danger hover:border-danger"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

/* ---------------- panel shell ---------------- */
function Panel({
  title,
  icon,
  right,
  children,
  className = "",
}: {
  title: string;
  icon: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(`panel-collapsed:${title}`) === "1") setCollapsed(true);
    } catch { /* ignore */ }
  }, [title]);
  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(`panel-collapsed:${title}`, next ? "1" : "0");
      } catch { /* ignore */ }
      return next;
    });
  return (
    <section
      className={`relative rounded-sm border border-border bg-card overflow-hidden shadow-[0_0_30px_-15px_rgba(34,211,238,0.3)] ${className}`}
    >
      <div className="absolute top-0 left-3 right-3 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
      <div
        className={`flex items-center justify-between px-3 py-2 bg-secondary/40 gap-2 ${
          collapsed ? "" : "border-b border-border"
        }`}
      >
        <button
          onClick={toggle}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 mono text-[11px] tracking-widest text-primary min-w-0 flex-1 text-left"
        >
          <span className="text-primary/80 shrink-0">{icon}</span>
          <span className="truncate">{title}</span>
          <ChevronDown
            className={`size-3 shrink-0 text-muted-foreground transition-transform ${
              collapsed ? "-rotate-90" : ""
            }`}
          />
        </button>
        <div className="shrink-0">{right}</div>
      </div>
      {!collapsed && <div className="p-3">{children}</div>}
    </section>
  );
}

/* ---------------- CENTRAL BRIEF (Jarvis++ v1: proactive + commit) ---------------- */
function daysUntil(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00");
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((d.getTime() - midnight) / 86400000);
}

function BriefingPanel({
  goals,
  tasks,
  payments,
  userId,
  ventures,
  onChange,
}: {
  userId: string;
  ventures: Venture[];
  goals: Goal[];
  tasks: Task[];
  payments: UpcomingPayment[];
  onChange: () => void;
}) {
  const now = new Date();
  const hour = etHour(now instanceof Date ? now : new Date());
  // Plain words. DAWN/MIDDAY/DUSK was my invention; the database still stores
  // dawn/midday/dusk, this is only what it says on screen.
  const phase = hour < 12 ? "MORNING" : hour < 17 ? "AFTERNOON" : "EVENING";
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const todayS = todayStr();

  const openSignal = tasks.filter((t) => t.pile === "signal" && t.status !== "done");
  const dueToday = openSignal.filter((t) => t.due_date === todayS || (t.horizon === "today" && !t.due_date));
  const overdue = openSignal.filter((t) => t.due_date && t.due_date < todayS);
  const rest = openSignal.filter((t) => !dueToday.includes(t) && !overdue.includes(t));
  const mits = [...dueToday, ...overdue, ...rest].slice(0, 3);

  const delegatedOpen = tasks.filter(
    (t) =>
      t.pile === "noise" &&
      t.status !== "done" &&
      (t.due_date === todayS || (t.horizon === "today" && !t.due_date) || (t.due_date && t.due_date < todayS)),
  );
  const doneToday = tasks.filter(
    (t) => t.status === "done" && t.completed_at && new Date(t.completed_at).toDateString() === now.toDateString(),
  );

  const nextPay = payments
    .filter((p) => p.due_date)
    .map((p) => ({ ...p, d: daysUntil(p.due_date as string) }))
    .filter((p) => p.d >= 0 && p.d <= 14)
    .sort((a, b) => a.d - b.d)[0];

  // Three commits a day, one per phase, instead of a single morning lock-in.
  // A day rarely survives contact with itself: what you commit at dawn is stale
  // by the afternoon, and one button per day meant the brief went read-only
  // before lunch.
  const PHASES = ["DAWN", "MIDDAY", "DUSK"] as const;
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  // Folds like the other panels, and remembers - same key prefix as Panel.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("panel-collapsed:CENTRAL BRIEF") === "1") setCollapsed(true);
    } catch { /* ignore */ }
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("panel-collapsed:CENTRAL BRIEF", next ? "1" : "0");
      } catch { /* ignore */ }
      return next;
    });
  }
  const committed = !!done[phase];
  const doneCount = PHASES.filter((p) => done[p]).length;

  useEffect(() => {
    try {
      const next: Record<string, boolean> = {};
      for (const p of PHASES) {
        next[p] = localStorage.getItem(`brief-committed:${todayS}:${p}`) === "1";
      }
      setDone(next);
    } catch { /* ignore */ }
  }, [todayS]);

  async function commit() {
    if (busy || mits.length === 0) return;
    setBusy(true);
    for (const t of mits) {
      await supabase.from("tasks").update({ due_date: todayS, pile: "signal", horizon: "today" }).eq("id", t.id);
    }
    try {
      localStorage.setItem(`brief-committed:${todayS}:${phase}`, "1");
    } catch { /* ignore */ }
    setDone((d) => ({ ...d, [phase]: true }));
    setBusy(false);
    toast.success(`${phase} committed — ${doneCount + 1} of 3 today.`);
    onChange();
  }

  return (
    <section className="relative rounded-sm border border-primary/40 bg-card overflow-hidden shadow-[0_0_40px_-12px_rgba(34,211,238,0.35)]">
      <div className="absolute top-0 left-3 right-3 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
      <div
        className={`flex items-center justify-between px-3 py-2 bg-secondary/40 gap-2 ${
          collapsed ? "" : "border-b border-border"
        }`}
      >
        <button
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 mono text-[11px] tracking-widest text-primary min-w-0 flex-1 text-left"
        >
          <span className="text-primary/80 shrink-0">
            <Satellite className="size-3.5" />
          </span>
          <span className="truncate">CENTRAL BRIEF · {phase}</span>
          <ChevronDown
            className={`size-3 shrink-0 text-muted-foreground transition-transform ${
              collapsed ? "-rotate-90" : ""
            }`}
          />
        </button>
        <div className="shrink-0 mono text-[10px] text-muted-foreground">
          {now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}
        </div>
      </div>
      {!collapsed && (
        <div className="p-4 sm:p-5">
        <>
        <div className="text-lg sm:text-xl font-semibold mb-4 leading-tight">
          {greeting}.{" "}
          {committed
            ? `You're locked in for ${phase.toLowerCase()}.`
            : doneCount > 0
              ? `${doneCount} of 3 committed — here's ${phase.toLowerCase()}.`
              : "Here's your day."}
        </div>

        <PhaseBoard
          tasks={tasks}
          userId={userId}
          phase={phase.toLowerCase() as PhaseKey}
          todayS={todayS}
          ventures={ventures}
          onChange={onChange}
        />
        </>
        </div>
      )}
    </section>
  );
}

/* ---------------- objectives ---------------- */
function ObjectivesPanel({
  goals,
  userId,
  onChange,
}: {
  goals: Goal[];
  userId: string;
  onChange: () => void;
}) {
  const active = goals.filter((g) => g.is_active).slice(0, 6);

  // There was no way to create an objective at all - the board only ever had
  // the ones the seed put there, which is why a wiped board felt broken.
  async function add() {
    const { error } = await (supabase as any).from("goals").insert({
      user_id: userId,
      title: "New objective",
      category: "business",
      pile: "me",
      sort_order: active.length + 1,
      is_active: true,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Objective added — hit EDIT to name it");
      onChange();
    }
  }

  return (
    <Panel
      title="OBJECTIVES // PRIMARY"
      icon={<Target className="size-3.5" />}
      right={
        <div className="flex items-center gap-2">
          <span className="mono text-[10px] text-muted-foreground">
            {active.length} ACTIVE
          </span>
          <button
            onClick={add}
            className="mono text-[10px] tracking-widest border border-border text-muted-foreground hover:text-primary hover:border-primary px-1.5 py-0.5 rounded-sm"
          >
            + ADD
          </button>
        </div>
      }
    >
      {active.length === 0 && (
        <p className="mono text-[10px] text-muted-foreground">
          No objectives yet. Hit + ADD to set the first one.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {active.map((g) => (
          <GoalCard key={g.id} goal={g} onChange={onChange} />
        ))}
      </div>
    </Panel>
  );
}

function GoalCard({ goal, onChange }: { goal: Goal; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  // A goal with no numbers yet is a normal state - a new objective starts as a
  // sentence, not a metric. String(null) produced "null", parseFloat gave NaN,
  // and save() returned silently, so EDIT looked broken rather than empty.
  const [title, setTitle] = useState(goal.title ?? "");
  const [current, setCurrent] = useState(
    goal.current_value == null ? "" : String(goal.current_value),
  );
  const [target, setTarget] = useState(
    goal.target_value == null ? "" : String(goal.target_value),
  );

  const pct = goal.target_value > 0
    ? Math.min(100, Math.max(0, (goal.current_value / goal.target_value) * 100))
    : 0;

  const tone =
    goal.category === "business" ? "text-accent" :
    goal.category === "body" ? "text-ok" :
    "text-primary";
  const bar =
    goal.category === "business" ? "bg-accent shadow-[0_0_10px] shadow-accent/60" :
    goal.category === "body" ? "bg-ok shadow-[0_0_10px] shadow-ok/60" :
    "bg-primary shadow-[0_0_10px] shadow-primary/60";

  async function save() {
    const name = title.trim();
    if (!name) {
      toast.error("Give the objective a name first.");
      return;
    }
    const c = current.trim() === "" ? null : parseFloat(current);
    const t = target.trim() === "" ? null : parseFloat(target);
    if ((c !== null && isNaN(c)) || (t !== null && isNaN(t))) {
      // Used to `return` here with no word to anyone, which is how EDIT came to
      // look like a dead button. Say what is wrong.
      toast.error("Current and target must be numbers, or left blank.");
      return;
    }
    // The generated types still say these columns are non-null; the database
    // accepts null and that is what an un-metered objective should store.
    const { error } = await (supabase as any)
      .from("goals")
      .update({ title: name, current_value: c, target_value: t })
      .eq("id", goal.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Objective updated");
      setEditing(false);
      onChange();
    }
  }

  async function remove() {
    const { error } = await supabase.from("goals").delete().eq("id", goal.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Objective removed");
      onChange();
    }
  }

  return (
    <div className="border border-border rounded-sm p-3 bg-background/40 relative">
      <div className="flex justify-between items-start gap-2 mb-2">
        <div className="min-w-0">
          <div className="mono text-[9px] tracking-widest text-muted-foreground">
            {goal.category.toUpperCase()} · {goal.pile.toUpperCase()}
          </div>
          <div className="text-sm font-medium leading-tight">{goal.title}</div>
        </div>
        <button
          onClick={() => setEditing((e) => !e)}
          className="mono text-[9px] text-muted-foreground hover:text-primary border border-border px-1.5 py-0.5 rounded-sm"
        >
          {editing ? "X" : "EDIT"}
        </button>
      </div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className={`mono text-2xl font-semibold ${tone}`}>
          {goal.current_value == null ? "—" : Number(goal.current_value).toLocaleString()}
        </span>
        <span className="mono text-[10px] text-muted-foreground">
          / {goal.target_value == null ? "—" : Number(goal.target_value).toLocaleString()}{" "}
          {goal.unit ?? ""}
        </span>
        <span className={`ml-auto mono text-[10px] ${tone}`}>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 bg-secondary rounded-sm overflow-hidden">
        <div className={`h-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2.5 mono text-[10px] text-muted-foreground space-y-0.5">
        {goal.daily_target && <div>▸ D: {goal.daily_target}</div>}
        {goal.weekly_target && <div>▸ W: {goal.weekly_target}</div>}
        {goal.monthly_target && <div>▸ M: {goal.monthly_target}</div>}
      </div>
      {editing && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          <label className="block">
            <span className="mono text-[9px] text-muted-foreground">OBJECTIVE</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What are you actually going after?"
              className="w-full text-sm bg-background border border-border rounded-sm px-2 py-1 mt-0.5"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mono text-[9px] text-muted-foreground">CURRENT</span>
              <input
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className="w-full mono text-sm bg-background border border-border rounded-sm px-2 py-1 mt-0.5"
              />
            </label>
            <label className="block">
              <span className="mono text-[9px] text-muted-foreground">TARGET</span>
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full mono text-sm bg-background border border-border rounded-sm px-2 py-1 mt-0.5"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={save}
              className="flex-1 mono text-[10px] tracking-widest bg-primary text-primary-foreground py-1.5 rounded-sm hover:bg-primary/90"
            >
              COMMIT
            </button>
            <button
              onClick={remove}
              className="mono text-[10px] tracking-widest border border-destructive/50 text-destructive px-2 py-1.5 rounded-sm hover:bg-destructive/10"
            >
              DELETE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


/* ---------------- phase board (3 phases x 3 tasks, traffic lights) ---------------- */
const PHASE_KEYS = ["dawn", "midday", "dusk"] as const;
// Stored values stay as they are; these are just the words on screen.
// One source of truth for the horizon colours, so a tag can never disagree with
// the panel it came from.
const BOARD_COLOR: Record<string, string> = {
  today: "#22d3ee",
  week: "#f97316",
  month: "#a78bfa",
  personal: "#fb7185",
};

const PHASE_LABEL: Record<string, string> = {
  dawn: "MORNING",
  midday: "AFTERNOON",
  dusk: "EVENING",
};
type PhaseKey = (typeof PHASE_KEYS)[number];

function PhaseBoard({
  tasks,
  userId,
  phase,
  todayS,
  ventures,
  onChange,
}: {
  tasks: Task[];
  userId: string;
  phase: PhaseKey;
  todayS: string;
  ventures: Venture[];
  onChange: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Everything belonging to this phase today - all of it. The board used to cap
  // each phase at three, which meant a day holding 32 tasks displayed 9 and hid
  // the rest silently. the user's call 2026-09-22: show everything, hide nothing.
  const queued = (p: PhaseKey) =>
    tasks
      .filter((t) => {
        if ((t as any).phase !== p) return false;
        // Either set on today's board directly, or a weekly/monthly rock
        // scheduled for today. That is how the longer horizons reach the day.
        // Today, plus anything already past due - an overdue payment must not
        // quietly drop off the board.
        const d = taskDay(t);
        return !!d && d <= todayS;
      })
      .sort(byTime);

  const forPhase = queued;

  const all = PHASE_KEYS.flatMap((p) => forPhase(p));
  const selected = all.find((t) => t.id === selectedId) ?? null;

  async function add(p: PhaseKey) {
    const title = (draft[p] ?? "").trim();
    if (!title || busy) return;
    setBusy(true);
    const { data, error } = await (supabase as any)
      .from("tasks")
      .insert({
        user_id: userId,
        title,
        horizon: "today",
        pile: "signal",
        assigned_to: "me",
        status: "todo",
        due_date: todayS,
        phase: p,
        sort_order: forPhase(p).length + 1,
      })
      .select()
      .single();
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDraft((d) => ({ ...d, [p]: "" }));
    if (data?.id) setSelectedId(data.id);
    onChange();
  }

  async function act(status: "todo" | "in_progress" | "done") {
    if (!selected || busy) return;
    setBusy(true);
    const { error } = await (supabase as any)
      .from("tasks")
      .update({
        status,
        completed_at: status === "done" ? new Date().toISOString() : null,
      })
      .eq("id", selected.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(
        status === "done"
          ? "Complete."
          : status === "in_progress"
            ? "Committed."
            : "Back to needs-work.",
      );
      onChange();
    }
  }

  async function remove() {
    if (!selected || busy) return;
    setBusy(true);
    const { error } = await (supabase as any).from("tasks").delete().eq("id", selected.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      setSelectedId(null);
      onChange();
    }
  }

  const light = (t: Task) =>
    t.status === "done"
      ? { dot: "bg-ok", ring: "border-ok/40 bg-ok/5" }
      : t.status === "in_progress"
        ? { dot: "bg-warn", ring: "border-warn/40 bg-warn/5" }
        : { dot: "bg-destructive", ring: "border-destructive/40 bg-destructive/5" };

  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {PHASE_KEYS.map((p) => {
          const rows = forPhase(p);
          const doneN = rows.filter((r) => r.status === "done").length;
          const isNow = p === phase;
          return (
            <div
              key={p}
              className={`border rounded-sm p-2.5 ${
                isNow ? "border-primary/50 bg-primary/5" : "border-border bg-background/40"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`mono text-[10px] tracking-widest ${
                    isNow ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {PHASE_LABEL[p]}
                  {isNow ? " · NOW" : ""}
                </span>
                <span className="mono text-[9px] text-muted-foreground">
                  {doneN} done · {rows.length}
                </span>
              </div>

              <div className="space-y-1.5">
                {rows.length === 0 && (
                  <p className="mono text-[9px] text-muted-foreground py-1">Nothing set.</p>
                )}
                {rows.map((t) => {
                  const l = light(t);
                  const isSel = t.id === selectedId;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedId(isSel ? null : t.id)}
                      className={`w-full text-left border rounded-sm px-2 py-2 flex items-start gap-2 ${l.ring} ${
                        isSel ? "ring-2 ring-primary border-primary" : ""
                      }`}
                    >
                      <span className={`size-2.5 rounded-full mt-1 shrink-0 ${l.dot}`} />
                      <span
                        className={`text-[12px] leading-snug flex-1 min-w-0 ${
                          t.status === "done" ? "line-through text-muted-foreground" : ""
                        }`}
                      >
                        {t.title}
                        {t.horizon !== "today" && (
                          <span
                            className="mono text-[8px] tracking-widest ml-1.5"
                            style={{ color: BOARD_COLOR[t.horizon] ?? "inherit" }}
                          >
                            {t.horizon === "week" ? "WEEK" : "MONTH"}
                          </span>
                        )}
                      </span>
                      <SchedStamp task={t} />
                      <ProjectBadge task={t} ventures={ventures} />
                      <OwnerBadge task={t} />
                      {isSel && (
                        <span className="mono text-[8px] tracking-widest text-primary shrink-0 mt-0.5">
                          SELECTED
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

            </div>
          );
        })}
      </div>

      <div className="border border-border rounded-sm p-2.5 bg-background/40">
        <div className="flex items-center gap-2 mb-2">
          <TitleEditor task={selected} label="SELECT A TASK ABOVE" onSaved={onChange} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => act(selected?.status === "in_progress" ? "todo" : "in_progress")}
            disabled={!selected || busy || selected?.status === "done"}
            className="flex-1 min-w-[110px] mono text-[10px] tracking-widest px-2 py-2 rounded-sm border border-warn/60 text-warn hover:bg-warn/10 disabled:opacity-30"
          >
            {selected?.status === "in_progress" ? "UNCOMMIT" : "COMMIT"}
          </button>
          <button
            onClick={() => act(selected?.status === "done" ? "todo" : "done")}
            disabled={!selected || busy}
            className="flex-1 min-w-[110px] mono text-[10px] tracking-widest px-2 py-2 rounded-sm border border-ok/60 text-ok hover:bg-ok/10 disabled:opacity-30"
          >
            {selected?.status === "done" ? "REOPEN" : "COMPLETE"}
          </button>
          <ItemDialog
            userId={userId}
            onChange={onChange}
            task={selected}
            ventures={ventures}
            trigger={
              <button
                disabled={!selected}
                className="mono text-[10px] tracking-widest px-2.5 py-2 rounded-sm border border-primary/60 text-primary hover:bg-primary/10 disabled:opacity-30"
              >
                EDIT
              </button>
            }
          />
          <button
            onClick={remove}
            disabled={!selected || busy}
            className="mono text-[10px] tracking-widest px-2.5 py-2 rounded-sm border border-destructive/50 text-destructive hover:bg-destructive/10 disabled:opacity-30"
          >
            DELETE
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- one composer, for new items and edits ---------------- */
function ItemDialog({
  userId,
  onChange,
  task,
  ventures,
  trigger,
}: {
  userId: string;
  onChange: () => void;
  task?: Task | null;
  ventures: Venture[];
  trigger: React.ReactNode;
}) {
  const editing = !!task;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [board, setBoard] = useState<"today" | "week" | "month" | "personal">("today");
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState("");
  const [who, setWho] = useState<"me" | "em" | "codex">("me");
  const [proj, setProj] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load the item's real values every time the dialog opens, so an edit never
  // shows the previous item's numbers.
  useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.title ?? "");
      setBoard((task.horizon as "today" | "week" | "month" | "personal") ?? "today");
      const sched = (task as any).scheduled_at as string | null;
      if (sched) {
        const d = new Date(sched);
        setDate(
          d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(d.getDate()).padStart(2, "0"),
        );
        setTime(
          String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"),
        );
      } else {
        setDate(task.due_date ?? todayStr());
        setTime("");
      }
      setWho(((task as any).assigned_to as "me" | "em" | "codex") ?? "me");
      setProj(((task as any).venture_id as string | null) ?? null);
    } else {
      setTitle("");
      setBoard("today");
      setDate(todayStr());
      setTime("");
      setWho("me");
      setProj(null);
    }
  }, [open, task?.id]);

  async function submit() {
    const name = title.trim();
    if (!name || busy) return;

    // due_date anchors the row to its board: the day itself, the Monday of its
    // week, or the first of its month. scheduled_at is separate - that is what
    // makes a weekly or monthly item surface on a particular day.
    const picked = new Date(date + "T12:00:00");
    let due = date;
    if (board === "week") due = mondayOf(picked);
    if (board === "month")
      due = picked.getFullYear() + "-" + String(picked.getMonth() + 1).padStart(2, "0") + "-01";

    let scheduled: string | null = null;
    let phase: string | null = null;
    if (time) {
      const when = new Date(date + "T" + time + ":00");
      if (!isNaN(when.getTime())) {
        scheduled = when.toISOString();
        const h = when.getHours();
        phase = h < 12 ? "dawn" : h < 17 ? "midday" : "dusk";
      }
    } else if (board === "today") {
      const h = etHour(new Date());
      phase = h < 12 ? "dawn" : h < 17 ? "midday" : "dusk";
    }

    const row = {
      title: name,
      horizon: board,
      assigned_to: who,
      due_date: due,
      phase,
      scheduled_at: scheduled,
      venture_id: proj,
    };

    setBusy(true);
    const { error } = editing
      ? await (supabase as any).from("tasks").update(row).eq("id", task!.id)
      : await (supabase as any)
          .from("tasks")
          .insert({ ...row, user_id: userId, pile: "signal", status: "todo", sort_order: 99 });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editing ? "Updated." : "Added to " + (board === "today" ? "today" : "the " + board));
    setOpen(false);
    onChange();
  }

  const Seg = ({
    options,
    value,
    onPick,
  }: {
    options: { v: string; label: string }[];
    value: string;
    onPick: (v: string) => void;
  }) => (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onPick(o.v)}
          className={`flex-1 mono text-[10px] tracking-widest px-2 py-2 rounded-sm border ${
            value === o.v
              ? "border-primary text-primary bg-primary/10"
              : "border-border text-muted-foreground hover:text-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="mono text-[12px] tracking-widest">
            {editing ? "EDIT ITEM" : "NEW ITEM"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mono text-[9px] tracking-widest text-muted-foreground">WHAT</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="what needs doing"
              className="w-full mt-1 text-[13px] bg-background border border-border rounded-sm px-2 py-2 focus:border-primary"
            />
          </div>

          <div>
            <label className="mono text-[9px] tracking-widest text-muted-foreground">BOARD</label>
            <div className="mt-1">
              <div className="flex gap-1.5">
                {[
                  { v: "today", label: "DAILY" },
                  { v: "week", label: "WEEKLY" },
                  { v: "month", label: "MONTHLY" },
                  { v: "personal", label: "PERSONAL" },
                ].map((o) => {
                  const on = board === o.v;
                  const c = BOARD_COLOR[o.v];
                  return (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setBoard(o.v as "today" | "week" | "month" | "personal")}
                      className="flex-1 mono text-[10px] tracking-widest px-2 py-2 rounded-sm border"
                      style={
                        on
                          ? { borderColor: c, color: c, background: c + "1a" }
                          : undefined
                      }
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1 min-w-0">
              <label className="mono text-[9px] tracking-widest text-muted-foreground">DATE</label>
              <div className="mt-1 flex">
                <DayPickerField value={date} onChange={setDate} />
              </div>
            </div>
            <div className="w-[110px] shrink-0">
              <label className="mono text-[9px] tracking-widest text-muted-foreground">TIME</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full mt-1 mono text-[11px] bg-background border border-border rounded-sm px-2 py-2"
              />
            </div>
          </div>

          <div>
            <label className="mono text-[9px] tracking-widest text-muted-foreground">PROJECT</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ventures.map((v) => {
                const on = proj === v.id;
                const c = ((v as any).color as string | null) ?? "#64748b";
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setProj(on ? null : v.id)}
                    title={v.name}
                    className="mono text-[10px] tracking-widest px-2.5 py-1.5 rounded-sm border"
                    style={
                      on
                        ? { background: c, borderColor: c, color: "#fff" }
                        : { borderColor: c + "66", color: c }
                    }
                  >
                    {(v as any).abbr ?? v.name.slice(0, 3).toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mono text-[9px] tracking-widest text-muted-foreground">WHOSE</label>
            <div className="mt-1">
              <Seg
                value={who}
                onPick={(v) => setWho(v as "me" | "em" | "codex")}
                options={[
                  { v: "me", label: "ME" },
                  { v: "em", label: "EM" },
                  { v: "codex", label: "CODEX" },
                ]}
              />
            </div>
          </div>

          <p className="mono text-[9px] text-muted-foreground leading-snug">
            {board === "today"
              ? time
                ? "On the daily board at that time."
                : "On the daily board, in the block you are in now."
              : time
                ? "Sits on the " + board + " board and appears on the daily board then."
                : "Sits on the " + board + " board. Give it a time to put it on a day."}
          </p>

          <button
            onClick={submit}
            disabled={busy || !title.trim()}
            className="w-full mono text-[11px] tracking-widest bg-primary text-primary-foreground py-2.5 rounded-sm disabled:opacity-30"
          >
            {busy ? "SAVING…" : editing ? "SAVE" : "ADD"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- which project ---------------- */
function ProjectBadge({ task, ventures }: { task: Task; ventures: Venture[] }) {
  const id = (task as any).venture_id as string | null;
  if (!id) return null;
  const v = ventures.find((x) => x.id === id);
  if (!v) return null;
  const abbr = (v as any).abbr as string | null;
  const color = ((v as any).color as string | null) ?? "#64748b";
  return (
    <span
      title={v.name}
      className="mono text-[8px] tracking-widest shrink-0 mt-0.5 whitespace-nowrap rounded-sm px-1 py-px text-white"
      style={{ background: color }}
    >
      {abbr ?? v.name.slice(0, 3).toUpperCase()}
    </span>
  );
}

/* ---------------- who owns it ---------------- */
const OWNER_STYLE: Record<string, { label: string; color: string }> = {
  me: { label: "ME", color: "#8c9bab" },
  em: { label: "EM", color: "#38bdf8" },
  codex: { label: "CODEX", color: "#2dd4bf" },
  central: { label: "CENTRAL", color: "#8c9bab" },
};

function OwnerBadge({ task }: { task: Task }) {
  const who = (task as any).assigned_to as string | null;
  const o = OWNER_STYLE[who ?? "me"];
  if (!o) return null;
  return (
    <span
      className="mono text-[8px] tracking-widest shrink-0 mt-0.5 whitespace-nowrap border rounded-sm px-1 py-px"
      style={{ color: o.color, borderColor: o.color + "66" }}
    >
      {o.label}
    </span>
  );
}

/* ---------------- ordering ---------------- */
/* Scheduled work in clock order, then everything without a time. A board that
   puts a 9am item under a 4pm one is lying about the day. */
function byTime(a: Task, b: Task): number {
  const sa = (a as any).scheduled_at as string | null;
  const sb = (b as any).scheduled_at as string | null;
  if (sa && sb) return sa.localeCompare(sb);
  if (sa) return -1;
  if (sb) return 1;
  return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
}

/* ---------------- scheduled stamp ---------------- */
function SchedStamp({ task }: { task: Task }) {
  const iso = (task as any).scheduled_at as string | null;
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  // Eastern, like the clock. A stamp in the device's zone is worse than none.
  const txt = d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <span className="mono text-[9px] tracking-wider text-accent shrink-0 mt-0.5 whitespace-nowrap">
      {txt.replace(", ", " · ")}
    </span>
  );
}

/* ---------------- rename the selected item ---------------- */
function TitleEditor({
  task,
  label,
  onSaved,
}: {
  task: Task | null;
  label: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  // Follow the selection. Without this the box keeps the previous task's text
  // and the next save would rename the wrong row.
  useEffect(() => {
    setDraft(task?.title ?? "");
  }, [task?.id, task?.title]);

  const dirty = !!task && draft.trim() !== "" && draft.trim() !== task.title;

  async function save() {
    if (!task || !dirty || busy) return;
    setBusy(true);
    const { error } = await (supabase as any)
      .from("tasks")
      .update({ title: draft.trim() })
      .eq("id", task.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Renamed.");
      onSaved();
    }
  }

  if (!task) {
    return (
      <div className="mono text-[9px] tracking-widest text-muted-foreground truncate flex-1 min-w-0">
        {label}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") setDraft(task.title);
        }}
        className="flex-1 min-w-0 text-[12px] bg-background border border-border rounded-sm px-2 py-1 focus:border-primary"
      />
      {dirty && (
        <button
          onClick={save}
          disabled={busy}
          className="mono text-[9px] tracking-widest px-2 py-1 rounded-sm bg-primary text-primary-foreground shrink-0 disabled:opacity-40"
        >
          SAVE
        </button>
      )}
    </div>
  );
}

/* ---------------- date picker (month grid in a popover) ---------------- */
function DayPickerField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Parse as local noon: a bare "2026-09-20" is parsed as UTC midnight, which
  // lands on the 19th for anyone west of Greenwich.
  const selected = value ? new Date(value + "T12:00:00") : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex-1 min-w-[130px] mono text-[11px] text-left bg-background border border-border rounded-sm px-2 py-2 disabled:opacity-30 hover:border-primary"
        >
          {selected
            ? selected.toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })
            : "pick a day"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d: Date | undefined) => {
            if (!d) return;
            const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const iso =
              local.getFullYear() +
              "-" +
              String(local.getMonth() + 1).padStart(2, "0") +
              "-" +
              String(local.getDate()).padStart(2, "0");
            onChange(iso);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/* ---------------- filter a board by project ---------------- */
function ProjectFilter({
  ventures,
  picked,
  onToggle,
}: {
  ventures: Venture[];
  picked: string[];
  onToggle: (id: string) => void;
}) {
  if (!ventures.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mb-2">
      {ventures.map((v) => {
        const on = picked.includes(v.id);
        const c = ((v as any).color as string | null) ?? "#64748b";
        return (
          <button
            key={v.id}
            onClick={() => onToggle(v.id)}
            title={v.name}
            className="mono text-[9px] tracking-widest px-1.5 py-0.5 rounded-sm border"
            style={
              on
                ? { background: c, borderColor: c, color: "#fff" }
                : { borderColor: c + "55", color: c + "cc" }
            }
          >
            {(v as any).abbr ?? v.name.slice(0, 3).toUpperCase()}
          </button>
        );
      })}
      {picked.length > 0 && (
        <button
          onClick={() => picked.forEach(onToggle)}
          className="mono text-[9px] tracking-widest px-1.5 py-0.5 rounded-sm border border-border text-muted-foreground hover:text-primary"
        >
          ALL
        </button>
      )}
    </div>
  );
}

/* ---------------- weekly brief (3 big rocks, Mon-Sun, schedule-only) ---------------- */
function mondayOf(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return x.toISOString().slice(0, 10);
}

function WeeklyBrief({ tasks, userId, ventures, onChange }: {
  tasks: Task[];
  userId: string;
  ventures: Venture[];
  onChange: () => void;
}) {
  const weekStart = mondayOf(new Date());
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // After today, through Sunday. Today's work is on the daily board, so it is
  // deliberately not repeated here - a task is in one place at a time.
  const todayS = todayStr();
  const weekEnd = (() => {
    const d = new Date(weekStart + "T12:00:00");
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  })();
  const allRows = inWindow(tasks, dayAfter(todayS), weekEnd, "week");
  // Nothing picked means everything - a filter that starts empty should not
  // start by hiding the board.
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const rows = picked.length
    ? allRows.filter((t) => picked.includes(String((t as any).venture_id ?? "")))
    : allRows;
  const selected = rows.find((t) => t.id === selectedId) ?? null;
  const doneN = rows.filter((t) => t.status === "done").length;

  const end = new Date(weekStart + "T12:00:00");
  end.setDate(end.getDate() + 6);
  const daysLeft = Math.max(
    0,
    Math.round((end.getTime() - new Date().setHours(12, 0, 0, 0)) / 86400000) + 1,
  );

  async function add() {
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    const { data, error } = await (supabase as any)
      .from("tasks")
      .insert({
        user_id: userId,
        title,
        horizon: "week",
        pile: "signal",
        assigned_to: "me",
        status: "todo",
        due_date: weekStart,
        sort_order: rows.length + 1,
      })
      .select()
      .single();
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDraft("");
    if (data?.id) setSelectedId(data.id);
    onChange();
  }

  async function remove() {
    if (!selected || busy) return;
    setBusy(true);
    const { error } = await (supabase as any).from("tasks").delete().eq("id", selected.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      setSelectedId(null);
      onChange();
    }
  }

  const light = (t: Task) =>
    t.status === "done"
      ? { dot: "bg-ok", ring: "border-ok/40 bg-ok/5" }
      : t.status === "in_progress"
        ? { dot: "bg-warn", ring: "border-warn/40 bg-warn/5" }
        : { dot: "bg-destructive", ring: "border-destructive/40 bg-destructive/5" };

  return (
    <Panel
      title="WEEKLY BRIEF"
      icon={<Crosshair className="size-3.5" />}
      right={
        <span className="mono text-[10px] text-muted-foreground">
          {rows.length}
          {picked.length ? ` OF ${allRows.length}` : rows.length === 1 ? " TASK" : " TASKS"}
        </span>
      }
    >
      <p className="mono text-[9px] tracking-widest text-muted-foreground mb-2">
        REST OF THIS WEEK · THROUGH SUNDAY
      </p>

      <ProjectFilter ventures={ventures} picked={picked} onToggle={toggle} />

      <div className="space-y-1.5">
        {rows.length === 0 && (
          <p className="mono text-[10px] text-muted-foreground py-1">
            Nothing left this week.
          </p>
        )}
        {rows.map((t) => {
          const l = light(t);
          const isSel = t.id === selectedId;
          return (
            <button
              key={t.id}
              onClick={() => setSelectedId(isSel ? null : t.id)}
              className={`w-full text-left border rounded-sm px-2.5 py-2 flex items-start gap-2 ${l.ring} ${
                isSel ? "ring-2 ring-primary border-primary" : ""
              }`}
            >
              <span className={`size-2.5 rounded-full mt-1 shrink-0 ${l.dot}`} />
              <span
                className={`text-[13px] leading-snug flex-1 min-w-0 ${
                  t.status === "done" ? "line-through text-muted-foreground" : ""
                }`}
              >
                {t.title}
              </span>
              <SchedStamp task={t} />
              <ProjectBadge task={t} ventures={ventures} />
              <OwnerBadge task={t} />
              {isSel && (
                <span className="mono text-[8px] tracking-widest text-primary shrink-0 mt-0.5">
                  SELECTED
                </span>
              )}
            </button>
          );
        })}
      </div>


      {selected && (
        <div className="border border-border rounded-sm p-2.5 bg-background/40 mt-3">
          <div className="flex items-center gap-2 mb-2">
            <TitleEditor task={selected} label="SELECT A ROCK, THEN GIVE IT A DAY" onSaved={onChange} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ItemDialog
              userId={userId}
              onChange={onChange}
              task={selected}
              ventures={ventures}
              trigger={
                <button
                  disabled={!selected}
                  className="flex-1 min-w-[110px] mono text-[10px] tracking-widest px-2 py-2 rounded-sm border border-primary/60 text-primary hover:bg-primary/10 disabled:opacity-30"
                >
                  EDIT
                </button>
              }
            />
            <button
              onClick={remove}
              disabled={!selected || busy}
              className="mono text-[10px] tracking-widest px-2.5 py-2 rounded-sm border border-destructive/50 text-destructive hover:bg-destructive/10 disabled:opacity-30"
            >
              DELETE
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ---------------- monthly brief (schedule-only) ---------------- */
function MonthlyBrief({ tasks, userId, ventures, onChange }: {
  tasks: Task[];
  userId: string;
  ventures: Venture[];
  onChange: () => void;
}) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const monthName = now.toLocaleString(undefined, { month: "long", year: "numeric" });
  const daysLeft =
    new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Everything later than this week, with no upper bound so a date in November
  // is still somewhere rather than nowhere. It drops into WEEKLY when its week
  // arrives, and onto the daily board on the day.
  const weekEndForMonth = (() => {
    const d = new Date(mondayOf(new Date()) + "T12:00:00");
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  })();
  const allRows = inWindow(tasks, dayAfter(weekEndForMonth), null, "month");
  // Nothing picked means everything - a filter that starts empty should not
  // start by hiding the board.
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const rows = picked.length
    ? allRows.filter((t) => picked.includes(String((t as any).venture_id ?? "")))
    : allRows;
  const selected = rows.find((t) => t.id === selectedId) ?? null;
  const doneN = rows.filter((t) => t.status === "done").length;

  async function add() {
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    const { data, error } = await (supabase as any)
      .from("tasks")
      .insert({
        user_id: userId,
        title,
        horizon: "month",
        pile: "signal",
        assigned_to: "me",
        status: "todo",
        due_date: monthStart,
        sort_order: rows.length + 1,
      })
      .select()
      .single();
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDraft("");
    if (data?.id) setSelectedId(data.id);
    onChange();
  }

  async function remove() {
    if (!selected || busy) return;
    setBusy(true);
    const { error } = await (supabase as any).from("tasks").delete().eq("id", selected.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      setSelectedId(null);
      onChange();
    }
  }

  const light = (t: Task) =>
    t.status === "done"
      ? { dot: "bg-ok", ring: "border-ok/40 bg-ok/5" }
      : t.status === "in_progress"
        ? { dot: "bg-warn", ring: "border-warn/40 bg-warn/5" }
        : { dot: "bg-destructive", ring: "border-destructive/40 bg-destructive/5" };

  return (
    <Panel
      title="MONTHLY BRIEF"
      icon={<Flag className="size-3.5" />}
      right={
        <span className="mono text-[10px] text-muted-foreground">
          {rows.length}
          {picked.length ? ` OF ${allRows.length}` : rows.length === 1 ? " TASK" : " TASKS"}
        </span>
      }
    >
      <p className="mono text-[9px] tracking-widest text-muted-foreground mb-2">
        {monthName.toUpperCase()} · EVERYTHING AFTER THIS WEEK
      </p>

      <ProjectFilter ventures={ventures} picked={picked} onToggle={toggle} />

      <div className="space-y-1.5">
        {rows.length === 0 && (
          <p className="mono text-[10px] text-muted-foreground py-1">
            Nothing scheduled beyond this week.
          </p>
        )}
        {rows.map((t) => {
          const l = light(t);
          const isSel = t.id === selectedId;
          return (
            <button
              key={t.id}
              onClick={() => setSelectedId(isSel ? null : t.id)}
              className={`w-full text-left border rounded-sm px-2.5 py-2 flex items-start gap-2 ${l.ring} ${
                isSel ? "ring-2 ring-primary border-primary" : ""
              }`}
            >
              <span className={`size-2.5 rounded-full mt-1 shrink-0 ${l.dot}`} />
              <span
                className={`text-[13px] leading-snug flex-1 min-w-0 ${
                  t.status === "done" ? "line-through text-muted-foreground" : ""
                }`}
              >
                {t.title}
              </span>
              <SchedStamp task={t} />
              <ProjectBadge task={t} ventures={ventures} />
              <OwnerBadge task={t} />
              {isSel && (
                <span className="mono text-[8px] tracking-widest text-primary shrink-0 mt-0.5">
                  SELECTED
                </span>
              )}
            </button>
          );
        })}
      </div>


      {selected && (
        <div className="border border-border rounded-sm p-2.5 bg-background/40 mt-3">
          <div className="flex items-center gap-2 mb-2">
            <TitleEditor task={selected} label="SELECT AN OBJECTIVE, THEN GIVE IT A DAY" onSaved={onChange} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ItemDialog
              userId={userId}
              onChange={onChange}
              task={selected}
              ventures={ventures}
              trigger={
                <button
                  disabled={!selected}
                  className="flex-1 min-w-[110px] mono text-[10px] tracking-widest px-2 py-2 rounded-sm border border-primary/60 text-primary hover:bg-primary/10 disabled:opacity-30"
                >
                  EDIT
                </button>
              }
            />
            <button
              onClick={remove}
              disabled={!selected || busy}
              className="mono text-[10px] tracking-widest px-2.5 py-2 rounded-sm border border-destructive/50 text-destructive hover:bg-destructive/10 disabled:opacity-30"
            >
              DELETE
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}


/* ---------------- date windows ---------------- */
/* The day a task actually lands on: its scheduled time if it has one, else the
   date it was filed under. */
function taskDay(t: Task): string | null {
  const sched = (t as any).scheduled_at as string | null;
  if (sched) return String(sched).slice(0, 10);
  return t.due_date ?? null;
}

/* Exclusive windows: a task lives on exactly one board and moves between them
   as its date comes closer. `to` of null means "no upper bound", so nothing
   scheduled far out ever falls off the end.

   Undated tasks stay on the board they were created for. */
function inWindow(
  tasks: Task[],
  from: string,
  to: string | null,
  homeHorizon: string,
): Task[] {
  return tasks
    .filter((t) => {
      if (t.status === "done") return false;
      const d = taskDay(t);
      if (d) return d >= from && (to === null || d <= to);
      return t.horizon === homeHorizon;
    })
    .sort(byTime);
}

/* The day after a given date, as a plain yyyy-mm-dd. */
function dayAfter(d: string): string {
  const x = new Date(d + "T12:00:00");
  x.setDate(x.getDate() + 1);
  return x.toISOString().slice(0, 10);
}

/* ---------------- upcoming ---------------- */
function Upcoming({
  tasks,
  todayS,
  ventures,
  userId,
  onChange,
}: {
  tasks: Task[];
  todayS: string;
  ventures: Venture[];
  userId: string;
  onChange: () => void;
}) {
  // Anything with a date after today, whatever board it belongs to. Done items
  // drop off - this is what is coming, not what happened.
  const rows = tasks
    .filter((t) => {
      if (t.status === "done") return false;
      const sched = (t as any).scheduled_at as string | null;
      const day = sched ? String(sched).slice(0, 10) : t.due_date;
      return !!day && day > todayS;
    })
    .sort(byTime);

  if (rows.length === 0) return null;

  const days: { day: string; items: Task[] }[] = [];
  for (const t of rows) {
    const sched = (t as any).scheduled_at as string | null;
    const day = (sched ? String(sched).slice(0, 10) : t.due_date) as string;
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(t);
    else days.push({ day, items: [t] });
  }

  const dayLabel = (d: string) =>
    new Date(d + "T12:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mono text-[10px] tracking-widest text-muted-foreground mb-2">
        UPCOMING
      </div>
      <div className="space-y-2">
        {days.map((g) => (
          <div key={g.day}>
            <div className="mono text-[9px] tracking-widest text-muted-foreground mb-1">
              {dayLabel(g.day).toUpperCase()}
            </div>
            <div className="space-y-1">
              {g.items.map((t) => (
                <div
                  key={t.id}
                  className="flex items-start gap-2 border border-border rounded-sm px-2 py-1.5 bg-background/30"
                >
                  <span
                    className="mono text-[8px] tracking-widest shrink-0 mt-0.5"
                    style={{ color: BOARD_COLOR[t.horizon] ?? "inherit" }}
                  >
                    {t.horizon === "today"
                      ? "DAY"
                      : t.horizon === "week"
                        ? "WEEK"
                        : t.horizon === "month"
                          ? "MONTH"
                          : "PERS"}
                  </span>
                  <span className="text-[12px] leading-snug flex-1 min-w-0">{t.title}</span>
                  <SchedStamp task={t} />
                  <ProjectBadge task={t} ventures={ventures} />
                  <OwnerBadge task={t} />
                  <ItemDialog
                    userId={userId}
                    onChange={onChange}
                    task={t}
                    ventures={ventures}
                    trigger={
                      <button className="mono text-[8px] tracking-widest text-muted-foreground hover:text-primary shrink-0 mt-0.5">
                        EDIT
                      </button>
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- personal (hidden until FOCUS) ---------------- */
function PersonalBrief({ tasks, userId, ventures, onChange }: {
  tasks: Task[];
  userId: string;
  ventures: Venture[];
  onChange: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // No date anchor: personal things are a standing list, not a horizon. They
  // get a day only if one is set on them, and then they show on that day.
  const rows = tasks.filter((t) => t.horizon === "personal").sort(byTime);
  const selected = rows.find((t) => t.id === selectedId) ?? null;
  const doneN = rows.filter((t) => t.status === "done").length;

  async function act(status: "todo" | "in_progress" | "done") {
    if (!selected) return;
    const { error } = await (supabase as any)
      .from("tasks")
      .update({ status, completed_at: status === "done" ? new Date().toISOString() : null })
      .eq("id", selected.id);
    if (error) toast.error(error.message);
    else onChange();
  }

  async function remove() {
    if (!selected) return;
    const { error } = await (supabase as any).from("tasks").delete().eq("id", selected.id);
    if (error) toast.error(error.message);
    else {
      setSelectedId(null);
      onChange();
    }
  }

  const light = (t: Task) =>
    t.status === "done"
      ? { dot: "bg-ok", ring: "border-ok/40 bg-ok/5" }
      : t.status === "in_progress"
        ? { dot: "bg-warn", ring: "border-warn/40 bg-warn/5" }
        : { dot: "bg-destructive", ring: "border-destructive/40 bg-destructive/5" };

  return (
    <Panel
      title="PERSONAL"
      icon={<Flag className="size-3.5" />}
      right={
        <span className="mono text-[10px] text-muted-foreground">
          {doneN}/{rows.length || 0} DONE
        </span>
      }
    >
      <p className="mono text-[9px] tracking-widest text-muted-foreground mb-2">
        YOURS · HIDDEN UNTIL YOU ASK FOR IT
      </p>

      <div className="space-y-1.5">
        {rows.length === 0 && (
          <p className="mono text-[10px] text-muted-foreground py-1">
            Nothing here. Add one with + and set the board to PERSONAL.
          </p>
        )}
        {rows.map((t) => {
          const l = light(t);
          const isSel = t.id === selectedId;
          return (
            <button
              key={t.id}
              onClick={() => setSelectedId(isSel ? null : t.id)}
              className={`w-full text-left border rounded-sm px-2.5 py-2 flex items-start gap-2 ${l.ring} ${
                isSel ? "ring-2 ring-primary border-primary" : ""
              }`}
            >
              <span className={`size-2.5 rounded-full mt-1 shrink-0 ${l.dot}`} />
              <span
                className={`text-[13px] leading-snug flex-1 min-w-0 ${
                  t.status === "done" ? "line-through text-muted-foreground" : ""
                }`}
              >
                {t.title}
              </span>
              <SchedStamp task={t} />
              <OwnerBadge task={t} />
              {isSel && (
                <span className="mono text-[8px] tracking-widest text-primary shrink-0 mt-0.5">
                  SELECTED
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="border border-border rounded-sm p-2.5 bg-background/40 mt-3">
          <div className="flex items-center gap-2 mb-2">
            <TitleEditor task={selected} label="" onSaved={onChange} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => act(selected.status === "done" ? "todo" : "done")}
              className="flex-1 min-w-[110px] mono text-[10px] tracking-widest px-2 py-2 rounded-sm border border-ok/60 text-ok hover:bg-ok/10"
            >
              {selected.status === "done" ? "REOPEN" : "COMPLETE"}
            </button>
            <ItemDialog
              userId={userId}
              onChange={onChange}
              task={selected}
              ventures={ventures}
              trigger={
                <button className="flex-1 min-w-[110px] mono text-[10px] tracking-widest px-2 py-2 rounded-sm border border-primary/60 text-primary hover:bg-primary/10">
                  EDIT
                </button>
              }
            />
            <button
              onClick={remove}
              className="mono text-[10px] tracking-widest px-2.5 py-2 rounded-sm border border-destructive/50 text-destructive hover:bg-destructive/10"
            >
              DELETE
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ---------------- tasks ---------------- */
// Build a spoken utterance using the best natural voice the device has (avoids the robotic default).
function makeUtterance(text: string): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.02;
  const vs = window.speechSynthesis?.getVoices?.() ?? [];
  const prefs = [/natural/i, /\bava\b/i, /samantha/i, /google us english/i, /aria/i, /jenny/i, /siri/i, /\bzira\b/i];
  let voice: SpeechSynthesisVoice | undefined;
  for (const p of prefs) {
    voice = vs.find((v) => /^en/i.test(v.lang) && p.test(v.name));
    if (voice) break;
  }
  if (!voice) voice = vs.find((v) => /en-US/i.test(v.lang)) ?? vs.find((v) => /^en/i.test(v.lang));
  if (voice) u.voice = voice;
  return u;
}

// Weekly tasks are Mon–Fri work; urgency builds as Friday nears.
function weekUrgencyLevel(): "none" | "mid" | "urgent" | "overdue" {
  const d = new Date().getDay(); // 0=Sun .. 6=Sat
  if (d === 3) return "mid"; // Wed
  if (d === 4 || d === 5) return "urgent"; // Thu/Fri
  if (d === 6 || d === 0) return "overdue"; // weekend = past due
  return "none"; // Mon/Tue
}

function TaskRow({
  task,
  goals,
  onChange,
  urgency = "none",
  dayOptions,
}: {
  task: Task;
  goals: Goal[];
  onChange: () => void;
  urgency?: "none" | "mid" | "urgent" | "overdue";
  dayOptions?: { date: string; short: string }[];
}) {
  async function setDay(date: string) {
    const { error } = await supabase.from("tasks").update({ due_date: date || null }).eq("id", task.id);
    if (error) toast.error(error.message);
    else onChange();
  }
  const goal = goals.find((g) => g.id === task.goal_id);
  const done = task.status === "done";
  const showUrg = !done && urgency !== "none";
  const urgMeta =
    urgency === "mid"
      ? { label: "MIDWEEK", border: "border-yellow-500/50", text: "text-yellow-500" }
      : urgency === "urgent"
        ? { label: "DUE FRI", border: "border-destructive/70", text: "text-destructive" }
        : { label: "OVERDUE", border: "border-destructive/70", text: "text-destructive" };

  async function toggle() {
    const { error } = await supabase
      .from("tasks")
      .update({
        status: done ? "todo" : "done",
        completed_at: done ? null : new Date().toISOString(),
      })
      .eq("id", task.id);
    if (error) toast.error(error.message);
    else onChange();
  }
  async function flipPile() {
    const { error } = await supabase
      .from("tasks")
      .update({ pile: task.pile === "signal" ? "noise" : "signal" })
      .eq("id", task.id);
    if (error) toast.error(error.message);
    else onChange();
  }
  async function swapPerson() {
    const { error } = await supabase
      .from("tasks")
      .update({ assigned_to: task.assigned_to === "em" ? "me" : "em" })
      .eq("id", task.id);
    if (error) toast.error(error.message);
    else onChange();
  }
  async function remove() {
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    if (error) toast.error(error.message);
    else onChange();
  }

  return (
    <li
      className={`border rounded-sm bg-background/40 transition-colors ${
        showUrg ? `${urgMeta.border} hover:border-primary/40` : "border-border hover:border-primary/40"
      }`}
    >
      <div className="flex items-center gap-2 p-2">
        <button onClick={toggle} className={done ? "text-ok" : "text-muted-foreground hover:text-primary"}>
          {done ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className={`text-sm leading-tight ${done ? "line-through text-muted-foreground" : ""}`}>
            {task.title}
          </div>
          {goal && (
            <div className="mono text-[9px] text-muted-foreground truncate">▸ {goal.title}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {showUrg && (
            <span
              className={`mono text-[9px] tracking-wider px-1.5 py-0.5 border rounded-sm ${urgMeta.border} ${urgMeta.text} ${
                urgency !== "mid" ? "animate-pulse" : ""
              }`}
            >
              {urgMeta.label}
            </span>
          )}
          {dayOptions && (
            <select
              value={task.due_date ?? ""}
              onChange={(e) => setDay(e.target.value)}
              title="Assign a day"
              className="mono text-[9px] bg-background border border-border rounded-sm px-1 py-0.5 text-muted-foreground focus:text-primary"
            >
              <option value="">day</option>
              {dayOptions.map((d) => (
                <option key={d.date} value={d.date}>{d.short}</option>
              ))}
            </select>
          )}
          <button
            onClick={flipPile}
            title="Flip pile"
            className={`mono text-[9px] px-1.5 py-0.5 border rounded-sm ${
              task.pile === "signal" ? "border-ok/50 text-ok" : "border-danger/50 text-danger"
            }`}
          >
            {task.pile === "signal" ? "🟢" : "🔴"}
          </button>
          <button
            onClick={swapPerson}
            title="Swap person"
            className="mono text-[9px] px-1.5 py-0.5 border border-border rounded-sm text-muted-foreground hover:text-primary"
          >
            {task.assigned_to.toUpperCase()}
          </button>
          <button
            onClick={remove}
            title="Delete"
            className="mono text-[9px] px-1.5 py-0.5 border border-border rounded-sm text-muted-foreground hover:text-danger"
          >
            ×
          </button>
        </div>
      </div>
    </li>
  );
}

function AddTaskInline({
  userId,
  horizon,
  pile,
  goals,
  onChange,
}: {
  userId: string;
  horizon: "today" | "week" | "month";
  pile: "signal" | "noise";
  goals: Goal[];
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [goalId, setGoalId] = useState<string>("");
  const [person, setPerson] = useState<"em" | "me">("em");

  async function add() {
    if (!title.trim()) return;
    const { error } = await supabase.from("tasks").insert({
      user_id: userId,
      title: title.trim(),
      horizon,
      pile,
      assigned_to: person,
      goal_id: goalId || null,
      due_date: horizon === "today" ? todayStr() : null,
    });
    if (error) toast.error(error.message);
    else {
      setTitle("");
      setGoalId("");
      onChange();
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full mono text-[10px] tracking-widest text-muted-foreground hover:text-primary border border-dashed border-border rounded-sm py-2 flex items-center justify-center gap-1"
      >
        <Plus className="size-3" /> ADD TASK
      </button>
    );
  }
  return (
    <div className="border border-primary/40 rounded-sm p-2 bg-background/60 space-y-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder="Task title…"
        className="w-full bg-background border border-border rounded-sm px-2 py-1 text-sm"
      />
      <div className="flex gap-2 flex-wrap">
        <select
          value={goalId}
          onChange={(e) => setGoalId(e.target.value)}
          className="bg-background border border-border rounded-sm px-2 py-1 mono text-[10px] flex-1 min-w-0"
        >
          <option value="">— no goal —</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
        <select
          value={person}
          onChange={(e) => setPerson(e.target.value as "em" | "me")}
          className="bg-background border border-border rounded-sm px-2 py-1 mono text-[10px]"
        >
          <option value="em">EM</option>
          <option value="me">ME</option>
        </select>
        <button
          onClick={add}
          className="mono text-[10px] tracking-widest bg-primary text-primary-foreground px-3 py-1 rounded-sm"
        >
          ADD
        </button>
        <button
          onClick={() => { setOpen(false); setTitle(""); }}
          className="mono text-[10px] text-muted-foreground px-2"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function TodayPanel({
  tasks,
  userId,
  onChange,
}: {
  tasks: Task[];
  userId: string;
  onChange: () => void;
}) {
  // need goals for inline-add and task row labels
  const qc = useQueryClient();
  const goals = (qc.getQueryData<{ goals: Goal[] }>(["command-center", userId])?.goals) ?? [];

  // Day-driven TODAY: due today (open OR completed-today = your scratch-offs), overdue-and-still-open
  // carries over, and legacy no-date "today" tasks still show. Anything completed on a PRIOR day rolls off.
  const todayS = todayStr();
  const localDateOf = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const inToday = (t: Task) => {
    const belongsToday = t.due_date === todayS || (t.horizon === "today" && !t.due_date);
    if (t.status === "done") return belongsToday && localDateOf(t.completed_at) === todayS; // today's task, finished today
    if (belongsToday) return true;
    return !!(t.due_date && t.due_date < todayS); // overdue, day-assigned, still open → carry over
  };
  const today = tasks.filter(inToday);
  const signal = today.filter((t) => t.pile === "signal");
  const noise = today.filter((t) => t.pile === "noise");

  return (
    <Panel
      title="OPS BOARD // TODAY"
      icon={<Zap className="size-3.5" />}
      right={
        <span className="mono text-[10px] text-muted-foreground">
          {signal.filter((t) => t.status !== "done").length} OPEN
        </span>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Column
          label="🟢 NEEDS ME · SIGNAL"
          accent="border-ok/40 text-ok"
          tasks={signal}
          goals={goals}
          onChange={onChange}
          adder={<AddTaskInline userId={userId} horizon="today" pile="signal" goals={goals} onChange={onChange} />}
        />
        <div data-focus-hide>
          <Column
            label="🔴 DELEGATED · NOISE"
            accent="border-danger/40 text-danger"
            tasks={noise}
            goals={goals}
            onChange={onChange}
            adder={<AddTaskInline userId={userId} horizon="today" pile="noise" goals={goals} onChange={onChange} />}
          />
        </div>
      </div>
    </Panel>
  );
}

function Column({
  label,
  accent,
  tasks,
  goals,
  onChange,
  adder,
}: {
  label: string;
  accent: string;
  tasks: Task[];
  goals: Goal[];
  onChange: () => void;
  adder: React.ReactNode;
}) {
  return (
    <div className={`border rounded-sm p-2 bg-background/30 ${accent}`}>
      <div className="mono text-[10px] tracking-widest mb-2 px-1">{label}</div>
      <ul className="space-y-2">
        {tasks.length === 0 && (
          <li className="mono text-[10px] text-muted-foreground italic px-1">— empty —</li>
        )}
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} goals={goals} onChange={onChange} />
        ))}
      </ul>
      <div className="mt-2">{adder}</div>
    </div>
  );
}

/* ---------------- horizon ---------------- */
function HorizonPanel({
  title,
  horizon,
  tasks,
  goals,
  userId,
  onChange,
}: {
  title: string;
  horizon: "week" | "month";
  tasks: Task[];
  goals: Goal[];
  userId: string;
  onChange: () => void;
}) {
  const items = tasks.filter((t) => t.horizon === horizon);
  const weekUrg = horizon === "week" ? weekUrgencyLevel() : "none";
  const grouped = new Map<string, Task[]>();
  items.forEach((t) => {
    const k = t.goal_id ?? "_none";
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(t);
  });

  return (
    <Panel
      title={title}
      icon={<Repeat className="size-3.5" />}
      right={
        <span className="mono text-[10px] text-muted-foreground">
          {items.filter((t) => t.status !== "done").length} OPEN
        </span>
      }
    >
      <div className="space-y-3">
        {Array.from(grouped.entries()).map(([gid, ts]) => {
          const goal = goals.find((g) => g.id === gid);
          return (
            <div key={gid}>
              <div className="mono text-[10px] tracking-widest text-accent mb-1.5">
                ▸ {goal?.title ?? "UNASSIGNED"}
              </div>
              <ul className="space-y-1.5">
                {ts.map((t) => (
                  <TaskRow key={t.id} task={t} goals={goals} onChange={onChange} urgency={weekUrg} />
                ))}
              </ul>
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="mono text-[10px] text-muted-foreground italic">— no items —</div>
        )}
        <AddTaskInline userId={userId} horizon={horizon} pile="signal" goals={goals} onChange={onChange} />
      </div>
    </Panel>
  );
}

/* ---------------- habits ---------------- */
function HabitsPanel({
  habits,
  logs,
  userId,
  onChange,
}: {
  habits: Habit[];
  logs: HabitLog[];
  userId: string;
  onChange: () => void;
}) {
  return (
    <Panel
      title="DAILY SYSTEMS"
      icon={<Power className="size-3.5" />}
      right={<span className="mono text-[10px] text-muted-foreground">{habits.length} ACTIVE</span>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {habits.map((h) => (
          <HabitCard key={h.id} habit={h} logs={logs} userId={userId} onChange={onChange} />
        ))}
      </div>
    </Panel>
  );
}

function HabitCard({
  habit,
  logs,
  userId,
  onChange,
}: {
  habit: Habit;
  logs: HabitLog[];
  userId: string;
  onChange: () => void;
}) {
  const today = todayStr();
  const todayLog = logs.find((l) => l.habit_id === habit.id && l.log_date === today);
  const checked = !!todayLog?.done;
  const streak = useMemo(() => computeStreak(logs, habit.id), [logs, habit.id]);
  const streakPct = Math.min(100, (streak / 30) * 100);

  async function toggle() {
    if (todayLog) {
      const { error } = await supabase
        .from("habit_logs")
        .update({ done: !checked })
        .eq("id", todayLog.id);
      if (error) toast.error(error.message);
    } else {
      const { error } = await supabase.from("habit_logs").insert({
        user_id: userId,
        habit_id: habit.id,
        log_date: today,
        done: true,
      });
      if (error) toast.error(error.message);
    }
    onChange();
  }

  return (
    <button
      onClick={toggle}
      className={`text-left border rounded-sm p-3 transition-all ${
        checked
          ? "border-ok/60 bg-ok/5 shadow-[0_0_15px_-5px] shadow-ok/40"
          : "border-border bg-background/40 hover:border-primary/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl shrink-0">{habit.icon ?? "◆"}</span>
          <div className="min-w-0">
            <div className="text-sm font-medium leading-tight">{habit.name}</div>
            <div className="mono text-[9px] text-muted-foreground">{habit.target}</div>
          </div>
        </div>
        {checked ? (
          <CheckCircle2 className="size-4 text-ok shrink-0" />
        ) : (
          <Circle className="size-4 text-muted-foreground shrink-0" />
        )}
      </div>
      <div className="flex justify-between mono text-[9px] mb-1">
        <span className="text-muted-foreground tracking-wider">STREAK</span>
        <span className={checked ? "text-ok" : "text-foreground"}>{streak} DAYS</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-sm overflow-hidden">
        <div
          className={`h-full ${checked ? "bg-ok shadow-[0_0_8px] shadow-ok" : "bg-primary"}`}
          style={{ width: `${streakPct}%` }}
        />
      </div>
    </button>
  );
}

/* ---------------- field pt (daily workout) ---------------- */
function WorkoutPanel() {
  const LEN = WORKOUT_PLAN_LEN;
  const [day, setDay] = useState(1);
  const [checks, setChecks] = useState<boolean[]>([]);

  // current day persists locally (per-device); starts at Day 1.
  useEffect(() => {
    try {
      const d = parseInt(localStorage.getItem("pt-day") || "1", 10);
      setDay(Number.isFinite(d) && d >= 1 && d <= LEN ? d : 1);
    } catch { /* ignore */ }
  }, [LEN]);

  // load today's checkmarks whenever the day changes
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`pt-checks:${day}`);
      setChecks(raw ? (JSON.parse(raw) as boolean[]) : []);
    } catch { setChecks([]); }
  }, [day]);

  const workout = workoutForDay(day);
  const week = weekOfDay(day);

  function goToDay(d: number) {
    const nd = (((d - 1) % LEN) + LEN) % LEN + 1;
    setDay(nd);
    try { localStorage.setItem("pt-day", String(nd)); } catch { /* ignore */ }
  }
  function toggleCheck(i: number) {
    setChecks((c) => {
      const next = [...c];
      next[i] = !next[i];
      try { localStorage.setItem(`pt-checks:${day}`, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  function complete() {
    try { localStorage.removeItem(`pt-checks:${day}`); } catch { /* ignore */ }
    goToDay(day + 1);
  }
  function reset() {
    try { localStorage.removeItem(`pt-checks:${day}`); } catch { /* ignore */ }
    goToDay(1);
  }

  const doneCount = workout.exercises.filter((_, i) => checks[i]).length;
  const allDone = !workout.rest && workout.exercises.length > 0 && doneCount === workout.exercises.length;
  const progressPct = (((day - 1) % LEN) / LEN) * 100;

  return (
    <Panel
      title="FIELD PT // DAILY"
      icon={<Dumbbell className="size-3.5" />}
      right={<span className="mono text-[10px] text-muted-foreground">DAY {day}/{LEN} · WK {week}</span>}
    >
      <div className="h-1.5 bg-secondary rounded-sm overflow-hidden mb-3">
        <div
          className="h-full bg-ok shadow-[0_0_8px] shadow-ok/60 transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {workout.rest ? (
        <div className="border border-border rounded-sm p-4 bg-background/40 text-center">
          <div className="mono text-lg tracking-widest text-accent">◎ REST DAY</div>
          <div className="mono text-[10px] text-muted-foreground mt-1">
            Recover. Hydrate. Back at it tomorrow.
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {workout.exercises.map((ex, i) => {
            const done = !!checks[i];
            return (
              <li key={i}>
                <button
                  onClick={() => toggleCheck(i)}
                  className={`w-full flex items-center gap-2 border rounded-sm p-2 text-left transition-colors ${
                    done ? "border-ok/60 bg-ok/5" : "border-border bg-background/40 hover:border-primary/40"
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="size-4 text-ok shrink-0" />
                  ) : (
                    <Circle className="size-4 text-muted-foreground shrink-0" />
                  )}
                  <span className={`text-sm flex-1 leading-tight ${done ? "line-through text-muted-foreground" : ""}`}>
                    {ex.name}
                  </span>
                  <span className="mono text-[11px] text-accent shrink-0">{ex.scheme}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => goToDay(day - 1)}
          className="mono text-[10px] tracking-widest px-2.5 py-1.5 border border-border rounded-sm text-muted-foreground hover:text-primary"
        >
          ◀
        </button>
        <button
          onClick={complete}
          className={`flex-1 mono text-[10px] tracking-widest py-1.5 rounded-sm border transition-colors ${
            workout.rest || allDone
              ? "border-ok text-ok bg-ok/10"
              : "border-border text-muted-foreground hover:text-primary"
          }`}
        >
          {workout.rest
            ? "LOGGED · NEXT DAY ▶"
            : allDone
              ? "COMPLETE · NEXT DAY ▶"
              : `NEXT DAY ▶  (${doneCount}/${workout.exercises.length})`}
        </button>
        <button
          onClick={reset}
          title="Restart at Day 1"
          className="mono text-[10px] px-2.5 py-1.5 border border-border rounded-sm text-muted-foreground hover:text-danger"
        >
          ⟲
        </button>
      </div>
      <div className="mt-2 mono text-[9px] text-muted-foreground text-center tracking-wider">
        21-DAY MILITARY CALISTHENICS · NO EQUIPMENT
      </div>
    </Panel>
  );
}

/* ---------------- telemetry / results ---------------- */
function TelemetryPanel({
  results,
  userId,
  goals,
  onChange,
}: {
  results: Result[];
  userId: string;
  goals: Goal[];
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [goalId, setGoalId] = useState("");

  // latest per metric_key
  const latest = useMemo(() => {
    const m = new Map<string, Result>();
    for (const r of results) {
      const ex = m.get(r.metric_key);
      if (!ex || new Date(r.as_of) > new Date(ex.as_of)) m.set(r.metric_key, r);
    }
    return Array.from(m.values()).slice(0, 8);
  }, [results]);

  async function add() {
    if (!label.trim() || !value) return;
    const v = parseFloat(value);
    if (isNaN(v)) return;
    const { error } = await supabase.from("results").insert({
      user_id: userId,
      metric_key: label.toLowerCase().replace(/\s+/g, "_"),
      label: label.trim(),
      value: v,
      unit: unit || null,
      goal_id: goalId || null,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Result logged");
      setLabel(""); setValue(""); setUnit(""); setGoalId(""); setAdding(false);
      onChange();
    }
  }

  return (
    <Panel
      title="TELEMETRY // RESULTS"
      icon={<Activity className="size-3.5" />}
      right={
        <button
          onClick={() => setAdding((a) => !a)}
          className="mono text-[9px] text-muted-foreground hover:text-primary border border-border px-1.5 py-0.5 rounded-sm"
        >
          {adding ? "✕" : "+ ADD"}
        </button>
      }
    >
      {adding && (
        <div className="border border-primary/40 rounded-sm p-2 bg-background/60 mb-3 space-y-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Metric label (e.g. Weight)"
            className="w-full bg-background border border-border rounded-sm px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Value"
              className="flex-1 bg-background border border-border rounded-sm px-2 py-1 mono text-sm"
            />
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="Unit"
              className="w-20 bg-background border border-border rounded-sm px-2 py-1 mono text-sm"
            />
          </div>
          <select
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            className="w-full bg-background border border-border rounded-sm px-2 py-1 mono text-[10px]"
          >
            <option value="">— no goal —</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
          <button
            onClick={add}
            className="w-full mono text-[10px] tracking-widest bg-primary text-primary-foreground py-1.5 rounded-sm"
          >
            LOG RESULT
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {latest.map((r) => {
          const history = results.filter((x) => x.metric_key === r.metric_key);
          const prev = history[1];
          const delta = prev ? r.value - prev.value : 0;
          return (
            <div key={r.id} className="border border-border rounded-sm p-2 bg-background/40">
              <div className="mono text-[9px] text-muted-foreground tracking-wider truncate">
                {r.label.toUpperCase()}
              </div>
              <div className="mono text-2xl text-accent leading-tight">
                {Number(r.value).toLocaleString()}
                {r.unit && <span className="text-[10px] text-muted-foreground ml-1">{r.unit}</span>}
              </div>
              <div className={`mono text-[9px] ${delta > 0 ? "text-ok" : delta < 0 ? "text-danger" : "text-muted-foreground"}`}>
                {delta > 0 ? "▲" : delta < 0 ? "▼" : "◆"} {Math.abs(delta).toFixed(2)} vs prev
              </div>
            </div>
          );
        })}
        {latest.length === 0 && (
          <div className="col-span-2 mono text-[10px] text-muted-foreground italic">
            — no telemetry yet —
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ---------------- milestones ---------------- */
function MilestonesPanel({
  milestones,
  userId,
  onChange,
}: {
  milestones: Milestone[];
  userId: string;
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const sorted = [...milestones].sort((a, b) => {
    if (a.status !== b.status) return a.status === "hit" ? -1 : 1;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });

  async function add() {
    if (!title.trim()) return;
    const { error } = await supabase.from("milestones").insert({
      user_id: userId,
      title: title.trim(),
      status: "upcoming",
      sort_order: (milestones[milestones.length - 1]?.sort_order ?? 0) + 1,
    });
    if (error) toast.error(error.message);
    else {
      setTitle(""); setAdding(false);
      onChange();
    }
  }

  async function markHit(m: Milestone) {
    const { error } = await supabase
      .from("milestones")
      .update({
        status: m.status === "hit" ? "upcoming" : "hit",
        date_hit: m.status === "hit" ? null : todayStr(),
      })
      .eq("id", m.id);
    if (error) toast.error(error.message);
    else onChange();
  }

  return (
    <Panel
      title="MISSION TIMELINE"
      icon={<Flag className="size-3.5" />}
      right={
        <button
          onClick={() => setAdding((a) => !a)}
          className="mono text-[9px] text-muted-foreground hover:text-primary border border-border px-1.5 py-0.5 rounded-sm"
        >
          {adding ? "✕" : "+ ADD"}
        </button>
      }
    >
      {adding && (
        <div className="flex gap-2 mb-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Milestone…"
            className="flex-1 bg-background border border-border rounded-sm px-2 py-1 text-sm"
          />
          <button
            onClick={add}
            className="mono text-[10px] bg-primary text-primary-foreground px-3 rounded-sm"
          >
            ADD
          </button>
        </div>
      )}
      <ol className="relative border-l border-border ml-2 space-y-3">
        {sorted.map((m) => {
          const hit = m.status === "hit";
          return (
            <li key={m.id} className="pl-4 relative">
              <span
                className={`absolute -left-[7px] top-1 size-3 rounded-full border-2 ${
                  hit
                    ? "bg-ok border-ok shadow-[0_0_8px] shadow-ok"
                    : "bg-background border-muted-foreground"
                }`}
              />
              <button
                onClick={() => markHit(m)}
                className="text-left w-full group"
              >
                <div className={`text-sm leading-tight ${hit ? "text-ok" : "text-foreground"}`}>
                  {hit ? "✅" : "⏭️"} {m.title}
                </div>
                <div className="mono text-[9px] text-muted-foreground">
                  {hit && m.date_hit ? `HIT · ${m.date_hit}` : "UPCOMING"} ·{" "}
                  <span className="group-hover:text-primary">click to toggle</span>
                </div>
              </button>
            </li>
          );
        })}
        {sorted.length === 0 && (
          <li className="pl-4 mono text-[10px] text-muted-foreground italic">— none yet —</li>
        )}
      </ol>
    </Panel>
  );
}

/* ---------------- ventures portfolio ---------------- */
type VenturePhase = {
  id: string;
  venture_id: string;
  idx: number;
  name: string;
  goal: string | null;
  exit_test: string | null;
  blocker: string | null;
  status: "done" | "current" | "next" | "later";
};


function VenturesPanel({ ventures }: { ventures: Venture[] }) {
  // Doctor's latest run, matched per card by the venture's health_site.
  const { data: run } = useQuery({
    queryKey: ["health-latest"],
    refetchInterval: 120000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("health_runs")
        .select("ran_at,site_results")
        .order("ran_at", { ascending: false })
        .limit(1);
      return (data ?? [])[0] ?? null;
    },
  });
  const results = (run?.site_results ?? {}) as Record<
    string,
    { url?: string; checks?: number; failures?: number; failing?: string[] }
  >;

  const { data: phases } = useQuery({
    queryKey: ["venture-phases"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("venture_phases")
        .select("*")
        .order("idx");
      return (data ?? []) as VenturePhase[];
    },
  });
  const phaseFor = (vid: string) => {
    const mine = (phases ?? []).filter((p) => p.venture_id === vid);
    const cur = mine.find((p) => p.status === "current");
    const doneN = mine.filter((p) => p.status === "done").length;
    return { cur, doneN, total: mine.length };
  };
  const ranAt = run?.ran_at ? new Date(run.ran_at) : null;
  const stale = !!ranAt && Date.now() - ranAt.getTime() > 48 * 3600000;
  const checkedAt = ranAt
    ? "checked " +
      ranAt.toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "never checked";

  if (!ventures.length) return null;
  const dot = (health: string | null) =>
    health === "red" ? "bg-destructive" : health === "yellow" ? "bg-yellow-400" : "bg-emerald-400";
  return (
    <Panel title="VENTURES // PORTFOLIO" icon={<Crosshair className="size-3.5" />}>
      <div className="flex gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-4 lg:overflow-visible">
        {ventures.map((v) => (
          <div
            key={v.id}
            className="relative shrink-0 w-[240px] lg:w-auto rounded-sm border bg-secondary/30 p-3"
            style={{
              borderColor: "#F0C64A",
              boxShadow:
                "0 0 0 1px rgba(240,198,74,0.85), 0 0 10px rgba(240,198,74,0.75), 0 0 28px rgba(240,198,74,0.45), 0 0 56px rgba(240,198,74,0.22)",
            }}
          >
            <span
              className={`absolute top-2.5 right-2.5 size-2 rounded-full ${dot(v.health)} shadow-[0_0_8px] ${
                v.health === "red"
                  ? "shadow-destructive"
                  : v.health === "yellow"
                    ? "shadow-yellow-400"
                    : "shadow-emerald-400"
              }`}
            />
            <div className="mono text-[11px] font-bold tracking-widest text-foreground pr-4 truncate">
              {v.name}
            </div>
            {(() => {
              const { cur, doneN, total } = phaseFor(v.id);
              if (!total) {
                return (
                  <p className="mono text-[9px] text-muted-foreground/70 mt-1.5">
                    no plan yet
                  </p>
                );
              }
              return (
                <div className="mt-1.5 border border-primary/40 bg-primary/5 rounded-sm p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono text-[9px] tracking-widest text-primary truncate">
                      {cur ? `PHASE ${cur.idx} · ${cur.name}` : "ALL PHASES DONE"}
                    </span>
                    <span className="mono text-[8px] text-muted-foreground shrink-0">
                      {doneN}/{total}
                    </span>
                  </div>
                  {/* progress pips - one per phase, filled as they close */}
                  <div className="flex gap-0.5 mt-1.5">
                    {(phases ?? [])
                      .filter((p) => p.venture_id === v.id)
                      .map((p) => (
                        <span
                          key={p.id}
                          title={`${p.idx}. ${p.name} — ${p.status}`}
                          className={`h-1 flex-1 rounded-sm ${
                            p.status === "done"
                              ? "bg-ok"
                              : p.status === "current"
                                ? "bg-primary"
                                : "bg-border"
                          }`}
                        />
                      ))}
                  </div>
                  {cur?.goal && (
                    <p className="text-[10px] leading-snug text-foreground/90 mt-1.5">
                      {cur.goal}
                    </p>
                  )}
                  {cur?.exit_test && (
                    <p className="mono text-[9px] text-muted-foreground mt-1 leading-snug">
                      DONE WHEN: {cur.exit_test}
                    </p>
                  )}
                  {cur?.blocker && (
                    <p className="mono text-[9px] text-destructive mt-1.5 leading-snug">
                      BLOCKED: {cur.blocker}
                    </p>
                  )}
                </div>
              );
            })()}
            {v.stage && (
              <span className="inline-block mt-1.5 mono text-[9px] tracking-wider text-primary border border-primary/40 bg-primary/10 rounded-sm px-1.5 py-0.5">
                {v.stage}
              </span>
            )}
            {v.status_line && (
              <p className="mono text-[9px] text-muted-foreground mt-1.5 leading-snug">{v.status_line}</p>
            )}
            {(() => {
              const site = (v as any).health_site as string | null;
              if (!site) {
                return (
                  <p className="mono text-[9px] text-muted-foreground/70 mt-2 pt-2 border-t border-border">
                    DR · no site yet
                  </p>
                );
              }
              const r = results[site];
              if (!r) {
                return (
                  <p className="mono text-[9px] text-warn mt-2 pt-2 border-t border-border">
                    DR · not checked
                  </p>
                );
              }
              const bad = (r.failures ?? 0) > 0;
              return (
                <div className="mt-2 pt-2 border-t border-border">
                  <p className={`mono text-[9px] ${bad ? "text-destructive" : "text-ok"}`}>
                    DR ·{" "}
                    {bad
                      ? `${r.failures} of ${r.checks} checks failing`
                      : `all ${r.checks} checks pass`}
                  </p>
                  {/* A result with no age on it cannot tell you the checker has
                      stopped, which is the failure nobody notices. */}
                  <p
                    className={`mono text-[8px] ${
                      stale ? "text-warn" : "text-muted-foreground/70"
                    }`}
                  >
                    {stale ? "STALE · " : ""}
                    {checkedAt}
                  </p>
                  {bad && (
                    <ul className="mt-1 space-y-0.5">
                      {(r.failing ?? []).slice(0, 3).map((f, i) => (
                        <li key={i} className="mono text-[9px] text-destructive/80 leading-snug">
                          · {f}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ---------------- cash radar ---------------- */
function CashRadarPanel({
  payments,
  userId,
  onChange,
}: {
  payments: UpcomingPayment[];
  userId: string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [monthly, setMonthly] = useState(true);

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    const dt = new Date(d + "T12:00:00");
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  };
  const monthlyBurn = payments
    .filter((p) => p.recurrence === "monthly")
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  async function addPayment() {
    if (!name.trim() || !amount) return;
    const { error } = await (supabase as any).from("upcoming_payments").insert({
      user_id: userId,
      name: name.trim(),
      amount: Number(amount),
      due_date: due || null,
      recurrence: monthly ? "monthly" : "one-time",
    });
    if (error) toast.error(error.message);
    else {
      setName(""); setAmount(""); setDue(""); setOpen(false);
      onChange();
    }
  }

  async function removePayment(id: string) {
    const { error } = await (supabase as any).from("upcoming_payments").delete().eq("id", id);
    if (error) toast.error(error.message);
    else onChange();
  }

  return (
    <Panel
      title="THIS MONTH // BUDGET"
      icon={<Activity className="size-3.5" />}
      right={
        <button
          onClick={() => setOpen((o) => !o)}
          className="mono text-[10px] tracking-widest text-primary border border-primary/40 bg-primary/10 rounded-sm px-2 py-1"
        >
          + ADD
        </button>
      }
    >
      {open && (
        <div className="mb-3 p-2 border border-border rounded-sm bg-secondary/30 space-y-2">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bill name…"
              className="flex-1 min-w-0 bg-background border border-border rounded-sm px-2 py-1 mono text-[11px]"
            />
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="$"
              inputMode="decimal"
              className="w-16 bg-background border border-border rounded-sm px-2 py-1 mono text-[11px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="bg-background border border-border rounded-sm px-2 py-1 mono text-[10px]"
            />
            <label className="mono text-[10px] text-muted-foreground flex items-center gap-1">
              <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
              MONTHLY
            </label>
            <button
              onClick={addPayment}
              className="ml-auto mono text-[10px] tracking-widest bg-primary text-primary-foreground px-3 py-1 rounded-sm"
            >
              ADD
            </button>
            <button
              onClick={() => setOpen(false)}
              className="mono text-[10px] text-muted-foreground px-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {payments.length === 0 && (
        <p className="mono text-[10px] text-muted-foreground">No upcoming payments tracked.</p>
      )}
      <ul className="space-y-2">
        {payments.map((p) => {
          const cancel = (p.notes ?? "").toUpperCase().includes("CANCEL");
          return (
            <li key={p.id} className="group flex items-baseline gap-2">
              <span
                className={`mono text-[10px] tracking-wider shrink-0 w-14 ${
                  cancel ? "text-destructive" : "text-primary"
                }`}
              >
                {fmtDate(p.due_date)}
              </span>
              <span className="mono text-[11px] text-foreground truncate">{p.name}</span>
              <span className="mono text-[9px] text-muted-foreground truncate hidden sm:inline">
                {p.venture ?? ""}
              </span>
              <span className="mono text-[11px] text-foreground ml-auto shrink-0">
                ${Number(p.amount ?? 0)}
                {p.recurrence === "monthly" ? "/mo" : ""}
              </span>
              <button
                onClick={() => removePayment(p.id)}
                aria-label={`Remove ${p.name}`}
                className="mono text-[10px] text-muted-foreground/40 hover:text-destructive px-0.5 shrink-0"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 pt-2 border-t border-border mono text-[10px] tracking-widest text-muted-foreground">
        TOTAL MONTHLY BURN: <span className="text-foreground">${monthlyBurn}/mo</span>
      </div>
    </Panel>
  );
}

/* ---------------- comms // EM (JARVIS v1) ---------------- */
type EmMessage = {
  id: string;
  user_id: string;
  sender: "me" | "em" | "codex" | "central";
  // who it is FOR. Added 2026-09-16; rows written before then default to
  // 'central', which is what they were in practice.
  recipient?: "central" | "em" | "codex";
  body: string;
  status: string;
  created_at: string;
};

function CommsPanel({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const baseRef = useRef("");
  const [voiceOn, setVoiceOn] = useState(false);
  const spokenRef = useRef<Set<string>>(new Set());
  // Who the next message is addressed to. Until 2026-09-16 every typed message
  // was implicitly for Central and nothing recorded a recipient at all, so a
  // message for EM had nowhere to be picked up from.
  // Two real agents. The in-app assistant is not one of them - it cannot do
  // work, and a third voice only muddied who the user was actually talking to.
  const [target, setTarget] = useState<"em" | "codex">("em");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Voice input isn't supported in this browser — use your keyboard's 🎤 key instead.");
      return;
    }
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    baseRef.current = draft ? draft.trim() + " " : "";
    rec.onresult = (e: any) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setDraft(baseRef.current + t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  const { data: messages = [] } = useQuery({
    queryKey: ["em-messages", userId],
    refetchInterval: 20000,
    queryFn: async () => {
      // Ascending + limit(100) fetched the OLDEST hundred, so once the table
      // passed 100 rows every new message landed outside the window and the
      // feed silently froze in the past - the user sent messages that arrived
      // fine and never appeared. Take the newest hundred, then flip them back
      // into reading order.
      const { data } = await (supabase as any)
        .from("messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      return ((data ?? []) as EmMessage[]).slice().reverse();
    },
  });

  useEffect(() => {
    const ch = (supabase as any)
      .channel("em-comms")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => qc.invalidateQueries({ queryKey: ["em-messages", userId] }),
      )
      .subscribe();
    return () => {
      (supabase as any).removeChannel(ch);
    };
  }, [qc, userId]);

  useEffect(() => {
    const box = document.getElementById("em-comms-scroll");
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages.length]);

  // when VOICE is switched on, mark existing messages as already-spoken (only read NEW replies aloud)
  useEffect(() => {
    if (voiceOn) messages.forEach((m) => spokenRef.current.add(m.id));
    else window.speechSynthesis?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOn]);

  // speak Central's new replies aloud (this is Central's real voice — same brain, in the cockpit)
  useEffect(() => {
    if (!voiceOn || typeof window === "undefined" || !window.speechSynthesis) return;
    for (const m of messages) {
      if (m.sender === "em" && !spokenRef.current.has(m.id)) {
        spokenRef.current.add(m.id);
        const clean = m.body.replace(/[*_#`>]/g, "").replace(/\s+/g, " ").trim();
        window.speechSynthesis.speak(makeUtterance(clean));
      }
    }
  }, [messages, voiceOn]);

  // The feed renders oldest-first inside a fixed-height scroller, so a new
  // message lands ~100 rows below the fold. the user reported replies "not
  // arriving" when they had arrived and were simply out of view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const { error } = await (supabase as any).from("messages").insert({
      user_id: userId,
      sender: "me",
      recipient: target,
      body,
      status: "new",
    });
    if (error) {
      toast.error(error.message);
      setSending(false);
      return;
    }
    setDraft("");
    qc.invalidateQueries({ queryKey: ["em-messages", userId] });

    // Both recipients are real agents that cannot be woken, so neither gets a
    // fake instant reply. The watcher carries this to their inbox file within
    // two minutes, and they answer back into this same feed with say.py.
    toast.success(
      `Queued for ${target.toUpperCase()} — in their inbox within 2 minutes.`,
    );
    setSending(false);
  }

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <Panel
      title="COMMS // THE TABLE"
      icon={<Satellite className="size-3.5" />}
      right={
        <div className="flex items-center gap-1">
        {/* Two lines, two jobs. Central knows the board and the day; EM knows
            whether the systems are actually up. EM's line is an OpenAI realtime
            voice with EM's context - NOT the Claude Code session - and it says
            so itself rather than pretending it can write code. */}
        {/* VOICE PAUSED 2026-09-16 at the user's request. Text in/out with the
            two real agents gets certified first; the voice role (live research
            + hand-off, never building) is decided after that. The component and
            its server functions are intact - flip this back on by rendering it. */}
        {false && <CentralVoice userId={userId} persona="central" />}
        <button
          onClick={() => {
            const next = !voiceOn;
            setVoiceOn(next);
            if (next) {
              // speak inside the tap gesture → unlocks audio + confirms it works
              try {
                window.speechSynthesis?.cancel();
                window.speechSynthesis?.speak(makeUtterance("Voice on. Central here."));
              } catch { /* ignore */ }
            } else {
              window.speechSynthesis?.cancel();
            }
          }}
          title={voiceOn ? "Central speaks replies aloud (tap to mute)" : "Turn on Central's voice"}
          className={`mono text-[10px] tracking-widest px-2 py-1 border rounded-sm ${
            voiceOn
              ? "border-primary text-primary bg-primary/10"
              : "border-border text-muted-foreground hover:text-primary"
          }`}
        >
          {voiceOn ? "🔊 VOICE" : "🔇 VOICE"}
        </button>
        </div>
      }
    >
      <div
        id="em-comms-scroll"
        ref={scrollRef}
        className="max-h-72 overflow-y-auto space-y-2 pr-1"
      >
        {messages.length === 0 && (
          <p className="mono text-[10px] text-muted-foreground">
            The table — you, EM, and Codex. Say something; they can answer and edit your board.
          </p>
        )}
        {messages.map((m) => {
          // three parties at the table: the user, EM (Claude Code), Codex. Legacy "central" = EM.
          const who = m.sender === "me" ? "me" : m.sender === "codex" ? "codex" : "em";
          const label = who === "me" ? "JANZI" : who === "codex" ? "◉ CODEX" : "◉ EM";
          const right = who === "me";
          const bubble =
            who === "me" ? "border-primary/40 bg-primary/10"
            : who === "codex" ? "border-accent/40 bg-accent/10"
            : "border-ok/40 bg-ok/5";
          const labelColor = who === "me" ? "text-primary" : who === "codex" ? "text-accent" : "text-ok";
          return (
            <div key={m.id} className={`flex ${right ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-sm border px-2.5 py-1.5 ${bubble}`}>
                <div className={`mono text-[9px] tracking-widest ${labelColor} mb-0.5`}>
                  {label} · {fmtTime(m.created_at)}
                  {/* show where a message was sent, so an unanswered one is
                      visibly waiting on someone rather than just sitting there */}
                  {right && m.recipient ? (
                    <span className="text-muted-foreground">
                      {" "}→ {String(m.recipient).toUpperCase()}
                      {m.status === "new" ? " · unread" : ""}
                    </span>
                  ) : null}
                </div>
                <div className="text-[12px] leading-snug whitespace-pre-wrap">{m.body}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="mono text-[9px] tracking-widest text-muted-foreground">
          TO
        </span>
        {(["em", "codex"] as const).map((who) => (
          <button
            key={who}
            onClick={() => setTarget(who)}
            title={
              who === "em"
                ? "EM — Claude Code. Replies back into this feed."
                : "Codex — the Codex app. Replies back into this feed."
            }
            className={`mono text-[10px] tracking-widest px-2 py-1 border rounded-sm ${
              target === who
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:text-primary"
            }`}
          >
            {who.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={`Message ${target.toUpperCase()}…`}
          className="flex-1 min-w-0 bg-background border border-border rounded-sm px-3 py-2 mono text-[12px] focus:outline-none focus:border-primary"
        />
        <button
          onClick={toggleMic}
          aria-label="Voice input"
          title="Tap to speak"
          className={`shrink-0 px-3 py-2 rounded-sm border text-[14px] leading-none ${
            listening
              ? "border-destructive text-destructive bg-destructive/10 animate-pulse"
              : "border-border text-muted-foreground hover:text-primary hover:border-primary"
          }`}
        >
          🎤
        </button>
        <button
          onClick={send}
          disabled={sending || !draft.trim()}
          className="mono text-[10px] tracking-widest bg-primary text-primary-foreground px-3 py-2 rounded-sm disabled:opacity-40"
        >
          SEND
        </button>
      </div>
    </Panel>
  );
}

/* ---------------- this week, by day (the record) ---------------- */
function WeekByDayPanel({
  tasks,
  goals,
  userId,
  onChange,
}: {
  tasks: Task[];
  goals: Goal[];
  userId: string;
  onChange: () => void;
}) {
  const days = weekDays();
  const dayOpts = days.map((d) => ({ date: d.date, short: d.short }));
  const start = days[0].date;
  const end = days[6].date;
  const todayS = todayStr();

  const weekTasks = tasks.filter(
    (t) => (t.due_date && t.due_date >= start && t.due_date <= end) || (t.horizon === "week" && !t.due_date),
  );
  const openCount = weekTasks.filter((t) => t.status !== "done").length;
  const unscheduled = weekTasks.filter((t) => !t.due_date);

  return (
    <Panel
      title="THIS WEEK // BY DAY"
      icon={<Repeat className="size-3.5" />}
      right={<span className="mono text-[10px] text-muted-foreground">{openCount} OPEN</span>}
    >
      <div className="space-y-3">
        {days.map((d) => {
          const items = weekTasks.filter((t) => t.due_date === d.date);
          const isToday = d.date === todayS;
          const isPast = d.date < todayS;
          const openHere = items.filter((t) => t.status !== "done").length;
          if (items.length === 0 && !isToday) return null; // only surface empty days when it's today
          return (
            <div key={d.date}>
              <div
                className={`mono text-[10px] tracking-widest mb-1.5 flex items-center gap-2 ${
                  isToday ? "text-primary" : isPast && openHere ? "text-destructive" : "text-accent"
                }`}
              >
                <span>
                  {d.short.toUpperCase()} · {d.date.slice(5)}
                </span>
                {isToday && <span className="text-[9px] border border-primary/50 rounded-sm px-1">TODAY</span>}
                {isPast && openHere > 0 && (
                  <span className="text-[9px] border border-destructive/50 rounded-sm px-1 animate-pulse">OVERDUE</span>
                )}
              </div>
              {items.length === 0 ? (
                <div className="mono text-[9px] text-muted-foreground italic pl-1">— nothing scheduled —</div>
              ) : (
                <ul className="space-y-1.5">
                  {items.map((t) => (
                    <TaskRow key={t.id} task={t} goals={goals} onChange={onChange} dayOptions={dayOpts} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {unscheduled.length > 0 && (
          <div>
            <div className="mono text-[10px] tracking-widest mb-1.5 text-muted-foreground">
              ▸ UNSCHEDULED — pick a day
            </div>
            <ul className="space-y-1.5">
              {unscheduled.map((t) => (
                <TaskRow key={t.id} task={t} goals={goals} onChange={onChange} dayOptions={dayOpts} />
              ))}
            </ul>
          </div>
        )}

        <AddTaskInline userId={userId} horizon="week" pile="signal" goals={goals} onChange={onChange} />
      </div>
    </Panel>
  );
}
