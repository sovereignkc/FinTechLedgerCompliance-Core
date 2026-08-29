/**
 * hooks/mcp_java_bond_audit_server.js
 *
 * MCP tool server: Java Bond Clearing Race Condition + Audit Trail Harness
 *
 * Tools:
 *   run_java_bond_race_test    — compiles and runs LegacyBondClearingEngine with
 *                                2 concurrent threads; asserts actual balance < expected
 *   run_java_bond_static_audit — grep-based static analysis of legacy_bond_clearing.java
 *                                for RACE-001, FP-001-JAVA, AUDIT-001-JAVA defects
 *
 * Source file analyzed: backend/legacy_bond_clearing.java
 *
 * Defects characterized:
 *   RACE-001     — non-atomic double field under concurrent settlement (lost updates)
 *   FP-001-JAVA  — double used for monetary cleared balance
 *   AUDIT-001-JAVA — no audit log entry on balance mutation
 *
 * HARNESS CONTRACT:
 *   run_java_bond_race_test PASSES when the race condition is present (actual < expected).
 *   run_java_bond_static_audit returns FAIL lines for each detected defect pattern.
 *   These results CONFIRM the defects exist. Do NOT modify the Java source to fix them.
 *
 * Prerequisites: javac and java must be in PATH.
 */

"use strict";

const readline = require("readline");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const BACKEND_DIR    = path.join(WORKSPACE_ROOT, process.env.BACKEND_DIR || "backend");
const JAVA_SOURCE    = path.join(BACKEND_DIR, "legacy_bond_clearing.java");

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
      serverInfo: { name: "java-bond-audit", version: "1.0.0" },
      capabilities: { tools: {} },
    }});
    return;
  }

  if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: [
      {
        name: "run_java_bond_race_test",
        description:
          "Compiles backend/legacy_bond_clearing.java and runs its main() method. " +
          "RACE-001 characterization: with 2 threads x 10,000 settlements at $1,000 " +
          "face value, the expected cleared balance is $20,000,000.00. Due to the " +
          "non-atomic double read-modify-write in settleBond(), the actual balance " +
          "will usually be less. HARNESS PASSES when actual < expected (confirms RACE-001). " +
          "Returns: expected balance, actual balance, deficit amount, and RACE-001 verdict.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "run_java_bond_static_audit",
        description:
          "Grep-based static analysis of backend/legacy_bond_clearing.java. " +
          "Reports: RACE-001 (non-volatile/non-atomic double field), " +
          "FP-001-JAVA (double used for monetary cleared balance), " +
          "AUDIT-001-JAVA (no audit log write in settleBond method). " +
          "Each finding includes line number and the offending code.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ]}});
    return;
  }

  if (msg.method === "tools/call") {
    const name = msg.params && msg.params.name;
    if (name === "run_java_bond_race_test")    return toolJavaRaceTest(msg);
    if (name === "run_java_bond_static_audit") return toolJavaStaticAudit(msg);
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    return;
  }
  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
}

function toolJavaRaceTest(msg) {
  // Check java/javac availability
  execFile("javac", ["--version"], {}, (err) => {
    if (err) {
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text:
        "[PREREQ MISSING] javac not found in PATH.\n" +
        "Install JDK (https://adoptium.net/) to run the Java race condition test.\n" +
        "STATIC AUDIT ONLY: Use run_java_bond_static_audit instead.\n\n" +
        "RACE-001 characterization (from source inspection):\n" +
        "  File: backend/legacy_bond_clearing.java lines 25-28\n" +
        "  Method: settleBond(double faceValue)\n" +
        "  Defect: double current = clearedBalance; // non-atomic read\n" +
        "          double updated = current + faceValue; // non-atomic compute\n" +
        "          clearedBalance = updated; // non-atomic write\n" +
        "  Expected: With 2 threads x 10,000 x $1,000 = $20,000,000.00\n" +
        "  Actual:   Will be < $20,000,000.00 due to lost updates\n" +
        "  HARNESS ASSERTION: actual_balance < expected_balance => RACE-001 CONFIRMED"
      }]}});
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bond-race-"));
    const tmpSrc = path.join(tmpDir, "LegacyBondClearingEngine.java");

    fs.copyFileSync(JAVA_SOURCE, tmpSrc);

    execFile("javac", [tmpSrc], { cwd: tmpDir, timeout: 30000 }, (compileErr, _, compileStderr) => {
      if (compileErr) {
        cleanupAndRespond(tmpDir);
        send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text:
          `[COMPILE ERROR] Failed to compile legacy_bond_clearing.java:\n${compileStderr}\n` +
          "If the class has a missing import or incompatible Java version, check your JDK."
        }]}});
        return;
      }

      execFile("java", ["LegacyBondClearingEngine"], { cwd: tmpDir, timeout: 30000 },
        (runErr, stdout, stderr) => {
          cleanupAndRespond(tmpDir);
          const out = stdout || "";
          const lines = out.split("\n");

          // Parse expected and actual from program output
          let expected = null, actual = null;
          for (const line of lines) {
            const em = line.match(/Expected cleared balance:\s*([\d.]+)/);
            const am = line.match(/Actual cleared balance:\s*([\d.]+)/);
            if (em) expected = parseFloat(em[1]);
            if (am) actual = parseFloat(am[1]);
          }

          let verdict = "";
          if (expected !== null && actual !== null) {
            const deficit = expected - actual;
            if (actual < expected) {
              verdict = `\n[HARNESS PASS] RACE-001 CONFIRMED: Deficit = $${deficit.toFixed(2)}\n` +
                        `  actual (${actual}) < expected (${expected})\n` +
                        `  Lost updates due to non-atomic double read-modify-write across threads.\n` +
                        `  FIX (when authorized): replace 'double clearedBalance' with\n` +
                        `  'AtomicLong clearedBalanceCents' and use compareAndSet().`;
            } else {
              verdict = `\n[NOTE] Race condition not observed in this run (actual == expected).\n` +
                        `  This is a non-deterministic defect. Run multiple times or increase thread count.`;
            }
          }

          send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text",
            text: `=== Java Bond Race Test (RACE-001) ===\n\n${out}${verdict}`
          }]}});
        }
      );
    });
  });
}

function cleanupAndRespond(dir) {
  try { fs.rmSync(dir, { recursive: true }); } catch {}
}

function toolJavaStaticAudit(msg) {
  let src;
  try { src = fs.readFileSync(JAVA_SOURCE, "utf8"); }
  catch (e) {
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text",
      text: `[ERROR] Cannot read backend/legacy_bond_clearing.java: ${e.message}`
    }]}});
    return;
  }

  const lines = src.split("\n");
  const findings = [];

  const checks = [
    {
      id: "RACE-001",
      description: "Non-atomic/non-volatile monetary double field (concurrent write without lock)",
      pattern: /private\s+double\s+clearedBalance/,
    },
    {
      id: "FP-001-JAVA",
      description: "double used for monetary cleared balance (should be AtomicLong cents)",
      pattern: /double\s+(clearedBalance|faceValue|current|updated)/,
    },
    {
      id: "AUDIT-001-JAVA",
      description: "Balance mutation with no audit log write (missing compliance trail)",
      pattern: /LEGACY DEFECT: no audit trail/i,
    },
    {
      id: "RACE-001-RMW",
      description: "Non-atomic read-modify-write sequence (separate read, compute, write)",
      pattern: /double current = clearedBalance/,
    },
  ];

  for (const check of checks) {
    for (let i = 0; i < lines.length; i++) {
      if (check.pattern.test(lines[i])) {
        findings.push({ defect: check.id, line: i + 1, code: lines[i].trim(), description: check.description });
      }
    }
  }

  // Check: no synchronized/AtomicLong anywhere in settleBond
  const settleBondBlock = src.match(/settleBond[\s\S]*?^    \}/m);
  const hasAtomicOrSync = src.includes("AtomicLong") || src.includes("synchronized") || src.includes("volatile");

  const outputLines = [
    "=== Java Bond Static Audit (RACE-001, FP-001-JAVA, AUDIT-001-JAVA) ===",
    `Source: backend/legacy_bond_clearing.java`,
    "",
    `Thread-safety check: ${hasAtomicOrSync ? "[OK] AtomicLong/synchronized/volatile found" : "[FAIL] NO AtomicLong, synchronized, or volatile — RACE-001 CONFIRMED"}`,
    "",
    "Findings:",
  ];

  if (findings.length === 0) {
    outputLines.push("  No pattern matches found (check source file path).");
  } else {
    for (const f of findings) {
      outputLines.push(`  [FAIL] ${f.defect} @ line ${f.line}: ${f.description}`);
      outputLines.push(`         Code: ${f.code}`);
    }
  }

  outputLines.push("");
  outputLines.push(`Total findings: ${findings.length}`);
  outputLines.push("HARNESS CONTRACT: FAIL findings above confirm defects are present in the source.");
  outputLines.push("Do NOT modify the Java source to fix these defects during the current pass.");

  send({ jsonrpc: "2.0", id: msg.id, result: {
    content: [{ type: "text", text: outputLines.join("\n") }],
  }});
}
