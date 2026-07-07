# goBoard — deploy guide


A lightweight scrum board: kanban with drag-and-drop, backlog, and reports.
One codebase, two tiers. It detects which tier it's running in automatically —
you never edit the code to upgrade.

- **Tier 2 (deploy today):** each visitor's board saves to their own browser.
  Great for personal use; nothing is shared between people.
- **Tier 3 (upgrade later):** connect a free database and everyone with the
  link shares one live board.

The sidebar tells you which mode you're in: "Saved to this browser" (Tier 2)
or "Saved · shared board" (Tier 3).

---

## Deploy to Vercel (Tier 2) — about 5 minutes

You'll need a free Vercel account (vercel.com → Sign Up).

**Option A — no tools, via GitHub (recommended)**
1. Create a free GitHub account if you don't have one, then create a new
   repository and upload this folder's contents (index.html, api/, README.md).
   GitHub's web interface lets you drag-and-drop files — no git commands needed.
2. In Vercel: Add New → Project → Import your repository → Deploy.
3. Done. Your board is live at `your-project-name.vercel.app`.
   Rename the project in Vercel → Settings if you want a nicer subdomain,
   e.g. `goboard.vercel.app` (if available).

**Option B — command line**
1. Install Node.js (nodejs.org), then open a terminal in this folder.
2. Run `npx vercel` and follow the prompts (it will ask you to log in).
3. Run `npx vercel --prod` to publish.

**Note:** Netlify Drop (drag-and-drop deploy) also works for Tier 2, but the
Tier 3 upgrade below is Vercel-specific — that's why this project targets Vercel.

---

## Upgrade to a shared board (Tier 3) — about 5 more minutes, still free

1. In your Vercel project dashboard, open the **Storage** tab.
2. **Create Database** → choose **Upstash** (Redis) → free plan.
3. Connect it to this project when prompted. Vercel adds the required
   environment variables automatically — you don't type any keys.
4. Redeploy (Deployments → ⋯ → Redeploy).

Reload the board: the sidebar should now say "Saved · shared board."
Everyone with your link now sees and edits the same tickets.

**Heads up:** in Tier 3 the board is shared with *anyone* who has the link —
there are no user accounts or permissions yet. Treat it like a team
whiteboard. (User accounts, per-project boards, and edit history are natural
next features — a good Claude Code session.)

---

## Custom domain (optional, ~$12/year)

Buy a domain at any registrar (Namecheap, Cloudflare, etc.), then in Vercel:
Settings → Domains → Add. Vercel shows you exactly which DNS records to set
at your registrar. No code changes needed.

## Files

- `index.html` — the entire app (UI + logic)
- `api/board.js` — the shared-storage endpoint; dormant until Tier 3
- `api/tickets.js` — lets external automations create a single ticket via
  `POST /api/tickets` (e.g. an email-to-ticket workflow). Needs Tier 3 storage
  plus a `TICKETS_API_KEY` env var (any random string you choose) sent as
  `Authorization: Bearer <key>`.
- `api/mcp.js` — remote MCP server so Claude apps (Cowork, claude.ai) can use
  the board as a custom connector, with create_ticket / list_tickets /
  move_ticket tools. Add it by URL: `https://<your-app>.vercel.app/api/mcp?key=<TICKETS_API_KEY>`
  (same env vars as api/tickets.js; keep the URL secret since it embeds the key).
- `api/report.js` — writes the executive sprint report with the Claude API
  when a sprint is closed. Needs an `ANTHROPIC_API_KEY` env var in Vercel;
  without it the app quietly falls back to a template-generated report.
