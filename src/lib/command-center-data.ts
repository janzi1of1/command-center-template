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
  // Deliberately does nothing.
  //
  // This used to insert a starter board. It was dropped because it kept
  // refilling a board somebody had just cleared, and because the examples it
  // inserted were one particular person's goals and revenue targets - not
  // something to ship to everyone who clones this.
  //
  // An empty board is the honest starting state: make your first venture, then
  // add work under it. If you want a seed of your own, write it here.
  void userId;
}
