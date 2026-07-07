// goBoard — AI-written sprint report (Claude API).
//
// POST /api/report  Body: { digest: { sprint, velocityHistory, tickets: [...] } }
// Returns: { report: { goals, highlights, velocity, risks, dependencies, nextSteps } }
//
// Requires an ANTHROPIC_API_KEY environment variable in Vercel. The key stays
// server-side; the browser only ever talks to this endpoint. Unauthenticated
// by design — same trust level as the shared board itself — but output is
// capped and the digest size is limited, so worst-case abuse is bounded.
// index.html falls back to its built-in template report if this returns
// anything other than 200.

const MODEL = "claude-sonnet-5";

const PROMPT = `You are writing a short sprint report for a company executive.
They want the high level: outcomes, momentum, and what needs their attention —
not implementation detail.

Rules:
- Never reference ticket IDs (like GO-1004). Describe work by its subject
  matter, drawing on the ticket titles and descriptions.
- 1–3 sentences per section. Plain, confident, executive-ready language.
  No bullet points, no engineering jargon.
- Story-point numbers are fine in the velocity section; avoid raw counts
  elsewhere unless they help the story.
- Respond with ONLY a JSON object (no prose, no markdown fences) with exactly
  these string keys: goals, highlights, velocity, risks, dependencies, nextSteps.

Sprint board data (JSON):
`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(501).json({ error: "ANTHROPIC_API_KEY not configured — set it in your Vercel project's environment variables." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const digest = body && body.digest;
  if (!digest || typeof digest !== "object") {
    return res.status(400).json({ error: "Expected JSON body: { digest: {...} }" });
  }
  const digestStr = JSON.stringify(digest);
  if (digestStr.length > 100_000) {
    return res.status(413).json({ error: "Digest too large." });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        messages: [{ role: "user", content: PROMPT + digestStr }],
      }),
    });
    if (!r.ok) {
      return res.status(502).json({ error: "AI request failed." });
    }
    const j = await r.json();
    let text = ((j.content || []).find((b) => b.type === "text") || {}).text || "";
    text = text.trim();
    if (text.startsWith("```")) text = text.split("```")[1].replace(/^json/, "").trim();
    const parsed = JSON.parse(text);
    const s = (v) => (typeof v === "string" ? v : "");
    return res.status(200).json({
      report: {
        goals: s(parsed.goals),
        highlights: s(parsed.highlights),
        velocity: s(parsed.velocity),
        risks: s(parsed.risks),
        dependencies: s(parsed.dependencies),
        nextSteps: s(parsed.nextSteps),
      },
    });
  } catch (e) {
    return res.status(502).json({ error: "Report generation failed." });
  }
}
