# AGENTS.md — FinTechLedgerCompliance: Legacy Core Remediation

Steering rules for IBM Bob's subagents working this repo. This document is
authoritative over subagent judgment calls for this workspace. If a subagent
is uncertain, it defers to the rules here rather than to whatever is fastest.

**IMPORTANT — DO NOT FIX CODE UNTIL INSTRUCTED.**
The current pass is "hooks, harnesses, and configurations only." Subagents must
characterize defects, write test assertions that prove the defect is present, and
build verification tooling. No source file under `backend/` may be modified to fix
a defect until a future pass explicitly authorizes it.

---

## 0. What this repo is

This is a multi-language FinTech modernization benchmark. The win condition for
a demo run is Bob's agent loop correctly:

1. Discovering every legacy asset in `backend/`
2. Characterizing each defect class with a named ID
3. Proving each defect is present via a test assertion that passes against the
   broken code (i.e., the assertion *expects* the bad behavior, because fixing
   the code is the next pass)
4. Building and connecting all verification hooks so a single `./backend/run_demo.sh`
   or MCP tool call exercises the entire pipeline

The benchmark demonstrates that IBM Bob can architect a production-grade
modernization harness across COBOL, Java, C, C++, Python, and SQL before a
single line of remediation code is written — which is the architectural design
and thorough planning scoring criterion.

---

## 1. Repo map — complete backend corpus

| File | Language | Defect IDs present | Notes |
|---|---|---|---|
| `backend/legacy_core_engine.cpp` | C++ | FP-001, SOL-002, LAT-003, LOG-005, SYN-004 | Primary five-defect fixture. Build currently broken (SYN-004). |
| `backend/legacy_gateway.cpp` | C++ | SOL-002, LAT-003, FP-001 | Standalone gateway demo. Has its own `main()`. |
| `backend/legacy_credit_engine.cpp` | C++ | FP-CREDIT-001 (fixed), CLAMP-001 (fixed) | O(1) int64_t refactor complete. Reference pattern. |
| `backend/legacy_core.cbl` | COBOL (GnuCOBOL) | FP-001, LAT-003, SOL-002 | COMP-1 float, C$SLEEP block, no hard stop. |
| `backend/legacy_public_treasuring.cbl` | COBOL | TRUNC-001, AUDIT-001 | Implicit packed-decimal truncation; no audit write before reallocation. |
| `backend/legacy_ext_treasuring.cbl` | COBOL | (empty file — stub) | Planned external treasury interface. Do not invoke. |
| `backend/legacy_bond_clearing.java` | Java | RACE-001, AUDIT-001 | Non-atomic `double` field under concurrent settlement; no audit log. |
| `backend/legacy_public_clearing.c` | C | OVERFLOW-001, INJECT-001, NOCHECK-001 | `strcpy` stack overflow; `atoll` without bounds check; success code returned even on overflow. |
| `backend/legacy_pension_setup.py` | Python | FP-DRIFT-001, RECONCILE-001 | Float accumulation over 12k-entry batches; no reconciliation invariant. |
| `backend/legacy_audit_procedure.sql` | SQL | SQLINJ-001, AUDIT-002 | String-concatenated dynamic SQL; no audit_log INSERT before COMMIT. |
| `backend/schema.sql` | SQL | (modern — reference) | SQLite WAL schema. Used by `ledger_api.cpp`. |
| `backend/ledger_api.cpp` | C++ | (modern — reference) | Authoritative settlement boundary. All parameterized. |
| `backend/test_legacy_engine.cpp` | C++ | Test harness | Characterizes FP-001, SOL-002, LAT-003, LOG-005, SYN-004. |
| `backend/test_api.py` | Python | Integration tests | Modern API integration suite. |
| `backend/verify_legacy_engine.sh` | Bash | Static audit script | Grep + compile checks for `legacy_core_engine.cpp`. |
| `backend/run_demo.sh` | Bash | Full demo orchestration | Builds legacy COBOL + C++ + modern API and starts server. |
| `backend/ARCHITECTURE.md` | Markdown | Architecture narrative | Legacy vs. modern trust boundary description. |

MCP hook scripts (in `hooks/`):

| Script | Covers |
|---|---|
| `hooks/mcp_verifier_server.js` | Runs `backend/verify_legacy_engine.sh`, reads defect report/log |
| `hooks/mcp_demo_runner_server.js` | Full-corpus demo runner: build pipeline, latency capture, comparison report |
| `hooks/mcp_java_bond_audit_server.js` | Java `LegacyBondClearingEngine` race condition + audit trail harness |
| `hooks/mcp_c_wire_audit_server.js` | C `legacy_public_clearing.c` overflow + injection static analysis |
| `hooks/mcp_sql_injection_audit_server.js` | SQL `legacy_audit_procedure.sql` injection + missing audit trail analysis |
| `hooks/mcp_python_pension_audit_server.js` | Python `legacy_pension_setup.py` float drift + reconciliation harness |
| `hooks/mcp_cobol_audit_server.js` | COBOL `legacy_core.cbl` + `legacy_public_treasuring.cbl` grep-based analysis |
| `hooks/mcp_schema_validator_server.js` | Schema conformance: validates `backend/schema.sql` against modern invariants |
| `hooks/mcp_watson_nlu_server.js` | Watson NLU (disabled until credentials set) |
| `hooks/mcp_watson_discovery_server.js` | Watson Discovery (disabled until credentials set) |
| `hooks/mcp_ibmz_server.js` | IBM Z CMOD + z/OSMF (disabled until credentials set) |
| `hooks/mcp_ibmi_server.js` | IBM i STUB — no implementation |

---

## 2. The loop contract (Explore -> Characterize -> Harness -> Verify)

**Current pass: Characterize + Harness only. No fixes.**

Every subagent touching a defect follows:

1. **Explore** — read the defect tag block in the source file in full. Read
   the corresponding MCP tool definition to understand what the harness already
   measures. Do not assume anything; ground every claim in the source.
2. **Characterize** — state the defect ID, the exact file/line, the root cause
   (one sentence), and the observable failure signature (what a test would see).
3. **Harness** — write or extend the test assertion that proves the defect is
   currently present. The assertion must PASS against the broken code (it expects
   the bad behavior). It must FAIL if the defect were fixed — this is how we
   know remediation is real.
4. **Verify** — invoke the relevant MCP tool or run the relevant script to
   confirm the harness produces the expected characterization output. Read
   the output before declaring the harness complete.

When the fix pass is authorized, the loop becomes:

1. **Explore** — re-read the existing harness assertions.
2. **Plan** — state defect ID, root cause, fix approach. One defect per change-set.
3. **Implement** — minimal correct change only.
4. **Verify** — update assertions from "expect bad" to "expect good", rerun, confirm PASS.

Subagents must never mark a defect CLEARED by editing any report file by hand.

---

## 3. Full defect registry

### C++ — `legacy_core_engine.cpp`

| ID | Category | Exact location | Observable failure signature |
|---|---|---|---|
| FP-001 | double currency fields | `UserAccount::total_collateral`, `UserAccount::active_debt` | `0.10 + 0.20 != 0.30`; 1000x 0.001 != 1.0 |
| SOL-002 | No hard stop on solvency breach | `processTransaction` lines 16-23 | Returns `true` even when ratio > 0.90; `active_debt` mutated |
| LAT-003 | Synchronous 3-second sleep | `processTransaction` line 27 | Wall-clock > 2900 ms against live binary |
| LOG-005 | Fee computed, never applied | `processTransaction` lines 31-32 | `active_debt` increase == `amount`, not `amount + fee` |
| SYN-004 | Missing semicolon on `fee` line | `processTransaction` line 31 | `g++ -std=c++17 -fsyntax-only` exits non-zero |

### C++ — `legacy_gateway.cpp`

| ID | Category | Exact location | Observable failure signature |
|---|---|---|---|
| SOL-002-GW | No hard stop (gateway) | `LegacyGateway::routeTransaction` lines 153-168 | Returns `true` even when debt_to_asset_ratio > 0.90 |
| LAT-003-GW | Synchronous connection-pool sleep | `LegacyConnectionPool::acquire` line 84 | Wall-clock >= `latency_seconds_` seconds |
| FP-001-GW | double monetary fields | `Account::assets`, `Account::debt`, `Transaction::amount` | Same IEEE 754 drift as core engine |

### COBOL — `legacy_core.cbl`

| ID | Category | Exact location | Observable failure signature |
|---|---|---|---|
| FP-001-CBL | COMP-1 floating-point currency | WS-ASSETS, WS-DEBT, all monetary WS fields | `0.10 + 0.20` DISPLAY shows drift; 1000x 0.001 != 1.0 |
| SOL-002-CBL | No hard stop on breach | PROCESS-TRANSACTION lines 153-166 | Status set to BREACHED but execution continues to COMPUTE WS-DEBT |
| LAT-003-CBL | C$SLEEP blocking call | PROCESS-TRANSACTION line 178 | Process blocks for WS-SLEEP-SECONDS (3 seconds) |

### COBOL — `legacy_public_treasuring.cbl`

| ID | Category | Exact location | Observable failure signature |
|---|---|---|---|
| TRUNC-001 | Implicit packed-decimal truncation | `COMPUTE WS-ALLOCATION-REQUEST = WS-PUBLIC-ASSETS * 0.12555` | PIC S9(10)V99 truncates result of 5B * 0.12555; precision lost |
| AUDIT-001-CBL | No audit write before SUBTRACT | Before `SUBTRACT WS-ALLOCATION-REQUEST FROM WS-PUBLIC-ASSETS` | No DISPLAY or external audit record written; reallocation is silent |

### Java — `legacy_bond_clearing.java`

| ID | Category | Exact location | Observable failure signature |
|---|---|---|---|
| RACE-001 | Non-atomic double field under concurrent settlement | `LegacyBondClearingEngine::settleBond` lines 25-28 | With 2 threads x 10k settlements at $1000 face value, `getClearedBalance()` < $20,000,000 (lost updates) |
| FP-001-JAVA | double for monetary field | `clearedBalance` declaration line 22 | IEEE 754 drift in sum of large float values |
| AUDIT-001-JAVA | No audit log on mutation | `settleBond` line 29 comment | Balance changed with no corresponding audit record |

### C — `legacy_public_clearing.c`

| ID | Category | Exact location | Observable failure signature |
|---|---|---|---|
| OVERFLOW-001 | Unbounded `strcpy` into 64-byte buffer | `parse_institutional_wire_message` line 13 | Any `raw_packet` > 63 bytes stack-smashes `internal_buffer` |
| INJECT-001 | `atoll` with no range check on transfer amount | Line 20 | Negative, zero, or astronomically large values accepted as `transfer_cents` |
| NOCHECK-001 | Success (0) returned even when overflow path was taken | Line 22 | Caller cannot distinguish successful parse from overflowed parse |

### Python — `legacy_pension_setup.py`

| ID | Category | Exact location | Observable failure signature |
|---|---|---|---|
| FP-DRIFT-001 | Float accumulation over 12k-retiree batch | `calculate_pension_disbursements` line 35 | `starting_balance - sum(payouts)` via float != via `decimal.Decimal`; delta > 0 |
| RECONCILE-001 | No reconciliation invariant | `batch_settle` lines 40-48 | `starting_balance != total_paid + remaining_balance` not asserted; silent drift passes downstream |

### SQL — `legacy_audit_procedure.sql`

| ID | Category | Exact location | Observable failure signature |
|---|---|---|---|
| SQLINJ-001 | String-concatenated dynamic SQL | `SET @sql = CONCAT(...)` lines 25-31, 36-43 | A crafted `p_from_account` value like `' OR '1'='1` alters the WHERE clause |
| AUDIT-002 | No audit_log INSERT before COMMIT | Entire procedure body | Fund transfer has no compliance trail; `SELECT COUNT(*) FROM audit_log` unchanged after call |

---

## 4. Security & Data Leak Prevention (MANDATORY, all subagents)

### Zero Data Leakage

1. **Credentials never in logs or stdout.** Sensitive values (tokens, API keys,
   DB connection strings, account numbers, PII) must NEVER appear in any log,
   stdout/stderr, audit trail, or observable output channel in plaintext.
2. **Masking rule.** When a sensitive value must appear in a log for traceability,
   replace it with its HMAC-SHA256 (keyed with a server-side secret) or a
   deterministic mask such as `ACCT-****1234`. Raw values are never written.
3. **Environment variable discipline.** MCP server configs in `.bob/mcp.json`
   use `<YOUR_*>` placeholders for secrets. Actual credentials must be supplied
   via OS environment variables or a gitignored `.env` file. Subagents must not
   write literal secrets into any committed file.
4. **Subagent data-minimization.** Each parallel subagent scopes its context
   to the minimum data needed for its assigned defect ID.

### Parameterized Database Queries (MANDATORY)

5. **No raw string concatenation in queries.** `legacy_audit_procedure.sql`
   is a known violation (SQLINJ-001). Every new or modified query must use
   parameterized binding. Mark each compliant query site with `-- PARAM-SAFE`.
6. **The modern reference is `backend/ledger_api.cpp`.** All `sqlite3_prepare_v2`
   + `sqlite3_bind_*` calls there are the correct pattern. Never use `CONCAT`
   or `sprintf` to build a query string.

### Audit Trail Compliance (MANDATORY)

7. **Cryptographic audit entries.** Every committed transaction must produce an
   audit log entry containing: timestamp (ISO-8601 UTC), transaction ID (UUID v4),
   amount in minor units (int64_t cents), masked account identifier, and an
   HMAC-SHA256 of the canonical transaction payload.
8. **Immutability.** Audit log entries are append-only. No subagent may modify
   or delete an existing audit entry as part of any fix.

---

## 5. Git Workflow

1. **Conventional commits.** Format: `<type>(<scope>): <summary>`
   Types: `fix`, `feat`, `refactor`, `test`, `chore`, `docs`.
   Examples:
   - `test(RACE-001): add concurrent bond settlement race condition harness`
   - `test(SQLINJ-001): add SQL injection characterization in MCP audit server`
   - `fix(SYN-004): add missing semicolon on fee declaration` *(fix pass only)*
2. **Branch-per-defect.** `test/RACE-001-bond-race-harness`, `fix/SYN-004-build-break`.
   Harness branches from current pass; fix branches from future pass.
3. **PR hygiene.** Every PR references the defect ID in the title, includes
   harness output (or `defect_report.json` lines for fix pass), and has zero
   new compiler warnings.
4. **Stage and push.** Subagents must not leave work uncommitted.

---

## 6. COBOL & Multi-Language Migration Rules

1. **COBOL COMP-1/COMP-3 -> int64_t cents.** `COMP-1` (binary float) and
   `COMP-3` (packed decimal) monetary fields map to `int64_t` minor units in
   the modern equivalent. `PIC S9(12)V99 COMP-3` -> `int64_t` with value scaled
   by 100. Never map to `double`.
2. **COBOL PERFORM VARYING -> closed-form or `std::algorithm`.** Derive the
   algebraic closed form first. See `backend/legacy_credit_engine.cpp` for the
   reference pattern.
3. **C `strcpy`/`strcat` -> bounds-checked replacements.** Every `strcpy` is
   OVERFLOW-001 class. Replacement: `strlcpy` (BSD/macOS) or `strncpy` +
   explicit NUL-termination + length check before the copy.
4. **Java `double` monetary field -> `AtomicLong` cents.** Concurrent financial
   fields must be `AtomicLong` in cents with `compareAndSet` for optimistic
   locking, not `double` with raw arithmetic.
5. **Python `float` ledger sums -> `decimal.Decimal` with `ROUND_HALF_UP`.**
   Replace `sum(float_list)` with `sum(Decimal(str(x)) for x in payouts)`.
   Add a reconciliation invariant: `assert abs(total_paid + remaining - start) <= Decimal('0.01')`.
6. **SQL `CONCAT` dynamic queries -> stored procedures with bound parameters.**
   MySQL: use `IN` parameters bound via `PREPARE` placeholders `?`, not
   `CONCAT`. PostgreSQL: use `EXECUTE ... USING $1, $2`. Never interpolate
   user-supplied strings into query text.

---

## 7. Demo Run Contract

The demo run is the scoring event. It must execute cleanly from start to finish
with no human intervention. The sequence is:

```
./backend/run_demo.sh
```

Or, using MCP tools in the Mainframe & Ledger Auditor mode:

1. `run_full_demo_pipeline` — builds all legacy components, starts modern API
2. `run_legacy_engine_audit` — runs `verify_legacy_engine.sh`, returns defect report
3. `run_java_bond_race_test` — concurrent settlement race, returns balance delta
4. `run_c_wire_overflow_audit` — static + dynamic overflow analysis of `legacy_public_clearing.c`
5. `run_sql_injection_audit` — analyzes `legacy_audit_procedure.sql` for SQLINJ-001
6. `run_python_pension_drift_test` — float vs. Decimal reconciliation, returns delta
7. `run_cobol_analysis` — grep-based COBOL defect characterization
8. `run_schema_validation` — validates `backend/schema.sql` against modern invariants
9. POST to modern API, confirm REJECTED + SETTLED + idempotency
10. Display before/after narrative: legacy failure -> modern hard-stop

The demo is COMPLETE when all 10 steps execute, produce expected characterization
output, and the modern API passes all integration tests in `backend/test_api.py`.

---

## 8. Defect harness assertions contract

Each defect must have at least one assertion in the test suite that:

- **PASSES against broken code** (expects the bad behavior — proving the defect exists)
- **WOULD FAIL if the defect were fixed** (so remediation is verifiable, not cosmetic)

The current test harnesses encoding this contract are:

| Defect | Harness file | Assertion |
|---|---|---|
| FP-001 | `backend/test_legacy_engine.cpp` `test_fp_precision()` | `drift_detected == true` (expects drift) |
| SOL-002 | `backend/test_legacy_engine.cpp` `test_solvency_no_hard_stop()` | `result == true` (expects no hard stop) |
| LAT-003 | `backend/test_legacy_engine.cpp` `test_latency_expectation()` | Harness removes sleep; live binary timing checked via MCP |
| LOG-005 | `backend/test_legacy_engine.cpp` `test_fee_not_applied()` | `debt_increase == amount` (expects fee not applied) |
| SYN-004 | `backend/test_legacy_engine.cpp` `test_syntax_defect_in_source()` | grep finds missing semicolon line |
| RACE-001 | `hooks/mcp_java_bond_audit_server.js` `run_java_bond_race_test` | `actual_balance < expected_balance` (expects lost updates) |
| OVERFLOW-001 | `hooks/mcp_c_wire_audit_server.js` `run_c_wire_overflow_audit` | `strcpy_without_bounds_check == true` |
| SQLINJ-001 | `hooks/mcp_sql_injection_audit_server.js` `run_sql_injection_audit` | `injection_vectors_found > 0` |
| FP-DRIFT-001 | `hooks/mcp_python_pension_audit_server.js` `run_python_pension_drift_test` | `delta_cents > 0` (expects drift) |
| TRUNC-001 | `hooks/mcp_cobol_audit_server.js` `run_cobol_analysis` | grep finds COMP-1 monetary fields |
| AUDIT-002 | `hooks/mcp_sql_injection_audit_server.js` `run_sql_injection_audit` | `audit_log_writes_found == 0` |

---

## 9. Guardrails — anti-patterns subagents must not use

- Do not delete, skip, or weaken a test assertion to make it pass.
- Do not fix source code during the current harness-only pass.
- Do not catch and silently swallow exceptions introduced by future fixes.
- Do not loosen floating-point comparison tolerances instead of removing `double`.
- Do not increase timing budgets instead of removing blocking calls.
- Do not edit any generated report file by hand.
- Do not write literal credentials into any committed file.
- Do not invoke `hooks/mcp_ibmi_server.js` — it is a stub.
- Do not enable Watson NLU, Discovery, or IBM Z connectors without replacing
  all `<YOUR_*>` placeholders in `.bob/mcp.json`.
- When parallel subagents run, each owns exactly one defect ID's blast radius
  to avoid merge conflicts. SYN-004 must land first for C++ build-verified work.

---

## 10. External connector status (honest accounting)

| Connector | Status | Notes |
|---|---|---|
| Watson NLU (`_call_watson_nlu_classify`, `_call_watson_nlu_entities_summary`) | Implemented, NOT live | Needs real NLU instance URL + API key. Disabled in `.bob/mcp.json`. |
| Watson Discovery (`_call_watson_discovery_ask`) | Implemented, NOT live | Needs instance URL, API key, project ID, populated collection. Disabled. |
| IBM Z CMOD/CM8 REST (`/cmod-rest/v1/...`) | Implemented + mocked tests (29 passing), NOT live | IBM-documented API paths. No real CMOD server confirmed. Disabled. |
| IBM Z z/OSMF dataset browse | Implemented + mocked tests, NOT live | IBM-documented API shape. No live z/OSMF confirmed. Disabled. |
| IBM i DB2 BLOB storage | Config stub ONLY | No read/write code. Do not invoke. |
| IBM i CMOD via IBM i | Config stub ONLY | Separate from IBM Z CMOD. No code. Do not invoke. |

---

## 11. Definition of done

### Harness pass (current)

A defect harness is DONE when:
1. An MCP tool or test file contains at least one assertion that passes against
   the broken code and documents what it expects.
2. The tool/test has been invoked and its output confirms expected behavior.
3. No source files under `backend/` were modified.

### Fix pass (future — not yet authorized)

A defect fix is DONE when, after a fresh verification run:
1. Source file compiles with zero errors and zero new warnings.
2. All defect assertions have been updated from "expect bad" to "expect good"
   and produce `[PASS]`.
3. For LAT-003: a direct timing assertion exists against the real compiled binary.
4. All new/modified code passes the security checklist in Section 4.
5. A conventional commit is generated, branch pushed, PR opened per Section 5.
6. No other defect's status regressed.

The repo is fully remediated when all defects meet the fix-pass criteria above.
