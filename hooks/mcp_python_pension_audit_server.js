/**
 * hooks/mcp_python_pension_audit_server.js
 *
 * MCP tool server: Python Pension Fund Float Drift + Reconciliation Harness
 *
 * Tools:
 *   run_python_pension_drift_test     — runs legacy_pension_setup.py via python3,
 *                                       then runs a Decimal-based reference calculation
 *                                       and computes the drift delta in cents
 *   run_python_reconciliation_audit   — static analysis of legacy_pension_setup.py
 *                                       for FP-DRIFT-001 and RECONCILE-001
 *
 * Source file analyzed: backend/legacy_pension_setup.py
 *
 * Defects characterized:
 *   FP-DRIFT-001   — float accumulation drift over 12,000-retiree batch
 *   RECONCILE-001  — no reconciliation invariant (starting == paid + remaining not checked)
 *
 * HARNESS CONTRACT:
 *   delta_cents > 0 confirms FP-DRIFT-001 (float result differs from Decimal reference).
 *   absence of reconciliation assert confirms RECONCILE-001.
 */

"use strict";

const readline = require("readline");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const BACKEND_DIR    = path.join(WORKSPACE_ROOT, process.env.BACKEND_DIR || "backend");
const PY_SOURCE      = path.join(BACKEND_DIR, "legacy_pension_setup.py");

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
      serverInfo: { name: "python-pension-audit", version: "1.0.0" },
      capabilities: { tools: {} },
    }});
    return;
  }

  if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: [
      {
        name: "run_python_pension_drift_test",
        description:
          "Runs backend/legacy_pension_setup.py (float-based batch) then runs a reference " +
          "calculation using Python decimal.Decimal. Computes the drift delta in cents " +
          "between the float result and the exact Decimal result. " +
          "FP-DRIFT-001 characterization: with 12,000 retirees at $1,834.17/month and a " +
          "$5,000,000,000.00 starting balance, binary float accumulation produces a " +
          "remaining balance that differs from the Decimal reference by multiple cents. " +
          "HARNESS PASSES when delta_cents > 0 (confirming float drift present). " +
          "Requires python3 in PATH.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "run_python_reconciliation_audit",
        description:
          "Static analysis of backend/legacy_pension_setup.py. Reports: " +
          "FP-DRIFT-001 (native float used for batch accumulation — lines using -= and sum()), " +
          "RECONCILE-001 (no assertion that starting_balance == total_paid + remaining_balance). " +
          "Returns line-by-line findings with defect ID, line number, and code.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ]}});
    return;
  }

  if (msg.method === "tools/call") {
    const name = msg.params && msg.params.name;
    if (name === "run_python_pension_drift_test")    return toolDriftTest(msg);
    if (name === "run_python_reconciliation_audit")  return toolReconcileAudit(msg);
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    return;
  }
  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
}

function toolDriftTest(msg) {
  // Inline Python script that:
  // 1. Imports the legacy module and runs it with the standard parameters
  // 2. Runs a Decimal reference calculation with the same parameters
  // 3. Computes and reports the drift delta
  const script = `
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath('${PY_SOURCE.replace(/\\/g, "\\\\")}' )))

# Import legacy module (uses float)
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location("legacy_pension_setup", '${PY_SOURCE.replace(/\\/g, "\\\\")}')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

PAYOUTS = 12000
PAYOUT_AMOUNT = 1834.17
STARTING_BALANCE = 5_000_000_000.00
monthly_payouts = [PAYOUT_AMOUNT] * PAYOUTS

# Run legacy (float) batch
legacy_result = mod.batch_settle(STARTING_BALANCE, monthly_payouts)
float_remaining = legacy_result["remaining_balance"]
float_total_paid = legacy_result["total_paid"]

# Run Decimal reference
from decimal import Decimal, ROUND_HALF_UP, getcontext
getcontext().prec = 28
d_start   = Decimal(str(STARTING_BALANCE))
d_payout  = Decimal(str(PAYOUT_AMOUNT))
d_payouts = [d_payout] * PAYOUTS
d_total   = sum(d_payouts)
d_remaining = d_start - d_total

# Compute drift
drift_float = Decimal(str(float_remaining)) - d_remaining
drift_cents = (drift_float * 100).to_integral_value(rounding=ROUND_HALF_UP)

print(f"=== Python Pension Fund Float Drift Test (FP-DRIFT-001) ===")
print(f"")
print(f"Parameters:")
print(f"  Starting balance:  \${STARTING_BALANCE:,.2f}")
print(f"  Retirees:          {PAYOUTS:,}")
print(f"  Monthly payout:    \${PAYOUT_AMOUNT}")
print(f"")
print(f"Results:")
print(f"  float remaining:   {float_remaining:.6f}")
print(f"  Decimal remaining: {float(d_remaining):.6f}")
print(f"  Drift (float - Decimal): {float(drift_float):.6f}")
print(f"  Drift in cents:    {drift_cents}")
print(f"")

if abs(drift_cents) > 0:
    print(f"[HARNESS PASS] FP-DRIFT-001 CONFIRMED: delta_cents = {drift_cents}")
    print(f"  Float arithmetic produced a {abs(float(drift_float)):.6f} dollar drift")
    print(f"  over {PAYOUTS:,} retiree disbursements.")
    print(f"  FIX (when authorized): replace float with decimal.Decimal throughout")
    print(f"  calculate_pension_disbursements() and batch_settle().")
else:
    print(f"[NOTE] No drift detected in this run (delta_cents = 0).")
    print(f"  This may be platform/Python-version dependent.")

# RECONCILE-001 check
print(f"")
print(f"[RECONCILE-001 Check]")
invariant_holds = abs((float_total_paid + float_remaining) - STARTING_BALANCE) < 0.01
print(f"  abs(total_paid + remaining - starting) = {abs(float_total_paid + float_remaining - STARTING_BALANCE):.6f}")
if not invariant_holds:
    print(f"  [HARNESS PASS] RECONCILE-001 CONFIRMED: invariant violated by > 1 cent")
else:
    print(f"  [NOTE] Invariant holds within 1 cent tolerance on this run.")
print(f"  The legacy code does NOT assert this invariant (confirmed by static audit).")
`;

  execFile("python3", ["-c", script], { cwd: WORKSPACE_ROOT, timeout: 30000 },
    (err, stdout, stderr) => {
      const out = (stdout || "") + (stderr ? "\n[stderr]\n" + stderr : "");
      if (err && !stdout) {
        send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text",
          text: `[ERROR] python3 failed (exit ${err.code}):\n${out}\n\n` +
                `Install python3 and ensure legacy_pension_setup.py is at backend/legacy_pension_setup.py`
        }]}});
        return;
      }
      send({ jsonrpc: "2.0", id: msg.id, result: {
        content: [{ type: "text", text: out }],
      }});
    }
  );
}

function toolReconcileAudit(msg) {
  let src;
  try { src = fs.readFileSync(PY_SOURCE, "utf8"); }
  catch (e) {
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text",
      text: `[ERROR] Cannot read backend/legacy_pension_setup.py: ${e.message}`
    }]}});
    return;
  }

  const lines = src.split("\n");
  const output = [
    "=== Python Pension Fund Static Audit (FP-DRIFT-001, RECONCILE-001) ===",
    `Source: backend/legacy_pension_setup.py`, "",
  ];

  const findings = [];
  const checks = [
    { id: "FP-DRIFT-001", pattern: /remaining\s*-=\s*payout/, description: "float subtraction in accumulation loop" },
    { id: "FP-DRIFT-001", pattern: /total_paid\s*=\s*sum\(monthly_payouts\)/, description: "sum() over float list (same drift class as subtraction loop)" },
    { id: "FP-DRIFT-001", pattern: /starting_balance:\s*float/, description: "starting_balance typed as float" },
    { id: "FP-DRIFT-001", pattern: /monthly_payouts:\s*List\[float\]/, description: "payout list typed as List[float]" },
    { id: "RECONCILE-001", pattern: /LEGACY DEFECT: no assertion/, description: "missing reconciliation invariant (documented in source comment)" },
  ];

  for (const check of checks) {
    for (let i = 0; i < lines.length; i++) {
      if (check.pattern.test(lines[i])) {
        findings.push({ defect: check.id, line: i + 1, code: lines[i].trim(), description: check.description });
      }
    }
  }

  // Check for absence of assert/Decimal usage
  const hasDecimal = src.includes("Decimal") || src.includes("decimal");
  const hasReconcileAssert = src.includes("assert") && (src.includes("total_paid") || src.includes("remaining"));

  output.push(`Decimal usage: ${hasDecimal ? "[PRESENT]" : "[MISSING — FP-DRIFT-001: only float used]"}`);
  output.push(`Reconciliation assert: ${hasReconcileAssert ? "[PRESENT]" : "[MISSING — RECONCILE-001: no invariant check]"}`);
  output.push("");
  output.push("Line-level findings:");

  for (const f of findings) {
    output.push(`  [FAIL] ${f.defect} @ line ${f.line}: ${f.description}`);
    output.push(`         Code: ${f.code}`);
  }

  output.push("");
  output.push("Modern fix pattern (when authorized):");
  output.push("  from decimal import Decimal, ROUND_HALF_UP");
  output.push("  remaining = Decimal(str(starting_balance))");
  output.push("  for payout in monthly_payouts:");
  output.push("      remaining -= Decimal(str(payout))");
  output.push("  assert abs(total_paid + remaining - Decimal(str(starting_balance))) <= Decimal('0.01')");
  output.push("");
  output.push("HARNESS CONTRACT: findings above confirm defects are present. Do NOT fix source yet.");

  send({ jsonrpc: "2.0", id: msg.id, result: {
    content: [{ type: "text", text: output.join("\n") }],
  }});
}
