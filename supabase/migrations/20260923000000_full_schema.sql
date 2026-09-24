-- Command Center — the whole schema, dumped from the live database 2026-09-23.
--
-- The previous migration covered 6 of 13 tables; the other 7 had been created
-- ad-hoc and were written down nowhere. This file is the real thing, generated
-- from the catalog rather than from memory, so a fresh Supabase project can be
-- brought up to match.
--
-- Run it on a NEW project (SQL editor, or `supabase db push`). It assumes
-- Supabase's own auth schema already exists, which it does on any new project.

create extension if not exists pgcrypto;

-- every table carries updated_at, kept current by this trigger
create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;


-- ------------------------------------------------------------------------
-- bus
-- ------------------------------------------------------------------------
create table if not exists public.bus (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  created_at timestamp with time zone default now() not null,
  from_brain text not null,
  to_brain text not null,
  type text not null,
  payload jsonb default '{}'::jsonb not null,
  status text default 'new'::text not null,
  correlation_id uuid,
  processed_at timestamp with time zone,
  result jsonb
);

-- ------------------------------------------------------------------------
-- goals
-- ------------------------------------------------------------------------
create table if not exists public.goals (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  title text not null,
  category text not null,
  pile text default 'em'::text not null,
  metric_label text,
  current_value numeric default 0 not null,
  target_value numeric default 0 not null,
  unit text,
  monthly_target text,
  weekly_target text,
  daily_target text,
  sort_order integer default 0 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- ------------------------------------------------------------------------
-- habit_logs
-- ------------------------------------------------------------------------
create table if not exists public.habit_logs (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  habit_id uuid not null,
  log_date date default ((now() AT TIME ZONE 'utc'::text))::date not null,
  done boolean default true not null,
  value numeric,
  notes text,
  created_at timestamp with time zone default now() not null
);

-- ------------------------------------------------------------------------
-- habits
-- ------------------------------------------------------------------------
create table if not exists public.habits (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  name text not null,
  target text,
  category text,
  icon text,
  sort_order integer default 0 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- ------------------------------------------------------------------------
-- health_runs
-- ------------------------------------------------------------------------
create table if not exists public.health_runs (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  ran_at timestamp with time zone default now() not null,
  sites integer default 0 not null,
  failures integer default 0 not null,
  failure_list text,
  report text,
  created_at timestamp with time zone default now() not null,
  site_results jsonb
);

-- ------------------------------------------------------------------------
-- messages
-- ------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  sender text not null,
  body text not null,
  status text default 'new'::text not null,
  created_at timestamp with time zone default now(),
  recipient text default 'central'::text not null
);

-- ------------------------------------------------------------------------
-- milestones
-- ------------------------------------------------------------------------
create table if not exists public.milestones (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  title text not null,
  goal_id uuid,
  status text default 'upcoming'::text not null,
  date_hit date,
  target text,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- ------------------------------------------------------------------------
-- reminders
-- ------------------------------------------------------------------------
create table if not exists public.reminders (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  text text not null,
  remind_at timestamp with time zone not null,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now()
);

-- ------------------------------------------------------------------------
-- results
-- ------------------------------------------------------------------------
create table if not exists public.results (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  metric_key text not null,
  label text not null,
  value numeric default 0 not null,
  unit text,
  as_of date default ((now() AT TIME ZONE 'utc'::text))::date not null,
  goal_id uuid,
  source text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- ------------------------------------------------------------------------
-- tasks
-- ------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  title text not null,
  description text,
  goal_id uuid,
  pile text default 'signal'::text not null,
  assigned_to text default 'em'::text not null,
  horizon text default 'today'::text not null,
  status text default 'todo'::text not null,
  due_date date,
  sort_order integer default 0 not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null,
  phase text,
  working boolean default false not null,
  scheduled_at timestamp with time zone,
  venture_id uuid
);

-- ------------------------------------------------------------------------
-- upcoming_payments
-- ------------------------------------------------------------------------
create table if not exists public.upcoming_payments (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  name text not null,
  amount numeric,
  due_date date,
  recurrence text default 'monthly'::text,
  venture text,
  notes text,
  created_at timestamp with time zone default now()
);

-- ------------------------------------------------------------------------
-- venture_phases
-- ------------------------------------------------------------------------
create table if not exists public.venture_phases (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  venture_id uuid not null,
  idx integer not null,
  name text not null,
  goal text,
  exit_test text,
  blocker text,
  status text default 'later'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- ------------------------------------------------------------------------
-- ventures
-- ------------------------------------------------------------------------
create table if not exists public.ventures (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  name text not null,
  stage text,
  health text default 'green'::text,
  focus text,
  status_line text,
  sort_order integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  is_active boolean default true not null,
  abbr text,
  color text,
  health_site text
);


-- ------------------------------------------------------------------------
-- Keys, indexes, row level security, policies and triggers.
-- Deliberately after every CREATE TABLE: a foreign key cannot point at a
-- table that does not exist yet, and the catalog hands tables back
-- alphabetically - habit_logs arrives before habits.
-- ------------------------------------------------------------------------
alter table public.bus add constraint bus_pkey PRIMARY KEY (id);
create index if not exists bus_route_idx ON public.bus USING btree (to_brain, status, created_at);
alter table public.bus enable row level security;
create policy "bus_own"
  on public.bus
  for all
  to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
alter table public.goals add constraint goals_pkey PRIMARY KEY (id);
alter table public.goals add constraint goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.goals add constraint goals_category_check CHECK ((category = ANY (ARRAY['business'::text, 'body'::text, 'home'::text])));
alter table public.goals add constraint goals_pile_check CHECK ((pile = ANY (ARRAY['em'::text, 'me'::text])));
alter table public.goals enable row level security;
create policy "own goals"
  on public.goals
  for all
  to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
CREATE TRIGGER trg_goals_updated BEFORE UPDATE ON public.goals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
alter table public.habit_logs add constraint habit_logs_user_id_habit_id_log_date_key UNIQUE (user_id, habit_id, log_date);
alter table public.habit_logs add constraint habit_logs_pkey PRIMARY KEY (id);
alter table public.habit_logs add constraint habit_logs_habit_id_fkey FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE;
alter table public.habit_logs add constraint habit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.habit_logs enable row level security;
create policy "own habit_logs"
  on public.habit_logs
  for all
  to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
alter table public.habits add constraint habits_pkey PRIMARY KEY (id);
alter table public.habits add constraint habits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.habits enable row level security;
create policy "own habits"
  on public.habits
  for all
  to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
CREATE TRIGGER trg_habits_updated BEFORE UPDATE ON public.habits FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
alter table public.health_runs add constraint health_runs_pkey PRIMARY KEY (id);
create index if not exists health_runs_ran_idx ON public.health_runs USING btree (ran_at DESC);
alter table public.health_runs enable row level security;
create policy "own health runs"
  on public.health_runs
  for all
  to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
alter table public.messages add constraint messages_pkey PRIMARY KEY (id);
alter table public.messages add constraint messages_recipient_check CHECK ((recipient = ANY (ARRAY['me'::text, 'em'::text, 'codex'::text, 'central'::text])));
alter table public.messages add constraint messages_sender_check CHECK ((sender = ANY (ARRAY['me'::text, 'em'::text, 'codex'::text, 'central'::text])));
create index if not exists messages_recipient_status_idx ON public.messages USING btree (recipient, status, created_at DESC);
alter table public.messages enable row level security;
create policy "own messages"
  on public.messages
  for all
  to authenticated
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
alter table public.milestones add constraint milestones_pkey PRIMARY KEY (id);
alter table public.milestones add constraint milestones_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL;
alter table public.milestones add constraint milestones_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.milestones add constraint milestones_status_check CHECK ((status = ANY (ARRAY['upcoming'::text, 'hit'::text])));
alter table public.milestones enable row level security;
create policy "own milestones"
  on public.milestones
  for all
  to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
CREATE TRIGGER trg_milestones_updated BEFORE UPDATE ON public.milestones FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
alter table public.reminders add constraint reminders_pkey PRIMARY KEY (id);
alter table public.reminders enable row level security;
create policy "own reminders"
  on public.reminders
  for all
  to authenticated
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
alter table public.results add constraint results_pkey PRIMARY KEY (id);
alter table public.results add constraint results_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL;
alter table public.results add constraint results_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.results enable row level security;
create policy "own results"
  on public.results
  for all
  to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
CREATE TRIGGER trg_results_updated BEFORE UPDATE ON public.results FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
alter table public.tasks add constraint tasks_pkey PRIMARY KEY (id);
alter table public.tasks add constraint tasks_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL;
alter table public.tasks add constraint tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.tasks add constraint tasks_venture_id_fkey FOREIGN KEY (venture_id) REFERENCES ventures(id) ON DELETE SET NULL;
alter table public.tasks add constraint tasks_assigned_to_check CHECK ((assigned_to = ANY (ARRAY['me'::text, 'em'::text, 'codex'::text, 'central'::text])));
alter table public.tasks add constraint tasks_horizon_check CHECK ((horizon = ANY (ARRAY['today'::text, 'week'::text, 'month'::text, 'personal'::text])));
alter table public.tasks add constraint tasks_phase_check CHECK (((phase IS NULL) OR (phase = ANY (ARRAY['dawn'::text, 'midday'::text, 'dusk'::text]))));
alter table public.tasks add constraint tasks_pile_check CHECK ((pile = ANY (ARRAY['signal'::text, 'noise'::text])));
alter table public.tasks add constraint tasks_status_check CHECK ((status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'done'::text])));
create index if not exists tasks_scheduled_idx ON public.tasks USING btree (scheduled_at);
create index if not exists tasks_venture_idx ON public.tasks USING btree (venture_id);
create index if not exists tasks_phase_idx ON public.tasks USING btree (due_date, phase);
alter table public.tasks enable row level security;
create policy "own tasks"
  on public.tasks
  for all
  to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
alter table public.upcoming_payments add constraint upcoming_payments_pkey PRIMARY KEY (id);
alter table public.upcoming_payments enable row level security;
create policy "own payments"
  on public.upcoming_payments
  for all
  to authenticated
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
alter table public.venture_phases add constraint venture_phases_pkey PRIMARY KEY (id);
alter table public.venture_phases add constraint venture_phases_venture_id_fkey FOREIGN KEY (venture_id) REFERENCES ventures(id) ON DELETE CASCADE;
alter table public.venture_phases add constraint venture_phases_status_check CHECK ((status = ANY (ARRAY['done'::text, 'current'::text, 'next'::text, 'later'::text])));
create index if not exists venture_phases_idx ON public.venture_phases USING btree (venture_id, idx);
alter table public.venture_phases enable row level security;
create policy "own venture phases"
  on public.venture_phases
  for all
  to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
alter table public.ventures add constraint ventures_pkey PRIMARY KEY (id);
alter table public.ventures enable row level security;
create policy "own ventures"
  on public.ventures
  for all
  to authenticated
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
