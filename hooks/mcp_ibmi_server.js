/**
 * hooks/mcp_ibmi_server.js
 *
 * MCP tool server: IBM i connector — STUB ONLY
 *
 * STATUS: NOT IMPLEMENTED.
 *
 * This file documents the intended connector surface for IBM i integration.
 * The following capabilities are planned but have NO executable implementation:
 *
 *   - DB2 for i BLOB storage read/write
 *   - IBM i CMOD integration (this is separate from the IBM Z CMOD work in
 *     mcp_ibmz_server.js, which does have real code)
 *
 * The MCP server will start but every tool call returns a clear "NOT IMPLEMENTED"
 * error. This is intentional -- it is better to fail loudly than to silently
 * return empty or fabricated results.
 *
 * Requires environment variables (for future implementation):
 *   IBMI_HOST              — IBM i hostname or IP
 *   IBMI_USER              — IBM i user profile
 *   IBMI_PASSWORD          — IBM i password
 *   DB2_CONNECTION_STRING  — DB2 for i connection string (ODBC/JDBC format)
 *
 * DO NOT invoke this server for any real workload. It is a placeholder.
 * DISABLED by default in .bob/mcp.json.
 */

"use strict";

const readline = require("readline");

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
        serverInfo: { name: "ibm-i-connector", version: "0.0.0-stub" },
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
            name: "ibmi_db2_blob_read",
            description:
              "[NOT IMPLEMENTED — STUB] Would read a DB2 for i BLOB by primary key. " +
              "No implementation exists. Returns an error if called.",
            inputSchema: {
              type: "object",
              properties: {
                table: { type: "string", description: "DB2 table name." },
                key: { type: "string", description: "Primary key value." },
                column: { type: "string", description: "BLOB column name." },
              },
              required: ["table", "key", "column"],
            },
          },
          {
            name: "ibmi_db2_blob_write",
            description:
              "[NOT IMPLEMENTED — STUB] Would write a BLOB to DB2 for i. " +
              "No implementation exists. Returns an error if called.",
            inputSchema: {
              type: "object",
              properties: {
                table: { type: "string" },
                key: { type: "string" },
                column: { type: "string" },
                data_base64: { type: "string", description: "Base64-encoded BLOB data." },
              },
              required: ["table", "key", "column", "data_base64"],
            },
          },
          {
            name: "ibmi_cmod_retrieve",
            description:
              "[NOT IMPLEMENTED — STUB] Would retrieve a document from CMOD via IBM i. " +
              "This is a separate integration from the IBM Z CMOD connector " +
              "(mcp_ibmz_server.js). No implementation exists.",
            inputSchema: {
              type: "object",
              properties: {
                doc_id: { type: "string" },
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
    // All tool calls return a clear NOT IMPLEMENTED error.
    const name = (msg.params && msg.params.name) || "unknown";
    send({
      jsonrpc: "2.0", id: msg.id,
      result: {
        content: [{
          type: "text",
          text:
            `[IBM i connector — NOT IMPLEMENTED]\n` +
            `Tool "${name}" has no executable implementation. ` +
            `This stub server exists only to document the planned integration surface. ` +
            `Do not use it in any production or test workflow.`,
        }],
      },
    });
    return;
  }

  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
}
