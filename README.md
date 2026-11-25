# Intelligent Calendar

A2 project for Intelligent Interactive Systems: an appointment-booking assistant that decides when to ask a clarifying question and when to act. Two clarification policies (K, T) are compared in one codebase; the better one (K, revised to K2) is deployed. README word count: about 1,450 words of prose plus about 700 in tables (code spans not counted; counted on 2026-11-24, will drift as it is edited).

## Project status
In progress. Built: parser, scorer, ambiguity detection, policies K, K2 and T, chat API, simulation harness, and one run of the experiment (see table). Deployed on Vercel (see table). Not built: survey.

| Part | Status | Note |
|---|---|---|
| Express + EJS app (`GET /`, `GET /api/health`) | Implemented | Serves the calendar and chat page (`views/index.ejs`, plain CSS and JS) with a cookie/AI notice; deployed (see Vercel row). Page not checked in a browser by the agent |
| Appointments API (`/api/appointments`) | Implemented | Live-checked 2026-11-20 against Supabase: GET, POST (valid and rejected input) and DELETE, each run once; the PUT route was not called live |
| Shared DeepSeek parser (`src/parser.js`) | Implemented | Live-checked on one request; see below |
| Parse cache (Supabase `parse_cache`) | Implemented | Live-checked; see below |
| Other Supabase tables (`appointments`, `simulation_logs`) | Created | `appointments` used live 2026-11-20 (insert, update, delete, read); `simulation_logs` deliberately unused (results go to `results/`) |
| Chat flow (`/api/chat`, `/api/chat/reply`; `src/chat.js`, `src/calendar.js`) | Implemented | Offline tests with fakes, plus live runs on 2026-11-20 against real DeepSeek and Supabase (policy K2; each scenario run once): create, cancel, reschedule (full and missing destination), ambiguous cancel with a "3pm" reply, vague time, not-found, give-up after 2 questions, invalid input. Policy T live on the vague-time case only. Not run live: reschedule with several matches, intent conflicts, relative dates like "tomorrow" (live cache issue below). On Vercel: one request only (not_found, policy K2); no ask/act path run there. Front end exists (see first row) |
| Hypothesis scorer (`src/scorer.js`) | Implemented | Offline tests only; weights fixed, not yet tried on real requests |
| Ambiguity detection (`src/ambiguity.js`) | Implemented | Offline tests only; four types (intent, multi-match, missing slot, time expression) |
| Decision features, Policy K, Policy T, template questions, ACT (`src/features.js`, `src/policies/`, `src/questions.js`, `src/actions.js`) | Implemented | Offline tests; run on the 60 labelled requests with the real parser (2026-11-19, see results row) and live in the chat flow (2026-11-20); weights and thetas are hand-set starting values, K revised once to K2 |
| Simulation harness (`simulation/`) and fixture | Implemented | Offline tests; run with the real parser on the dev and test sets (2026-11-19) |
| Labelled dev and test sets (30 + 30) | Reviewed (flag set 2026-11-19), committed in `920beaa` after the runs | AI-drafted, then reviewed by me. The dev runs below happened BEFORE these files were committed, so git order does not prove pre-registration; the contents are unchanged since generation (checked 2026-11-19) |
| Simulation results | Done once (2026-11-19) | Dev and held-out test sets run once each for K (theta 4), K2 (K with TIME_EXPR weight 4) and T (theta 0.5); files in `results/`, not yet committed. The test set was run before it was committed (see status row above) |
| User survey | Planned | Not started |
| Vercel deployment | Implemented | Deployed 2026-11-24 at https://intelligent-calendar-ft8d.vercel.app/ (env vars set in Vercel project settings; Supabase integration not used). Checked once: `/api/health` 200, `/` 200, `/api/appointments` 200 (live Supabase read), and one `POST /api/chat` ("Cancel my appointment tomorrow", empty session) returned `not_found` with `trace.policy` K2, so DeepSeek and the policy variable work in production. An ask/act path on the deployed site has not been run |

## Technology stack
Express.js (API and EJS-rendered UI), Supabase (Postgres; server-side client configured), Vercel (hosting), DeepSeek API (parser only; model `deepseek-flash`).

## How to run
Node 26 was used. npm install, copy .env.example to .env and fill in your own keys, then npm start (or npm run dev) and open http://localhost:3000. `npm test` runs the offline tests (parser, scorer, ambiguity, policies, chat flow, simulation harness) (no keys or network needed).

## Policies, chat API and experiment (offline-tested; experiment run 2026-11-19; chat flow live-checked 2026-11-20, see status table)
- **Shared pipeline:** parser -> scorer -> ambiguity detection -> shared executability pre-check -> policy. A request missing a required slot always asks, for both policies. Nothing matching on the calendar gives "not found" (no ask, no act). Only then does the policy decide.
- **Policy K:** ask if w·f >= theta, with hand-set weights and theta = 4 (starting values, tuned once on the dev set; not trained). Features: low top score, low margin, the four ambiguity bits, incompleteness, action risk (cancel 1, reschedule 0.5, create 0). The repeated-request flag was dropped (always 0 in single-turn runs).
- **Policy T:** ask if the entropy (natural log) of the softmax over the hypothesis scores is >= theta = 0.5 (starting value). It reads only the scores, so it cannot see vague times or intent conflicts; this is a finding, not a bug. The entropy is over my own scoring function, not the LLM's uncertainty.
- **Revised K ("K2"):** after the first dev run I allowed ONE revision to K: the TIME_EXPR weight goes from 3 to 4 (nothing else changes), because two vague-time requests scored just under theta while a clear request scored just over it. K2 is its own policy so original K, K2 and T can be compared on the held-out set. Original K is unchanged.
- **Controls:** `ALWAYS` (always ask) and `NEVER` (never ask) are baseline policies for the harness only (`--policy ALWAYS|NEVER`); the shared pre-check still applies to them, so "never ask" still asks about a missing required slot. The app cannot select them.
- **Select a policy** for the app with `CLARIFICATION_POLICY=K|K2|T` (no default).
- **Chat API (no UI yet; live-checked once per scenario on 2026-11-20, see status table):** `POST /api/chat {"text"}` and `POST /api/chat/reply {"text","state"}` return `{status: done|ask|not_found|gave_up|parse_error, message|question, state (on ask), action, trace}`. The server is stateless: the client sends back the `state` it was given. At most 2 clarifying questions, then "gave up".
- **Experiment:** `node simulation/run.js --set dev|test --policy K|K2|T|ALWAYS|NEVER [--theta N]` replays a scripted labelled set (turn 1 only; an ask is assumed resolved; actions are planned and compared with the labels, never executed) and writes `results/`. It refuses to run until the set is marked `reviewed_by_student: true` and `PARSER_REFERENCE_DATE` equals `simulation/fixture.json` (`2026-11-23`). It makes real DeepSeek calls the first time a request text is seen (then cached).

## Parser configuration
Set `DEEPSEEK_API_KEY` and `DEEPSEEK_MODEL` in `.env` (see `.env.example`). Accepted model names per the DeepSeek docs (checked 2026-11-17): `deepseek-flash`, `deepseek-v4-pro`. **Model used: `deepseek-flash`** (chosen 2026-11-17 because it is cheaper; the API returns no version string beyond this name, so none is recorded). The model name and the reference date are part of the cache key, so switching models or days never reuses old parses. Optional: `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com`) and `PARSER_REFERENCE_DATE` (fixed "today", `YYYY-MM-DD`, so relative dates like "tomorrow" resolve identically in every simulation run; defaults to the current UTC date).

Each parse is one non-thinking call (thinking on deepseek ignores temperature), temperature 0, JSON mode. Blank content, invalid JSON, invalid fields (and API errors) are parse failures returned as `{ok: false}`; they get at most one retry and are never turned into a booking action. Blank, invalid-JSON and invalid-field failures are cached so replays reproduce them (useful for testing); API errors are not cached. Slots: `date`, `time`, `new_date`, `new_time`, `person`, `duration`. For a reschedule, `date`/`time` identify the existing appointment and `new_date`/`new_time` are where it moves to; they are null for create and cancel. `time` and `new_time` are `HH:MM` or a vague `morning`/`afternoon`/`evening`. Known limits: the cache key is (request text, model, reference date) since 2026-11-20, so a cached "tomorrow" is not reused on another day (the live app uses the current UTC date; simulations pin `PARSER_REFERENCE_DATE`; run `supabase/migrations/2026-11-20-parse-cache-reference-date.sql` once before using this version); the parser does not enforce that `new_*` is null for create/cancel; and there is no intent for non-booking text such as "hello".

## Development record
Significant changes, in order. "Check" is what was actually run or compared; commit hashes are on `main`.

| Date | Change and why | Check | Commit |
|---|---|---|---|
| 2026-11-17 | Shared DeepSeek parser (text to JSON), non-thinking, temperature 0, cached in Supabase so simulations replay. I added `new_date`/`new_time` slots after the AI flagged that "move my 10am to 2pm" cannot say which time is which | 46 offline tests; one live call and a live cache replay | `00f8bb7` |
| 2026-11-19 | Scorer: fixed slot weights (date 4, time 4, person 3, duration 1), destinations never rank appointments. Fixed before any policy run so only thresholds are tuned | 17 offline tests | `0a725bf` |
| 2026-11-19 | Ambiguity detection (four types adapted from Kim et al.), then a shared pre-check, Policy K, K2 and T so the policies differ only in the ask-or-act rule | offline tests (150 at the time) | `336d537`, `de07428` |
| 2026-11-19 | Chat flow, template questions, simulation harness, 30 + 30 labelled requests, results for K, K2, T and the always/never controls. K chosen as better (5/19 vs 7/22 wrong actions), then revised once to K2 (TIME_EXPR weight 3 to 4) because two vague-time requests scored 3.92 against theta 4 | results files in `results/`; test set run once per policy. **Process problem:** the sets were run before they were committed, so git order does not prove pre-registration (file contents unchanged since generation) | `537910d`, `920beaa`, `9aa5083` |
| 2026-11-20 | Reference date added to the parse-cache key, because a cached "tomorrow" would stay frozen to the day it was first parsed | offline test; replay of all 60 labelled requests from cache | `06c73bf` |
| 2026-11-23/24 | Basic front end, anonymous cookie sessions (no accounts), Vercel deployment | cookie test offline; one request on the deployed site | `c915c46`, `b17f48b`, `50a5821` |

Setback: my first live cache write failed because I had put a publishable Supabase key where the secret key belongs; the AI diagnosed it from the key prefix and I replaced it.

## AI assistance
- Claude Code was used to generate the initial scaffold (2026-11-16). To be expanded with what was checked or changed.
- Claude Code drafted the shared parser (`src/parser.js`) and its offline tests (2026-11-17) from my specification, after checking the DeepSeek API docs. See the checks below.
  - Decisions I made on the parser design:
    1. Vague times such as "afternoon" are kept as the words `morning`/`afternoon`/`evening`, so the TIME-EXPR ambiguity type stays distinguishable from a missing time.
    2. Parses that fail validation (invalid fields, as well as blank or invalid JSON) are cached, so experiment replays are repeatable.
    3. Relative dates are resolved against one fixed `PARSER_REFERENCE_DATE` for every simulation run, so replays reproduce. (Superseded 2026-11-20: the cache key now includes the reference date, so the live app no longer needs it; simulation runs still pin it.)
    4. Reschedule requests get two extra slots, `new_date` and `new_time`, so the destination is not confused with the appointment being moved. I chose this to make the application more useful, accepting a slightly larger parser.
    5. Model: `deepseek-flash`, chosen because it is cheaper than `deepseek-v4-pro`.
- Kimi Code CLI (2026-11-17) drafted the Supabase schema and server-side client; I guided the schema design against my experiment plan, directed the implementation, and reviewed the resulting tables and client setup.
- Claude Code implemented the hypothesis scorer (`src/scorer.js`) and its offline tests (2026-11-19) from my design. See the checks below.
  - Decisions I made on the scorer design:
    1. `new_date`/`new_time` are never used to rank appointments, because they describe where a reschedule goes, not which appointment is meant. They are only used for missing-destination and vague-time ambiguity.
    2. Each matched slot adds a fixed integer weight (date 4, time 4, person 3, duration 1; range 0 to 12), and a mismatched slot adds 0. The weights are fixed before any policy is run, and only each policy's threshold is tuned. The range is wide because Policy T's softmax scale is fixed at 1.
- Claude Code implemented ambiguity detection (`src/ambiguity.js`) and its offline tests (2026-11-19) from my design. See the checks below.
  - Four types, adapted from Kim et al.'s five: intent, multi-match, missing slot, time expression (the audio type is dropped). The result is a 0/1 occurrence vector plus one best alternative per fired type. A reschedule with no destination fires missing slot (my decision); the other detection rules were drafted by the AI and are still to be confirmed by me.
- Claude Code implemented the decision features, Policy K, Policy T, the shared pre-check, template questions, ACT planning, reply handling, the chat flow and routes, the calendar adapter, the simulation harness and a draft of the labelled sets (2026-11-19) from my chosen options. See the checks below.
  - Decisions I made: a shared pre-check so a missing required slot always asks for both policies; Policy K features oriented as "more reason to ask" with hand-set starting weights and theta 4, repeated-request flag dropped; Policy T uses raw natural-log entropy over scores only, theta 0.5; one question per turn by priority INTENT > MISSING_SLOT > MULTI_MATCH > TIME_EXPR, at most two questions, replies merged as slots; scripted sets of 30 dev + 30 test (15 clear + 15 ambiguous each), one fixed read-only fixture calendar, reference date 2026-11-23, turn 1 only, wrong-action rate per act; "revise once" means one documented change, then one held-out evaluation of the original and the revised policy; created appointments are titled "Meeting with <person>" or "Appointment".
  - The AI drafted the 60 request texts and labels. I reviewed all of them and changed nothing, because they were sufficient to test clarification; the sets were nevertheless committed after the runs (see Development record).

- **My checks (2026-11-24):** I reviewed the AI-chosen scorer rules (a)-(e) and kept them unchanged, because they were sufficient for developing the system in the time available. I once named Policy T as the better policy after misreading a row when computing failure rates; the AI pointed out that this contradicted my own max-F1 rule, I recomputed (K 5/19 = 26.3% vs T 7/22 = 31.8%) and corrected the decision to K. I checked the deployed site by booking and cancelling an appointment (both acted on, K2 scores 1.67 and 3.67 against theta 4); the ask path has not been run on the deployed site.
