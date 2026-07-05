// goBoard — shared storage API (Tier 3)
//
// This function is inert until you connect a database. Until then it returns
// 501, and index.html automatically falls back to browser-only saving (Tier 2).
//
// To activate (one-time, ~5 minutes):
//   1. In your Vercel project dashboard → Storage → Create Database →
//      choose "Upstash" (Redis) on the free plan.
//   2. Connect it to this project. Vercel automatically adds the two
//      environment variables used below.
//   3. Redeploy. The board header will now read "Saved · shared board"
//      and everyone with the link shares one live board.
//
// No npm packages needed — this talks to Upstash's REST API directly.

const KEY = "goboard-state-v1";

export default async function handler(req, res) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return res.status(501).json({ error: "Storage not configured — see api/board.js for setup steps." });
  }

  const redis = (command) =>
    fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    }).then((r) => r.json());

  try {
    if (req.method === "GET") {
      const j = await redis(["GET", KEY]);
      return res.status(200).json({ state: j.result ? JSON.parse(j.result) : null });
    }

    if (req.method === "PUT" || req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!body || typeof body.state !== "object" || body.state === null) {
        return res.status(400).json({ error: "Expected JSON body: { state: {...} }" });
      }
      // Basic guardrail so one bad request can't blow up the database
      const serialized = JSON.stringify(body.state);
      if (serialized.length > 1_000_000) {
        return res.status(413).json({ error: "Board too large to save." });
      }
      await redis(["SET", KEY, serialized]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, PUT, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: "Storage error" });
  }
}
