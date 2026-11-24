-- Per-visitor calendars for the demo (2026-11-23). Each browser gets an anonymous random
-- UUID in a first-party cookie (src/session.js); appointments created through the app
-- carry it so visitors only see and change their own. No accounts, no personal data.
-- Rows without a session_id (simulation/seed rows) are not visible to any visitor.
-- Run in the Supabase SQL editor.
alter table public.appointments add column if not exists session_id uuid;
create index if not exists appointments_session_idx on public.appointments (session_id);
