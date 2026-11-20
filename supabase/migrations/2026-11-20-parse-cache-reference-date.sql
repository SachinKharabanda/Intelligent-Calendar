-- Add the reference date ("today" the request was parsed against) to the parse_cache key,
-- so a cached "tomorrow" is never reused on a different day. Student's decision 2026-11-20.
-- Run ONCE in the Supabase SQL editor BEFORE deploying the matching src/parser.js.
--
-- Existing rows are backfilled with the reference date they were actually parsed with:
--   created before 2026-11-19: the day they were created (default reference date = today, UTC)
--   created on 2026-11-19:     2026-11-23 (the labelled-set runs used PARSER_REFERENCE_DATE=2026-11-23)
--   created on or after 2026-11-20: the day they were created (live checks, default = today, UTC)
begin;

alter table public.parse_cache add column if not exists reference_date date;

update public.parse_cache
set reference_date = case
  when created_at::date = date '2026-11-19' then date '2026-11-23'
  else created_at::date
end
where reference_date is null;

alter table public.parse_cache alter column reference_date set not null;
alter table public.parse_cache drop constraint parse_cache_pkey;
alter table public.parse_cache add primary key (request_text, model, reference_date);

commit;
