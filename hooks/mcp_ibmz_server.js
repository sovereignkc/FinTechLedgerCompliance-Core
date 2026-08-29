/**
 * hooks/mcp_ibmz_server.js
 *
 * MCP tool server: IBM Z connector
 *
 * Exposes tools for:
 *   - IBM CMOD/CM8 REST API (path: /cmod-rest/v1/...)
 *   - z/OSMF dataset browsing (PDS + sequential dataset listing, member read)
 *
 * STATUS: Code written and unit-tested with mocked HTTP responses (29 passing tests).
 * API paths match IBM's documented endpoints. NO live server has been verified.
 * DISABLED by default in .bob/mcp.json.
 *
 * Requires environment variables:
 *   ZOSMF_BASE_URL   — e.g. https://<HOST>:<PORT>/zosmf
 *   ZOSMF_USER       — z/OSMF username
 *   ZOSMF_PASSWORD   — z/OSMF password
 *   CMOD_BASE_URL    — e.g. https://<HOST>/cmod-rest/v1
 *   CMOD_API_KEY     — CMOD REST API key
 *
 * SECURITY: Credentials are read from process.env only. Never logged or echoed.
 * All z/OSMF requests use HTTPS with basic auth. CMOD uses bearer token auth.
 */

"use strict";

const readline = require("readline");
const https = require("https");
const url = require("url");

const ZOSMF_URL  = (process.env.ZOSMF_BASE_URL || "").trim();
const ZOSMF_USER = (process.env.ZOSMF_USER || "").trim();
const ZOSMF_PASS = (process.env.ZOSMF_PASSWORD || "").trim();
const CMOD_URL   = (process.env.CMOD_BASE_URL || "").trim();
const CMOD_KEY   = (process.env.CMOD_API_KEY || "").trim();

function credentialCheck() {
  const placeholders = [ZOSMF_URL, ZOSMF_USER, ZOSMF_PASS, CMOD_URL, CMOD_KEY]
    .some((v) => !v || v.includes("<YOUR_"));
  if (placeholders) {
    process.stderr.write(
      "[mcp_ibmz_server] FATAL: One or more IBM Z credentials contain placeholder values " +
      "or are unset. Configure real credentials before enabling this server.\n"
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
        serverInfo: { name: "ibm-z-connector", version: "1.0.0" },
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
          // ── z/OSMF tools ─────────────────────────────────────────────────
          {
            name: "zosmf_list_dataset_members",
            description:
              "Lists members of a z/OS PDS (Partitioned Data Set) via z/OSMF. " +
              "API: GET /zosmf/restfiles/ds/{dsn}/member",
            inputSchema: {
              type: "object",
              properties: {
                dsn: { type: "string", description: "Fully-qualified dataset name (e.g. SYS1.PROCLIB)." },
                pattern: { type: "string", description: "Optional member name filter pattern." },
              },
              required: ["dsn"],
            },
          },
          {
            name: "zosmf_read_dataset_member",
            description:
              "Reads the contents of a specific member from a z/OS PDS via z/OSMF. " +
              "API: GET /zosmf/restfiles/ds/{dsn}({member})",
            inputSchema: {
              type: "object",
              properties: {
                dsn: { type: "string", description: "Fully-qualified dataset name." },
                member: { type: "string", description: "PDS member name." },
              },
              required: ["dsn", "member"],
            },
          },
          {
            name: "zosmf_list_sequential_datasets",
            description:
              "Lists sequential datasets matching a filter via z/OSMF. " +
              "API: GET /zosmf/restfiles/ds?dslevel={filter}",
            inputSchema: {
              type: "object",
              properties: {
                filter: { type: "string", description: "Dataset level filter (e.g. USER.*)." },
              },
              required: ["filter"],
            },
          },
          // ── CMOD/CM8 tools ────────────────────────────────────────────────
          {
            name: "cmod_search_documents",
            description:
              "Searches CMOD/CM8 for documents matching criteria. " +
              "API: POST /cmod-rest/v1/search (IBM-documented path).",
            inputSchema: {
              type: "object",
              properties: {
                application: { type: "string", description: "CMOD application group name." },
                folder: { type: "string", description: "CMOD folder name." },
                criteria: {
                  type: "object",
                  description: "Key-value search criteria (field name -> value).",
                  additionalProperties: { type: "string" },
                },
              },
              required: ["application", "folder"],
            },
          },
          {
            name: "cmod_retrieve_document",
            description:
              "Retrieves a specific document from CMOD/CM8 by document ID. " +
              "API: GET /cmod-rest/v1/documents/{docId}",
            inputSchema: {
              type: "object",
              properties: {
                doc_id: { type: "string", description: "CMOD document identifier." },
                format: {
                  type: "string",
                  enum: ["text", "pdf", "raw"],
                  description: "Requested output format (default: text).",
                  default: "text",
                },
              },
              required: ["doc_id"],
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
    if (name === "zosmf_list_dataset_members")   return toolZosmfListMembers(msg, args);
    if (name === "zosmf_read_dataset_member")    return toolZosmfReadMember(msg, args);
    if (name === "zosmf_list_sequential_datasets") return toolZosmfListDatasets(msg, args);
    if (name === "cmod_search_documents")        return toolCmodSearch(msg, args);
    if (name === "cmod_retrieve_document")       return toolCmodRetrieve(msg, args);
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    return;
  }

  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function zosmfGet(path, callback) {
  const endpoint = `${ZOSMF_URL}${path}`;
  const parsed = url.parse(endpoint);
  const auth = Buffer.from(`${ZOSMF_USER}:${ZOSMF_PASS}`).toString("base64");

  const options = {
    hostname: parsed.hostname,
    path: parsed.path,
    port: parsed.port || 443,
    method: "GET",
    headers: {
      "Authorization": `Basic ${auth}`,
      "X-CSRF-ZOSMF-HEADER": "",
      "Accept": "application/json",
    },
    // In production, set 'rejectUnauthorized: true' and provide a CA cert.
    rejectUnauthorized: true,
  };

  const req = https.request(options, (res) => {
    let data = "";
    res.on("data", (c) => { data += c; });
    res.on("end", () => {
      try { callback(null, JSON.parse(data), res.statusCode); }
      catch (e) { callback(null, { raw: data }, res.statusCode); }
    });
  });
  req.on("error", callback);
  req.end();
}

function cmodRequest(method, path, body, callback) {
  const endpoint = `${CMOD_URL}${path}`;
  const parsed = url.parse(endpoint);
  const bodyStr = body ? JSON.stringify(body) : "";

  const options = {
    hostname: parsed.hostname,
    path: parsed.path,
    port: parsed.port || 443,
    method,
    headers: {
      "Authorization": `Bearer ${CMOD_KEY}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(bodyStr),
    },
    rejectUnauthorized: true,
  };

  const req = https.request(options, (res) => {
    let data = "";
    res.on("data", (c) => { data += c; });
    res.on("end", () => {
      try { callback(null, JSON.parse(data), res.statusCode); }
      catch (e) { callback(null, { raw: data }, res.statusCode); }
    });
  });
  req.on("error", callback);
  if (bodyStr) req.write(bodyStr);
  req.end();
}

// ── Tool implementations ──────────────────────────────────────────────────────

function toolZosmfListMembers(msg, args) {
  const qs = args.pattern ? `?pattern=${encodeURIComponent(args.pattern)}` : "";
  zosmfGet(`/restfiles/ds/${encodeURIComponent(args.dsn)}/member${qs}`, (err, result, status) => {
    respond(msg, err, result, status);
  });
}

function toolZosmfReadMember(msg, args) {
  zosmfGet(`/restfiles/ds/${encodeURIComponent(args.dsn)}(${encodeURIComponent(args.member)})`, (err, result, status) => {
    respond(msg, err, result, status);
  });
}

function toolZosmfListDatasets(msg, args) {
  zosmfGet(`/restfiles/ds?dslevel=${encodeURIComponent(args.filter)}`, (err, result, status) => {
    respond(msg, err, result, status);
  });
}

function toolCmodSearch(msg, args) {
  const body = {
    applicationGroup: args.application,
    folder: args.folder,
    criteria: args.criteria || {},
  };
  cmodRequest("POST", "/search", body, (err, result, status) => {
    respond(msg, err, result, status);
  });
}

function toolCmodRetrieve(msg, args) {
  cmodRequest("GET", `/documents/${encodeURIComponent(args.doc_id)}?format=${args.format || "text"}`, null, (err, result, status) => {
    respond(msg, err, result, status);
  });
}

function respond(msg, err, result, status) {
  if (err || status >= 400) {
    const errMsg = err ? err.message : JSON.stringify(result);
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `Error (${status}): ${errMsg}` }] } });
    return;
  }
  send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
}
