import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Goal = Tables<"goals">;
export type Task = Tables<"tasks">;
export type Habit = Tables<"habits">;
export type HabitLog = Tables<"habit_logs">;
export type Result = Tables<"results">;
export type Milestone = Tables<"milestones">;

// ventures + upcoming_payments were added directly in Supabase; generated types don't include them yet
export type Venture = {
  id: string;
  user_id: string;
  name: string;
  stage: string | null;
  health: string | null;
  focus: string | null;
  status_line: string | null;
  sort_order: number | null;
  is_active?: boolean;
};

export type UpcomingPayment = {
  id: string;
  user_id: string;
  name: string;
  amount: number | null;
  due_date: string | null;
  recurrence: string | null;
  venture: string | null;
  notes: string | null;
};

export async function loadAll(userId: string) {
  const sb = supabase as any;
  const [goals, tasks, habits, habitLogs, results, milestones, ventures, payments] = await Promise.all([
    supabase.from("goals").select("*").order("sort_order"),
    supabase.from("tasks").select("*").order("sort_order").order("created_at"),
    supabase.from("habits").select("*").order("sort_order"),
    supabase.from("habit_logs").select("*").order("log_date", { ascending: false }),
    supabase.from("results").select("*").order("as_of", { ascending: false }),
    supabase.from("milestones").select("*").order("sort_order"),
    // Paused ventures keep their row and their history; they just come off
    // the board. is_active=false is "on hold", not deleted.
    sb.from("ventures").select("*").eq("is_active", true).order("sort_order"),
    sb.from("upcoming_payments").select("*").order("due_date"),
  ]);
  return {
    goals: (goals.data ?? []) as Goal[],
    tasks: (tasks.data ?? []) as Task[],
    habits: (habits.data ?? []) as Habit[],
    habitLogs: (habitLogs.data ?? []) as HabitLog[],
    results: (results.data ?? []) as Result[],
    milestones: (milestones.data ?? []) as Milestone[],
    ventures: (ventures.data ?? []) as Venture[],
    payments: (payments.data ?? []) as UpcomingPayment[],
  };
}

export async function ensureSeed(userId: string) {
  const { count } = await supabase
    .from("goals")
    .select("*", { count: "exact", head: true });
  if (count && count > 0) return;

  // Seed goals
  const goalSeed = [
    {
      user_id: userId,
      title: "Mayhem Studios → $2,000/mo + self-running",
      category: "business",
      pile: "em",
      metric_label: "Revenue",
      current_value: 28,
      target_value: 2000,
      unit: "$/mo",
      monthly_target: "$2k + runs without me",
      weekly_target: "ship videos + drive traffic",
      daily_target: "1 key move",
      sort_order: 1,
    },
    {
      user_id: userId,
      title: "Lose 45 lb · exercise · eat healthy",
      category: "body",
      pile: "janzi",
      metric_label: "Weight lost",
      current_value: 0,
      target_value: 45,
      unit: "lb",
      monthly_target: "~4–8 lb",
      weekly_target: "exercise most days",
      daily_target: "up to 1 hr exercise + eat healthy",
      sort_order: 2,
    },
    {
      user_id: userId,
      title: "Clean daily",
      category: "home",
      pile: "janzi",
      metric_label: "Streak",
      current_value: 0,
      target_value: 30,
      unit: "days",
      monthly_target: "",
      weekly_target: "",
      daily_target: "~15-min reset",
      sort_order: 3,
    },
  ];
  const { data: gIns } = await supabase.from("goals").insert(goalSeed).select();
  const goals = gIns ?? [];
  const mayhem = goals.find((g) => g.category === "business");
  const body = goals.find((g) => g.category === "body");
  const home = goals.find((g) => g.category === "home");

  await supabase.from("habits").insert([
    { user_id: userId, name: "Exercise", target: "60 min", category: "body", icon: "🏃", sort_order: 1 },
    { user_id: userId, name: "Eat healthy", target: "daily", category: "body", icon: "🥗", sort_order: 2 },
    { user_id: userId, name: "Clean", target: "15 min", category: "home", icon: "🧹", sort_order: 3 },
  ]);

  await supabase.from("milestones").insert([
    { user_id: userId, title: "Store live — mayhemstudios.shop", status: "hit", date_hit: "2026-06-21", goal_id: mayhem?.id ?? null, sort_order: 1 },
    { user_id: userId, title: "First external sale (order #1002)", status: "hit", date_hit: "2026-06-14", goal_id: mayhem?.id ?? null, sort_order: 2 },
    { user_id: userId, title: "First $1,000 in real sales", status: "upcoming", goal_id: mayhem?.id ?? null, sort_order: 3 },
    { user_id: userId, title: "First $2,000 month", status: "upcoming", goal_id: mayhem?.id ?? null, sort_order: 4 },
    { user_id: userId, title: "1,000 in the community", status: "upcoming", goal_id: mayhem?.id ?? null, sort_order: 5 },
    { user_id: userId, title: "Mayhem runs without me", status: "upcoming", goal_id: mayhem?.id ?? null, sort_order: 6 },
  ]);

  await supabase.from("results").insert([
    { user_id: userId, metric_key: "mayhem_mtd", label: "Mayhem revenue MTD", value: 28, unit: "$", goal_id: mayhem?.id ?? null, source: "seed" },
    { user_id: userId, metric_key: "orders_total", label: "Orders total", value: 2, unit: "", goal_id: mayhem?.id ?? null, source: "seed" },
  ]);

  const today = new Date().toISOString().slice(0, 10);
  await supabase.from("tasks").insert([
    // Today / Signal (me)
    { user_id: userId, title: "Approve the premium video", pile: "signal", assigned_to: "em", horizon: "today", due_date: today, goal_id: mayhem?.id ?? null, sort_order: 1 },
    { user_id: userId, title: "Decide the first-drop offer", pile: "signal", assigned_to: "em", horizon: "today", due_date: today, goal_id: mayhem?.id ?? null, sort_order: 2 },
    { user_id: userId, title: "Workout 60 min", pile: "signal", assigned_to: "janzi", horizon: "today", due_date: today, goal_id: body?.id ?? null, sort_order: 3 },
    { user_id: userId, title: "Clean 15 min", pile: "signal", assigned_to: "janzi", horizon: "today", due_date: today, goal_id: home?.id ?? null, sort_order: 4 },
    // Today / Noise (delegated)
    { user_id: userId, title: "Draft the TikTok appeal", pile: "noise", assigned_to: "em", horizon: "today", due_date: today, goal_id: mayhem?.id ?? null, sort_order: 5 },
    { user_id: userId, title: "Lock the conversion funnel + offer", pile: "noise", assigned_to: "em", horizon: "today", due_date: today, goal_id: mayhem?.id ?? null, sort_order: 6 },
    { user_id: userId, title: "Produce the premium video", pile: "noise", assigned_to: "em", horizon: "today", due_date: today, goal_id: mayhem?.id ?? null, sort_order: 7 },
    // Week
    { user_id: userId, title: "Build Command Center", pile: "signal", assigned_to: "em", horizon: "week", goal_id: mayhem?.id ?? null, sort_order: 1 },
    { user_id: userId, title: "Migrate PrintPal off Lovable", pile: "signal", assigned_to: "em", horizon: "week", goal_id: mayhem?.id ?? null, sort_order: 2 },
    { user_id: userId, title: "Finish TikTok", pile: "signal", assigned_to: "em", horizon: "week", goal_id: mayhem?.id ?? null, sort_order: 3 },
    { user_id: userId, title: "Finalize Shark logo", pile: "signal", assigned_to: "em", horizon: "week", goal_id: mayhem?.id ?? null, sort_order: 4 },
  ]);
}
