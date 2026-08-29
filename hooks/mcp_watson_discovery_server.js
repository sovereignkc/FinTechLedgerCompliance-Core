/**
 * hooks/mcp_watson_discovery_server.js
 *
 * MCP tool server: Watson Discovery
 *
 * Exposes one tool:
 *   _call_watson_discovery_ask — natural language Q&A against an indexed corpus
 *
 * Requires environment variables (set in .bob/mcp.json or OS environment):
 *   WATSON_DISCOVERY_INSTANCE_URL — e.g. https://api.us-south.discovery.watson.cloud.ibm.com/instances/<ID>
 *   WATSON_DISCOVERY_API_KEY      — IAM API key
 *   WATSON_DISCOVERY_PROJECT_ID   — Discovery project ID (UUID)
 *
 * PREREQUISITES: A Discovery project must be created and documents ingested
 * into a collection before this tool returns meaningful results. The MCP
 * server will start and call the API, but an empty collection returns no passages.
 *
 * STATUS: DISABLED by default in .bob/mcp.json.
 * Replace all <YOUR_*> placeholder values before enabling.
 *
 * SECURITY: API key is read from process.env only. Never logged or echoed.
 */

"use strict";

const readline = require("readline");
const https = require("https");
const url = require("url");

const DISC_URL        = (process.env.WATSON_DISCOVERY_INSTANCE_URL || "").trim();
const DISC_KEY        = (process.env.WATSON_DISCOVERY_API_KEY || "").trim();
const DISC_PROJECT_ID = (process.env.WATSON_DISCOVERY_PROJECT_ID || "").trim();
const DISC_VERSION    = "2023-03-31";

function credentialCheck() {
  const missing = [
    !DISC_URL || DISC_URL.includes("<YOUR_"),
    !DISC_KEY || DISC_KEY.includes("<YOUR_"),
    !DISC_PROJECT_ID || DISC_PROJECT_ID.includes("<YOUR_"),
  ].some(Boolean);
  if (missing) {
    process.stderr.write(
      "[mcp_watson_discovery_server] FATAL: One or more Discovery credentials contain " +
      "placeholder values or are unset. Set real credentials before enabling this server.\n"
    );
    process.exit(1);
  }
}
credentialCheck();

// ── MCP stdio framing ────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let buffer = "";

rl.on("line", (line) => {
  buffer += line;
  try {
    const msg = JSON.parse(buffer);
    buffer = "";
    handleMessage(msg);
  } catch { /* partial */ }
});

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }

function handleMessage(msg) {
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0", id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "watson-discovery", version: "1.0.0" },
        capabilities: { tools: {} },
      },
    });
    return;
  }

  if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0", id: msg.id,
      result: {
        tools: [
          {
            name: "_call_watson_discovery_ask",
            description:
              "Submits a natural language question to a Watson Discovery project and " +
              "returns the top passages from the indexed corpus. Requires a populated " +
              "Discovery collection (documents must be ingested before querying).",
            inputSchema: {
              type: "object",
              properties: {
                question: { type: "string", description: "Natural language question to ask." },
                passages_count: { type: "integer", description: "Number of passages to return (default: 5).", default: 5 },
                collection_ids: {
                  type: "array",
                  items: { type: "string" },
                  description: "Optional list of collection UUIDs to restrict the query to.",
                },
              },
              required: ["question"],
            },
          },
        ],
      },
    });
    return;
  }

  if (msg.method === "tools/call") {
    const name = msg.params && msg.params.name;
    const args = (msg.params && msg.params.arguments) || {};
    if (name === "_call_watson_discovery_ask") return toolAsk(msg, args);
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    return;
  }

  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
}

// ── Watson Discovery HTTP helper ──────────────────────────────────────────────

function discoveryQuery(body, callback) {
  const endpoint = `${DISC_URL}/v2/projects/${DISC_PROJECT_ID}/query?version=${DISC_VERSION}`;
  const parsed = url.parse(endpoint);
  const auth = Buffer.from(`apikey:${DISC_KEY}`).toString("base64");
  const bodyStr = JSON.stringify(body);

  const options = {
    hostname: parsed.hostname,
    path: parsed.path,
    port: parsed.port || 443,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(bodyStr),
      "Authorization": `Basic ${auth}`,
    },
  };

  const req = https.request(options, (res) => {
    let data = "";
    res.on("data", (c) => { data += c; });
    res.on("end", () => {
      try { callback(null, JSON.parse(data), res.statusCode); }
      catch (e) { callback(e); }
    });
  });
  req.on("error", callback);
  req.write(bodyStr);
  req.end();
}

function toolAsk(msg, args) {
  const body = {
    natural_language_query: args.question,
    passages: {
      enabled: true,
      count: args.passages_count || 5,
      fields: ["text"],
      characters: 400,
      find_answers: true,
      max_answers_per_passage: 1,
    },
  };
  if (args.collection_ids && args.collection_ids.length > 0) {
    body.collection_ids = args.collection_ids;
  }

  discoveryQuery(body, (err, result, status) => {
    if (err || status >= 400) {
      const errMsg = err ? err.message : JSON.stringify(result);
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `Discovery error (${status}): ${errMsg}` }] } });
      return;
    }

    const passages = (result.results || []).flatMap((r) =>
      (r.document_passages || []).map((p) => ({
        document_id: r.document_id,
        passage_text: p.passage_text,
        confidence: p.answers && p.answers[0] && p.answers[0].confidence,
      }))
    );

    send({
      jsonrpc: "2.0", id: msg.id,
      result: { content: [{ type: "text", text: JSON.stringify({ question: args.question, passages }, null, 2) }] },
    });
  });
}
