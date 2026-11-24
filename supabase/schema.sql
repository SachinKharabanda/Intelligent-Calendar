-- ==========================================================================
-- Intelligent Calendar -- Supabase schema
-- Tables: appointments, parse_cache, simulation_logs
-- Status: PLANNED (matches the planned pipeline in docs/policy-k-diagram.tex
--         and docs/policy-t-diagram.tex; no application code implemented yet).
-- How to run: Supabase dashboard -> SQL -> New query -> paste this file -> Run.
-- Access: server-side only via the service-role key (src/supabase.js). RLS is
--         enabled with no policies, so anon/authenticated roles get nothing.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. appointments -- the calendar the assistant acts on.
--    One row per appointment. Simulated users seed these; the scorer matches
--    parsed slots (date, time, person, duration) against them to build and
--    rank hypotheses (diagram boxes 1-2, shared by Policies K and T).
-- --------------------------------------------------------------------------
create table if not exists public.appointments (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,                 -- used in template questions and confirmations
  person           text,                          -- nullable: e.g. 'dentist' has no person
  date             date not null,
  start_time       time not null,                 -- end time derived: start_time + duration_minutes
  duration_minutes integer not null default 60 check (duration_minutes > 0),
  source           text not null default 'app',   -- 'app' = UI/survey, 'simulation' = seeded by harness
  session_id       uuid,                          -- anonymous visitor cookie (src/session.js); added 2026-11-23, see supabase/migrations/
  created_at       timestamptz not null default now()
);

-- Hypothesis matching filters on person and date (MULTI-MATCH detection).
create index if not exists appointments_person_idx on public.appointments (person);
create index if not exists appointments_date_idx   on public.appointments (date);

-- --------------------------------------------------------------------------
-- 2. parse_cache -- one row per unique (request text, model, reference date).
--    Replay guarantee: a cached row means no new DeepSeek call, so simulation
--    runs replay identically at zero cost. Lives in Supabase, not on disk,
--    because Vercel's filesystem is ephemeral. Keyed by model as well as text
--    so a model change never silently reuses stale parses. The reference date (the "today"
--    the request was parsed against) is also part of the key, so a cached "tomorrow" is
--    never reused on another day (added 2026-11-20; see supabase/migrations/).
-- --------------------------------------------------------------------------
create table if not exists public.parse_cache (
  request_text text not null,
  model        text not null,              -- exact DeepSeek model name, e.g. 'deepseek-flash'
  parsed       jsonb,                      -- {intent, slots:{date,time,person,duration}}; null on failure
  error        text,                       -- set on blank/invalid-JSON responses; cached so replays
                                           -- reproduce the same failure (counted as a parse error)
  reference_date date not null,            -- the "today" used to resolve relative dates
  created_at   timestamptz not null default now(),
  primary key (request_text, model, reference_date)
);

-- --------------------------------------------------------------------------
-- 3. simulation_logs -- one row per (run, request, turn).
--    Every metric in the experiment plan is derived from this table:
--    clarification rate, clarify precision/recall/F1, questions per request,
--    wrong-action rate, and parse errors (reported separately from policy
--    errors). Ground truth (gt_*) is pre-registered in the simulation/dev and
--    simulation/test files, committed before any results, and never relabelled.
-- --------------------------------------------------------------------------
create table if not exists public.simulation_logs (
  id              bigint generated always as identity primary key,
  run_id          uuid not null,           -- groups one harness invocation (one policy x one set)
  set_name        text not null check (set_name in ('dev', 'test')),  -- dev = tune, test = held-out
  policy          text not null check (policy in ('K', 'T')),
  request_id      text not null,           -- id in the pre-registered dev/test file
  request_text    text not null,
  turn            integer not null default 1 check (turn >= 1),  -- 1 = initial request; 2+ = reply after ASK
  gt_ambiguous    boolean not null,        -- pre-registered: should the system clarify?
  gt_target       text,                    -- pre-registered correct target (appointment ref), when acting
  parse_ok        boolean not null,        -- false = parser failure; excluded from policy-error counts
  parsed          jsonb,                   -- parse result used (from parse_cache)
  hypotheses      jsonb,                   -- candidate interpretations + scores s1..sk (shared boxes 1-2)
  decision        text check (decision in ('ask', 'act')),       -- null when parse_ok = false
  question        text,                    -- template question sent, when decision = 'ask'
  action          jsonb,                   -- action executed, when decision = 'act'
  clarify_correct boolean,                 -- decision matches gt_ambiguous (computed by the harness)
  wrong_action    boolean,                 -- acted but action target != gt_target (A1 wrong-action rate)
  policy_params   jsonb not null,          -- T: {"theta": 0.7}; K: {"w": {...}, "theta": ...}
  created_at      timestamptz not null default now(),
  unique (run_id, request_id, turn)
);

create index if not exists simulation_logs_run_idx
  on public.simulation_logs (run_id);
create index if not exists simulation_logs_set_policy_idx
  on public.simulation_logs (set_name, policy);

-- --------------------------------------------------------------------------
-- Privacy / access. Only the server (service-role key) touches these tables;
-- the service role bypasses RLS. Enabling RLS with no policies denies every
-- other role, so nothing is ever exposed to the browser or the anon key.
-- Only synthetic simulated-user text is stored; no real personal data.
-- --------------------------------------------------------------------------
alter table public.appointments     enable row level security;
alter table public.parse_cache      enable row level security;
alter table public.simulation_logs  enable row level security;
