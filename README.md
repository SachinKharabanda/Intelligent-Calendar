# Intelligent Calendar

A2 project for Intelligent Interactive Systems: an appointment-booking assistant that decides when to ask a clarifying question and when to act. Two clarification policies (K, T) will be compared in one codebase.

## Project status
In progress. Not finished: the policies and the experiment are not built yet.

| Part | Status | Note |
|---|---|---|
| Express + EJS app (`GET /`, `GET /api/health`) | Implemented | Placeholder page only |
| Appointments API (`/api/appointments`) | Implemented | Not yet run against the live database |
| Shared DeepSeek parser (`src/parser.js`) | Implemented | Live-checked on one request; see below |
| Parse cache (Supabase `parse_cache`) | Implemented | Live-checked; see below |
| Other Supabase tables (`appointments`, `simulation_logs`) | Created | Not used or checked live yet |
| Chat routes (`/api/chat`) | Stub | Return 501 |
| Scoring, Policy K, Policy T | Planned | Not started |
| Simulation harness and results | Planned | Not started |
| User survey | Planned | Not started |
| Vercel deployment | Planned | Config written, never deployed |

## Technology stack
Express.js (API and EJS-rendered UI), Supabase (Postgres; server-side client configured), Vercel (hosting), DeepSeek API (parser only; model `deepseek-flash`).

## How to run
Node 26 was used. npm install, copy .env.example to .env and fill in your own keys, then npm start (or npm run dev) and open http://localhost:3000. `npm test` runs the offline parser tests (no keys or network needed).

## Parser configuration
Set `DEEPSEEK_API_KEY` and `DEEPSEEK_MODEL` in `.env` (see `.env.example`). Accepted model names per the DeepSeek docs (checked 2026-11-17): `deepseek-flash`, `deepseek-v4-pro`. **Model used: `deepseek-flash`** (chosen 2026-11-17 because it is cheaper; the API returns no version string beyond this name, so none is recorded). The model name is part of the cache key, so switching models never reuses old parses. Optional: `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com`) and `PARSER_REFERENCE_DATE` (fixed "today", `YYYY-MM-DD`, so relative dates like "tomorrow" resolve identically in every simulation run; defaults to the current UTC date).

Each parse is one non-thinking call (thinking on deepseek ignores temperature), temperature 0, JSON mode. Blank content, invalid JSON, invalid fields (and API errors) are parse failures returned as `{ok: false}`; they get at most one retry and are never turned into a booking action. Blank, invalid-JSON and invalid-field failures are cached so replays reproduce them (useful for testing); API errors are not cached. Slots: `date`, `time`, `new_date`, `new_time`, `person`, `duration`. For a reschedule, `date`/`time` identify the existing appointment and `new_date`/`new_time` are where it moves to; they are null for create and cancel. `time` and `new_time` are `HH:MM` or a vague `morning`/`afternoon`/`evening`. Known limits: the cache key is (request text, model), so a cached relative date ("tomorrow") stays frozen to the reference date it was first parsed with (set `PARSER_REFERENCE_DATE`); the parser does not enforce that `new_*` is null for create/cancel; and there is no intent for non-booking text such as "hello".

## Development record
To be filled in as work progresses (change, why, check, commit link).

## AI assistance
- Claude Code was used to generate the initial scaffold (2026-11-16). To be expanded with what was checked or changed.
- Claude Code drafted the shared parser (`src/parser.js`) and its offline tests (2026-11-17) from my specification, after checking the DeepSeek API docs. To be expanded with what I checked or changed.
  - Decisions I made on the parser design:
    1. Vague times such as "afternoon" are kept as the words `morning`/`afternoon`/`evening`, so the TIME-EXPR ambiguity type stays distinguishable from a missing time.
    2. Parses that fail validation (invalid fields, as well as blank or invalid JSON) are cached, so experiment replays are repeatable.
    3. Relative dates are resolved against one fixed `PARSER_REFERENCE_DATE` for every simulation run, because the cache key does not include the date.
    4. Reschedule requests get two extra slots, `new_date` and `new_time`, so the destination is not confused with the appointment being moved. I chose this to make the application more useful, accepting a slightly larger parser.
    5. Model: `deepseek-flash`, chosen because it is cheaper than `deepseek-v4-pro`.
- Kimi Code CLI (2026-11-17) drafted the Supabase schema and server-side client; I guided the schema design against my experiment plan, directed the implementation, and reviewed the resulting tables and client setup.
