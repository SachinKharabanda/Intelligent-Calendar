# Intelligent Calendar

A2 project for Intelligent Interactive Systems: an appointment-booking assistant that decides when to ask a clarifying question and when to act. Two clarification policies (K, T) will be compared in one codebase.

Prose word count: ~90

## Project status
Scaffold only. Nothing below is implemented yet.

| Part | Status |
|---|---|
| Express + EJS app, `GET /`, `GET /api/health` | Implemented (placeholder page only) |
| `/api/appointments`, `/api/chat` routes | Stubs, return 501 |
| DeepSeek parser, scoring, Policy K, Policy T | Planned |
| Supabase tables and parse cache | Planned |
| Simulation harness and results | Planned |
| User survey | Planned |
| Vercel deployment | Planned (config written, never deployed) |

## Technology stack
Express.js (API and EJS-rendered UI), Supabase (Postgres), Vercel (hosting), DeepSeek API (parser only; model name to be recorded here once chosen).

## How to run
Node 26 was used. `npm install`, copy `.env.example` to `.env` and fill in your own keys, then `npm start` (or `npm run dev`) and open http://localhost:3000.

## Development record
To be filled in as work progresses (change, why, check, commit link).

## AI assistance
Claude Code was used to generate the initial scaffold (2026-11-16). To be expanded with what was checked or changed.
