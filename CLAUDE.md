# goBoard — project context

## What this is
goBoard is a lightweight scrum/kanban project management app: a drag-and-drop
board with eight working statuses, a backlog table, and a reports view
(burndown, velocity, status breakdown, team workload). Tickets carry a full
schema: ID, title, description, Fibonacci effort, priority (P1–P5), assignee,
category, feature name, release number, risks, and dependencies.

The owner is a non-technical Technical Program Manager. Explain changes in
plain language, show diffs before applying them, and avoid unnecessary jargon.

## Architecture
- `index.html` — the ENTIRE app: CSS (top), HTML structure (middle),
  JavaScript (bottom). There is deliberately no build step, no framework,
  and no npm dependencies. Keep it that way unless explicitly asked.
- `api/board.js` — a single Vercel serverless function (GET/PUT) that stores
  the whole board state as one JSON blob in Upstash Redis under the key
  `goboard-state-v1`. Zero npm dependencies; it calls Upstash's REST API
  directly with fetch.

## Two-tier storage design (do not break this)
On load, `loadState()` in index.html probes `GET /api/board`:
- **Remote tier:** if the endpoint responds OK (database configured), all
  saves go through `PUT /api/board`. One shared board for everyone with the
  link. Sidebar shows "Saved · shared board".
- **Local tier:** if the endpoint is missing or returns 501 (no database env
  vars), the app falls back to `localStorage` in the visitor's own browser.
  Each visitor gets a private board. Sidebar shows "Saved to this browser".

Rules:
1. Never assume the database exists — the local fallback must keep working
   (the file should still function opened directly from disk).
2. The API credentials arrive as env vars under either naming style:
   `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` or
   `KV_REST_API_URL`/`KV_REST_API_TOKEN`. Check both, as `api/board.js` does.
3. State is saved as one whole-board JSON document (last write wins). If a
   change requires per-ticket writes or conflict handling, discuss the
   trade-off with the owner first.

## Deployment pipeline
GitHub is the source of truth. Any push to the main branch auto-deploys via
Vercel (project: goboard) — no dashboard steps needed. To ship: commit and
push. To roll back: revert the commit and push. Always let the owner test
changes locally (open index.html in a browser) before pushing.

## Known limitations / likely future work
- No authentication: anyone with the URL can view and edit everything.
  User accounts are a likely future feature.
- Single board only; multi-board support is a likely future feature.
- Sprint name ("Sprint 14"), days remaining, and historical velocity data
  are hardcoded seed values in index.html — candidates to make editable.
