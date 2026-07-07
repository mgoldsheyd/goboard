// goBoard — remote MCP server (custom connector for Claude apps / Cowork).
//
// Speaks MCP over Streamable HTTP: clients POST JSON-RPC messages to this
// endpoint. Exposes three tools — create_ticket, list_tickets, move_ticket —
// backed by the same Upstash Redis state as the rest of the app.
//
// Connect from a Claude app as a custom connector using:
//   https://<your-app>.vercel.app/api/mcp?key=<TICKETS_API_KEY>
//
// The key in the URL is the shared secret (same TICKETS_API_KEY env var as
// api/tickets.js). Crude compared to OAuth, but workable for a personal
// board; treat the full URL as a secret.

const KEY = "goboard-state-v1";
const STATUSES = ["New", "Ready", "In Progress", "Blocked", "In Review", "QA", "Ready for Release", "Done"];
const PRIORITIES = ["P1", "P2", "P3", "P4", "P5"];
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const TOOLS = [
  {
    name: "create_ticket",
    description: "Create a new ticket on the goBoard scrum board. Returns the created ticket including its assigned ID.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short summary of the work (required)" },
        desc: { type: "string", description: "What needs to be done and why" },
        priority: { type: "string", enum: PRIORITIES, description: "Urgency, P1 highest. Default P3" },
        effort: { type: "string", enum: ["1", "2", "3", "5", "8", "13", "21"], description: "Fibonacci story points. Default 3" },
        assignee: { type: "string", description: "Person's name" },
        status: { type: "string", enum: STATUSES, description: "Board column. Default New" },
        category: { type: "string", description: "e.g. Frontend, Backend, Infra" },
        feature: { type: "string", description: "Parent feature name" },
        release: { type: "string", description: "Release number, e.g. 2.4" },
        risks: { type: "string", description: "Known risks" },
        deps: { type: "string", description: "Blocking tickets or teams" },
      },
      required: ["title"],
    },
  },
  {
    name: "list_tickets",
    description: "List tickets on the goBoard scrum board, optionally filtered by status, assignee, priority, or category.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: STATUSES },
        assignee: { type: "string" },
        priority: { type: "string", enum: PRIORITIES },
        category: { type: "string" },
      },
    },
  },
  {
    name: "move_ticket",
    description: "Move a ticket to a different status column on the goBoard scrum board (e.g. mark it Done).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Ticket ID, e.g. GO-1015" },
        status: { type: "string", enum: STATUSES, description: "Target column" },
      },
      required: ["id", "status"],
    },
  },
];

function makeRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return (command) =>
    fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    }).then((r) => r.json());
}

async function loadState(redis) {
  const j = await redis(["GET", KEY]);
  return j.result ? JSON.parse(j.result) : { nextId: 1001, tickets: [], velocity: [] };
}

async function saveState(redis, state) {
  const serialized = JSON.stringify(state);
  if (serialized.length > 1_000_000) throw new Error("Board too large to save.");
  await redis(["SET", KEY, serialized]);
}

const str = (v) => (typeof v === "string" ? v.trim() : "");

async function runTool(redis, name, args) {
  if (name === "create_ticket") {
    const title = str(args.title);
    if (!title) throw new Error("'title' is required and must be a non-empty string.");
    const state = await loadState(redis);
    const ticket = {
      id: "GO-" + state.nextId++,
      title,
      desc: str(args.desc),
      effort: args.effort ? String(args.effort) : "3",
      priority: PRIORITIES.includes(args.priority) ? args.priority : "P3",
      assignee: str(args.assignee),
      status: STATUSES.includes(args.status) ? args.status : "New",
      risks: str(args.risks),
      deps: str(args.deps),
      category: str(args.category),
      feature: str(args.feature),
      release: str(args.release),
    };
    state.tickets.push(ticket);
    await saveState(redis, state);
    return { created: ticket };
  }

  if (name === "list_tickets") {
    const state = await loadState(redis);
    const tickets = state.tickets
      .filter(
        (t) =>
          (!args.status || t.status === args.status) &&
          (!args.assignee || t.assignee === args.assignee) &&
          (!args.priority || t.priority === args.priority) &&
          (!args.category || t.category === args.category)
      )
      .map(({ id, title, status, priority, effort, assignee, category }) => ({ id, title, status, priority, effort, assignee, category }));
    return { count: tickets.length, tickets };
  }

  if (name === "move_ticket") {
    if (!STATUSES.includes(args.status)) throw new Error(`'status' must be one of: ${STATUSES.join(", ")}`);
    const state = await loadState(redis);
    const ticket = state.tickets.find((t) => t.id === args.id);
    if (!ticket) throw new Error(`No ticket with id '${args.id}'.`);
    ticket.status = args.status;
    await saveState(redis, state);
    return { moved: ticket };
  }

  throw new Error(`Unknown tool '${name}'.`);
}

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed — POST MCP JSON-RPC messages to this endpoint." });
  }

  const apiKey = process.env.TICKETS_API_KEY;
  if (!apiKey) {
    return res.status(501).json({ error: "TICKETS_API_KEY not configured." });
  }
  const provided = (req.query && req.query.key) || "";
  const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (provided !== apiKey && bearer !== apiKey) {
    return res.status(401).json({ error: "Unauthorized — pass ?key=<TICKETS_API_KEY> in the connector URL." });
  }

  const redis = makeRedis();
  if (!redis) {
    return res.status(501).json({ error: "Storage not configured — see api/board.js for setup steps." });
  }

  let msg;
  try {
    msg = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json(rpcError(null, -32700, "Parse error"));
  }
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return res.status(400).json(rpcError(msg && msg.id != null ? msg.id : null, -32600, "Invalid request"));
  }

  // Notifications (no id) get acknowledged with no body
  if (msg.id === undefined || msg.id === null) {
    return res.status(202).end();
  }

  try {
    if (msg.method === "initialize") {
      const requested = msg.params && msg.params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
      return res.status(200).json(
        rpcResult(msg.id, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "goboard", version: "1.0.0" },
        })
      );
    }

    if (msg.method === "ping") {
      return res.status(200).json(rpcResult(msg.id, {}));
    }

    if (msg.method === "tools/list") {
      return res.status(200).json(rpcResult(msg.id, { tools: TOOLS }));
    }

    if (msg.method === "tools/call") {
      const { name, arguments: args = {} } = msg.params || {};
      try {
        const out = await runTool(redis, name, args);
        return res.status(200).json(
          rpcResult(msg.id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] })
        );
      } catch (e) {
        return res.status(200).json(
          rpcResult(msg.id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true })
        );
      }
    }

    return res.status(200).json(rpcError(msg.id, -32601, `Method not found: ${msg.method}`));
  } catch (e) {
    return res.status(200).json(rpcError(msg.id, -32603, "Internal error"));
  }
}
