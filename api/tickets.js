// goBoard — programmatic ticket creation API (for external automations, e.g.
// an email-to-ticket Cowork skill watching an inbox like goboard@gmail.com).
//
// POST /api/tickets
//   Header: Authorization: Bearer <TICKETS_API_KEY>
//   Body:   { title, desc?, effort?, priority?, assignee?, status?, category?, feature?, release?, risks?, deps? }
//
// Requires the same Tier 3 storage as api/board.js (Upstash Redis — see
// README) plus a TICKETS_API_KEY environment variable you set yourself in
// Vercel (any random string). This keeps the write endpoint from being open
// to the whole internet the way the shared board already is.

const KEY = "goboard-state-v1";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return res.status(501).json({ error: "Storage not configured — see api/board.js for setup steps." });
  }

  const apiKey = process.env.TICKETS_API_KEY;
  if (!apiKey) {
    return res.status(501).json({ error: "TICKETS_API_KEY not configured — set it in your Vercel project's environment variables." });
  }
  if (req.headers.authorization !== `Bearer ${apiKey}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const title = ((body && body.title) || "").trim();
  if (!title) {
    return res.status(400).json({ error: "Expected JSON body with a non-empty 'title'." });
  }

  const redis = (command) =>
    fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    }).then((r) => r.json());

  try {
    const j = await redis(["GET", KEY]);
    const state = j.result ? JSON.parse(j.result) : { nextId: 1001, tickets: [], velocity: [] };

    const ticket = {
      id: "GO-" + state.nextId++,
      created: new Date().toISOString(),
      title,
      desc: ((body.desc) || "").trim(),
      effort: body.effort ? String(body.effort) : "3",
      priority: body.priority || "P3",
      assignee: ((body.assignee) || "").trim(),
      status: body.status || "New",
      risks: ((body.risks) || "").trim(),
      deps: ((body.deps) || "").trim(),
      category: ((body.category) || "").trim(),
      feature: ((body.feature) || "").trim(),
      release: ((body.release) || "").trim(),
    };
    state.tickets.push(ticket);

    const serialized = JSON.stringify(state);
    if (serialized.length > 1_000_000) {
      return res.status(413).json({ error: "Board too large to save." });
    }
    await redis(["SET", KEY, serialized]);

    return res.status(201).json({ ticket });
  } catch (e) {
    return res.status(500).json({ error: "Storage error" });
  }
}
