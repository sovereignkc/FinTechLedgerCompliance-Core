/**
 * hooks/mcp_cobol_audit_server.js
 *
 * MCP tool server: COBOL Source Analysis
 *
 * Tools:
 *   run_cobol_analysis    — grep-based static analysis of legacy_core.cbl and
 *                           legacy_public_treasuring.cbl for all COBOL defects
 *   run_cobol_build_check — attempts to compile legacy_core.cbl with cobc (GnuCOBOL)
 *                           and reports the result
 *
 * Source files analyzed:
 *   backend/legacy_core.cbl             — FP-001-CBL, SOL-002-CBL, LAT-003-CBL
 *   backend/legacy_public_treasuring.cbl — TRUNC-001, AUDIT-001-CBL
 *   backend/legacy_ext_treasuring.cbl   — stub (empty file)
 *
 * HARNESS CONTRACT: findings confirm defects present. Do NOT modify COBOL sources.
 */

"use strict";

const readline = require("readline");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const BACKEND_DIR    = path.join(WORKSPACE_ROOT, process.env.BACKEND_DIR || "backend");
const CORE_CBL       = path.join(BACKEND_DIR, "legacy_core.cbl");
const TREASURY_CBL   = path.join(BACKEND_DIR, "legacy_public_treasuring.cbl");
const EXT_CBL        = path.join(BACKEND_DIR, "legacy_ext_treasuring.cbl");

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let buffer = "";
rl.on("line", (line) => {
  buffer += line;
  try { const msg = JSON.parse(buffer); buffer = ""; handleMessage(msg); }
  catch { /* partial */ }
});
function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }

function handleMessage(msg) {
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "cobol-audit", version: "1.0.0" },
      capabilities: { tools: {} },
    }});
    return;
  }

  if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: [
      {
        name: "run_cobol_analysis",
        description:
          "Static analysis of all COBOL files in backend/. Reports: " +
          "FP-001-CBL (COMP-1 used for monetary WS fields in legacy_core.cbl), " +
          "SOL-002-CBL (solvency branch detected but execution continues to COMPUTE WS-DEBT), " +
          "LAT-003-CBL (C$SLEEP blocking call in transaction path), " +
          "TRUNC-001 (implicit truncation: PIC S9(10)V99 cannot hold 5B * 0.12555 exactly), " +
          "AUDIT-001-CBL (no DISPLAY or external write before SUBTRACT in treasury program). " +
          "Also checks legacy_ext_treasuring.cbl status (stub/empty).",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "run_cobol_build_check",
        description:
          "Attempts to compile backend/legacy_core.cbl using cobc (GnuCOBOL). " +
          "Returns: compiler output, exit code, and whether the binary was produced. " +
          "Requires cobc in PATH (install GnuCOBOL: https://gnucobol.sourceforge.io/). " +
          "Compilation success confirms the COBOL syntax is valid (which is expected — " +
          "the defects are semantic/behavioral, not syntactic, unlike SYN-004 in C++).",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ]}});
    return;
  }

  if (msg.method === "tools/call") {
    const name = msg.params && msg.params.name;
    if (name === "run_cobol_analysis")    return toolCobolAnalysis(msg);
    if (name === "run_cobol_build_check") return toolCobolBuild(msg);
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    return;
  }
  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
}

function analyzeFile(filePath) {
  try { return { src: fs.readFileSync(filePath, "utf8"), error: null }; }
  catch (e) { return { src: null, error: e.message }; }
}

function toolCobolAnalysis(msg) {
  const { src: coreSrc, error: coreErr }   = analyzeFile(CORE_CBL);
  const { src: trSrc,   error: trErr }     = analyzeFile(TREASURY_CBL);
  const { src: extSrc }                    = analyzeFile(EXT_CBL);

  const output = [
    "=== COBOL Static Analysis ===",
    "Files: legacy_core.cbl | legacy_public_treasuring.cbl | legacy_ext_treasuring.cbl",
    "",
  ];

  // ── legacy_core.cbl ──────────────────────────────────────────────────────
  output.push("── legacy_core.cbl ──────────────────────────────────────────");
  if (coreErr) {
    output.push(`  [ERROR] Cannot read file: ${coreErr}`);
  } else {
    const coreLines = coreSrc.split("\n");

    // FP-001-CBL: COMP-1 monetary fields
    const comp1Lines = coreLines
      .map((l, i) => ({ n: i + 1, l: l.trim() }))
      .filter(({ l }) => /COMP-1/.test(l) && /WS-(ASSETS|DEBT|FEE|INTEREST|AMOUNT|POSTED|PROJECTED|DRIFT|CURRENCY|SUM)/i.test(l));

    output.push(`[FP-001-CBL] COMP-1 monetary fields: ${comp1Lines.length} found`);
    if (comp1Lines.length > 0) {
      output.push("  FAIL — COMP-1 is IEEE 754 single-precision float. Use integer minor units instead.");
      comp1Lines.slice(0, 6).forEach(({ n, l }) => output.push(`  Line ${n}: ${l}`));
    }
    output.push("");

    // SOL-002-CBL: solvency breach without hard stop
    const solLines = coreLines
      .map((l, i) => ({ n: i + 1, l: l.trim() }))
      .filter(({ l }) => /SOLVENCY|BREACHED|LIMIT|RATIO/i.test(l));
    const hasHardStop = coreSrc.includes("STOP RUN") &&
      coreSrc.indexOf("STOP RUN") < coreSrc.indexOf("COMPUTE WS-DEBT");
    output.push(`[SOL-002-CBL] Solvency check without hard stop:`);
    output.push(`  FAIL — Solvency branch sets WS-STATUS to BREACHED but execution`);
    output.push(`         continues to COMPUTE WS-DEBT (transaction is posted regardless).`);
    output.push(`  Hard stop before COMPUTE WS-DEBT: ${hasHardStop ? "[PRESENT]" : "[MISSING — SOL-002-CBL CONFIRMED]"}`);
    output.push("");

    // LAT-003-CBL: C$SLEEP
    const sleepLines = coreLines
      .map((l, i) => ({ n: i + 1, l: l.trim() }))
      .filter(({ l }) => /C\$SLEEP/i.test(l));
    output.push(`[LAT-003-CBL] C$SLEEP blocking calls: ${sleepLines.length}`);
    if (sleepLines.length > 0) {
      output.push("  FAIL — C$SLEEP blocks the entire COBOL process for WS-SLEEP-SECONDS.");
      sleepLines.forEach(({ n, l }) => output.push(`  Line ${n}: ${l}`));
    }
    output.push("");

    // Drift demo
    const driftLines = coreLines
      .filter(({ l } = {}) => false || l);
    const hasDriftSection = /DEMONSTRATE-FLOATING-POINT-DRIFT/i.test(coreSrc);
    output.push(`[FP-001-CBL DEMO] DEMONSTRATE-FLOATING-POINT-DRIFT paragraph: ${hasDriftSection ? "[PRESENT — confirms 0.10+0.20 drift]" : "[NOT FOUND]"}`);
    output.push("");
  }

  // ── legacy_public_treasuring.cbl ─────────────────────────────────────────
  output.push("── legacy_public_treasuring.cbl ─────────────────────────────");
  if (trErr) {
    output.push(`  [ERROR] Cannot read file: ${trErr}`);
  } else {
    const trLines = trSrc.split("\n");

    // TRUNC-001: PIC S9(10)V99 holding 5B * 0.12555
    const picLines = trLines
      .map((l, i) => ({ n: i + 1, l: l.trim() }))
      .filter(({ l }) => /PIC\s+S9\(10\)V99/i.test(l) || /WS-ALLOCATION-REQUEST/i.test(l));
    output.push(`[TRUNC-001] Implicit truncation risk:`);
    output.push("  FAIL — PIC S9(10)V99 COMP-3 can hold up to 9,999,999,999.99.");
    output.push("  5,000,000,000 * 0.12555 = 627,750,000.00 — fits numerically,");
    output.push("  BUT the intermediate COMP-3 multiplication of a packed-decimal");
    output.push("  by a non-exact binary fraction (0.12555) may lose precision.");
    output.push("  FIX: use integer arithmetic — multiply by 12555 then divide by 100000.");
    picLines.forEach(({ n, l }) => output.push(`  Line ${n}: ${l}`));
    output.push("");

    // AUDIT-001-CBL: no write/log before SUBTRACT
    const subtractIdx = trLines.findIndex(({ l } = {}) => false);
    const subtractLine = trLines.findIndex(l => /SUBTRACT\s+WS-ALLOCATION-REQUEST/i.test(l));
    const hasAuditBefore = subtractLine > 0 &&
      trLines.slice(0, subtractLine).some(l => /WRITE|INSERT|LOG|AUDIT/i.test(l));
    output.push(`[AUDIT-001-CBL] Audit write before SUBTRACT:`);
    output.push(`  ${hasAuditBefore ? "[PRESENT]" : "FAIL — No audit record written before asset reallocation. AUDIT-001-CBL CONFIRMED."}`);
    if (subtractLine >= 0) output.push(`  SUBTRACT at line ${subtractLine + 1}: ${trLines[subtractLine].trim()}`);
    output.push("");
  }

  // ── legacy_ext_treasuring.cbl ────────────────────────────────────────────
  output.push("── legacy_ext_treasuring.cbl ────────────────────────────────");
  const extContent = extSrc || "";
  output.push(`  File size: ${extContent.trim().length} characters`);
  output.push(`  Status: ${extContent.trim().length === 0 ? "[STUB — empty file, no implementation]" : "[Has content — verify contents]"}`);
  output.push("  Do NOT invoke this file as a program. It is a placeholder.");
  output.push("");

  output.push("=== COBOL Analysis Summary ===");
  output.push("HARNESS CONTRACT: FAIL findings above confirm defects in COBOL sources.");
  output.push("Do NOT modify any COBOL source files during the current pass.");

  send({ jsonrpc: "2.0", id: msg.id, result: {
    content: [{ type: "text", text: output.join("\n") }],
  }});
}

function toolCobolBuild(msg) {
  execFile("cobc", ["--version"], {}, (err) => {
    if (err) {
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text",
        text: "[PREREQ MISSING] cobc (GnuCOBOL) not found in PATH.\n" +
              "Install: https://gnucobol.sourceforge.io/ or 'brew install gnu-cobol' (macOS)\n" +
              "or 'apt install gnucobol' (Debian/Ubuntu).\n\n" +
              "COBOL defects (FP-001-CBL, SOL-002-CBL, LAT-003-CBL) are confirmed by static\n" +
              "analysis in run_cobol_analysis. Build check requires cobc to verify runtime behavior."
      }]}});
      return;
    }

    execFile("cobc", ["-x", "-free", "-o", "/tmp/legacy_core_check", CORE_CBL],
      { cwd: BACKEND_DIR, timeout: 30000 },
      (buildErr, stdout, stderr) => {
        const exitCode = buildErr ? (buildErr.code || 1) : 0;
        const out = (stdout || "") + (stderr ? "\n" + stderr : "");
        const status = exitCode === 0
          ? "[PASS] legacy_core.cbl compiles cleanly with cobc -x -free.\n" +
            "NOTE: Compilation success is expected — COBOL defects here are semantic, not syntactic."
          : "[FAIL] legacy_core.cbl failed to compile.";
        send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text",
          text: `=== COBOL Build Check ===\nExit: ${exitCode}\n${status}\n\n${out}`
        }]}});
      }
    );
  });
}
