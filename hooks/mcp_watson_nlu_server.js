/**
 * hooks/mcp_watson_nlu_server.js
 *
 * MCP tool server: Watson Natural Language Understanding
 *
 * Exposes two tools:
 *   _call_watson_nlu_classify          — classifies a text document
 *   _call_watson_nlu_entities_summary  — extracts named entities and returns a summary
 *
 * Requires environment variables (set in .bob/mcp.json or OS environment):
 *   WATSON_NLU_INSTANCE_URL  — e.g. https://api.us-south.natural-language-understanding.watson.cloud.ibm.com/instances/<ID>
 *   WATSON_NLU_API_KEY       — IAM API key for the NLU service instance
 *
 * STATUS: DISABLED by default in .bob/mcp.json.
 * Replace placeholder values before enabling. This server will refuse to start
 * if credentials contain placeholder markers (<YOUR_*>).
 *
 * SECURITY: API key is read from process.env only. It is never logged, echoed
 * to stdout, or included in tool responses.
 */

"use strict";

const readline = require("readline");
const https = require("https");
const url = require("url");

const NLU_URL = (process.env.WATSON_NLU_INSTANCE_URL || "").trim();
const NLU_KEY = (process.env.WATSON_NLU_API_KEY || "").trim();
const NLU_VERSION = "2022-04-07";

// Fail fast if credentials are placeholders or missing
function credentialCheck() {
  if (!NLU_URL || NLU_URL.includes("<YOUR_") || !NLU_KEY || NLU_KEY.includes("<YOUR_")) {
    process.stderr.write(
      "[mcp_watson_nlu_server] FATAL: WATSON_NLU_INSTANCE_URL or WATSON_NLU_API_KEY " +
      "contains placeholder values or is unset. Set real credentials before enabling " +
      "this server in .bob/mcp.json.\n"
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

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function handleMessage(msg) {
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0", id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "watson-nlu", version: "1.0.0" },
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
            name: "_call_watson_nlu_classify",
            description: "Classifies a text document using Watson NLU categories and concepts.",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string", description: "Text to classify (max 50KB)." },
                language: { type: "string", description: "ISO 639-1 language code (default: en).", default: "en" },
              },
              required: ["text"],
            },
          },
          {
            name: "_call_watson_nlu_entities_summary",
            description: "Extracts named entities from text and returns a structured summary.",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string", description: "Text to analyze (max 50KB)." },
                limit: { type: "integer", description: "Max entities to return (default: 10).", default: 10 },
              },
              required: ["text"],
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
    if (name === "_call_watson_nlu_classify") return toolClassify(msg, args);
    if (name === "_call_watson_nlu_entities_summary") return toolEntities(msg, args);
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    return;
  }

  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
}

// ── Watson NLU HTTP helper ────────────────────────────────────────────────────

function nluPost(body, callback) {
  const endpoint = `${NLU_URL}/v1/analyze?version=${NLU_VERSION}`;
  const parsed = url.parse(endpoint);
  const auth = Buffer.from(`apikey:${NLU_KEY}`).toString("base64");
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
    res.on("data", (chunk) => { data += chunk; });
    res.on("end", () => {
      try { callback(null, JSON.parse(data), res.statusCode); }
      catch (e) { callback(e); }
    });
  });
  req.on("error", callback);
  req.write(bodyStr);
  req.end();
}

function toolClassify(msg, args) {
  const body = {
    text: args.text,
    language: args.language || "en",
    features: { categories: {}, concepts: { limit: 5 } },
  };
  nluPost(body, (err, result, status) => {
    if (err || status >= 400) {
      const errMsg = err ? err.message : JSON.stringify(result);
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `Watson NLU error (${status}): ${errMsg}` }] } });
      return;
    }
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
  });
}

function toolEntities(msg, args) {
  const body = {
    text: args.text,
    features: { entities: { limit: args.limit || 10, sentiment: true, disambiguation: true } },
  };
  nluPost(body, (err, result, status) => {
    if (err || status >= 400) {
      const errMsg = err ? err.message : JSON.stringify(result);
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `Watson NLU error (${status}): ${errMsg}` }] } });
      return;
    }
    const entities = (result.entities || []).map((e) => ({
      text: e.text, type: e.type, relevance: e.relevance,
      sentiment: e.sentiment && e.sentiment.label,
      disambiguation: e.disambiguation && e.disambiguation.name,
    }));
    send({
      jsonrpc: "2.0", id: msg.id,
      result: { content: [{ type: "text", text: JSON.stringify({ entities, language: result.language }, null, 2) }] },
    });
  });
}
