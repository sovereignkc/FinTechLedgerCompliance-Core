# FinTech Ledger Compliance

An IBM Bob development hackathon showcase for modernizing a high-risk financial ledger across COBOL, C, C++, Java, Python, and SQL.

This repository is deliberately staged as a **legacy characterization and verification pass**. It contains realistic defect fixtures, Bob custom modes, MCP audit hooks, a modern reference API, and an end-to-end demo path. The current pass proves that the defects exist and builds the harnesses that will verify a future remediation pass; it does not silently fix the legacy sources.

## What this demonstrates

Bob can work across a heterogeneous financial codebase and keep a coherent modernization contract:

1. Discover every legacy asset and classify its risk.
2. Trace each risk to a named defect ID, source location, and observable failure signature.
3. Create characterization assertions that pass against the broken baseline and would fail after a real fix.
4. Orchestrate language-specific analysis through MCP tools.
5. Compare an unsafe legacy path with a modern settlement boundary.
6. Enforce exact-money, solvency, idempotency, parameterization, and audit-trail invariants.
7. Produce an evidence-backed narrative suitable for an engineering or compliance review.

The central trust-boundary idea is:

```text
Legacy COBOL / C / C++ / Java / Python / SQL
        |  inspect, compile, characterize, measure
        v
MCP verification hooks + Bob auditor mode
        |
        v
Modern C++ ledger API: authenticate -> validate -> exact solvency check
                          -> reject or atomically settle -> audit
```

## Repository structure

```text
FinTechLedgerCompliance/
├── Agents.md                         # Workspace rules and current-pass guardrails
├── README.md                         # Project orientation and operator workflow
├── demo.md                           # Hackathon story, run-of-show, and visual direction
├── .bob/
│   ├── custom_modes.yaml              # Mainframe auditor + modernization demo modes
│   └── mcp.json                       # MCP server registration and enable/disable state
├── backend/
│   ├── ARCHITECTURE.md               # Legacy-versus-modern trust boundary
│   ├── CMakeLists.txt                 # Build definition for the modern API
│   ├── ledger_api.cpp                 # Modern settlement API/reference implementation
│   ├── schema.sql                     # Modern SQLite WAL schema and audit structures
│   ├── run_demo.sh                    # Builds legacy components and starts the API
│   ├── verify_legacy_engine.sh        # C++ static/compile verification script
│   ├── test_legacy_engine.cpp         # C++ characterization harness
│   ├── test_legacy                   # Built legacy test binary (when present)
│   ├── test_api.py                    # Modern API integration tests
│   ├── legacy_core_engine.cpp         # C++ primary five-defect fixture
│   ├── legacy_gateway.cpp             # Standalone C++ gateway fixture
│   ├── legacy_credit_engine.cpp       # Fixed-point/O(1) reference pattern
│   ├── legacy_core.cbl                # COBOL core fixture
│   ├── legacy_public_treasuring.cbl  # COBOL treasury allocation fixture
│   ├── legacy_ext_treasuring.cbl     # Empty planned external treasury stub
│   ├── legacy_public_clearing.c       # C wire-transfer parser fixture
│   ├── legacy_bond_clearing.java      # Java concurrent clearing fixture
│   ├── legacy_pension_setup.py        # Python pension float-drift fixture
│   └── legacy_audit_procedure.sql     # SQL injection/missing-audit fixture
└── hooks/
    ├── mcp_demo_runner_server.js      # Full demo orchestration + schema validation
    ├── mcp_verifier_server.js         # Primary C++ legacy-engine audit
    ├── mcp_cobol_audit_server.js      # COBOL source/build analysis
    ├── mcp_c_wire_audit_server.js     # C overflow/injection analysis
    ├── mcp_java_bond_audit_server.js  # Java race/static audit
    ├── mcp_python_pension_audit_server.js # Python drift/reconciliation audit
    ├── mcp_sql_injection_audit_server.js  # SQL injection/audit-gap analysis
    ├── mcp_schema_validator_server.js # Modern schema/procedure conformance
    ├── mcp_ibmz_server.js             # IBM Z CMOD + z/OSMF connector (disabled)
    ├── mcp_watson_nlu_server.js       # Watson NLU connector (disabled)
    ├── mcp_watson_discovery_server.js # Watson Discovery connector (disabled)
    └── mcp_ibmi_server.js             # IBM i integration surface (stub; do not invoke)
```

## Defect coverage

| Area | Fixture | Characterized risks |
|---|---|---|
| C++ core | `backend/legacy_core_engine.cpp` | FP-001, SOL-002, LAT-003, LOG-005, SYN-004 |
| C++ gateway | `backend/legacy_gateway.cpp` | FP-001-GW, SOL-002-GW, LAT-003-GW |
| COBOL core | `backend/legacy_core.cbl` | FP-001-CBL, SOL-002-CBL, LAT-003-CBL |
| COBOL treasury | `backend/legacy_public_treasuring.cbl` | TRUNC-001, AUDIT-001-CBL |
| Java clearing | `backend/legacy_bond_clearing.java` | RACE-001, FP-001-JAVA, AUDIT-001-JAVA |
| C wire parser | `backend/legacy_public_clearing.c` | OVERFLOW-001, INJECT-001, NOCHECK-001 |
| Python pension | `backend/legacy_pension_setup.py` | FP-DRIFT-001, RECONCILE-001 |
| SQL procedure | `backend/legacy_audit_procedure.sql` | SQLINJ-001, AUDIT-002 |

The modern comparison path is `backend/ledger_api.cpp` plus `backend/schema.sql`: integer-cent money, cross-multiplied solvency checks, parameterized SQL, SQLite WAL, idempotency, atomic settlement, and audit events.

## Recommended workflow

### 1. Start with Bob’s context

Open the repository in IBM Bob with `.bob/custom_modes.yaml` and `.bob/mcp.json` available. Use **Mainframe & Ledger Auditor** for analysis and harness work. Use **Legacy Modernization Demo Runner** for the narrated demo run.

The active MCP servers are local and require no credentials. Watson NLU, Watson Discovery, and IBM Z are disabled until real environment credentials are supplied. IBM i is intentionally a stub and should not be invoked.

### 2. Discover and characterize

Read each defect tag block, then run the relevant MCP audit. Every finding should record the defect ID, language, source location, root cause, failure signature, and harness assertion that expects the broken behavior. Generated reports are evidence, not hand-edited status files. Sensitive values must never be placed in logs or reports.

### 3. Run the verification sequence

1. Build/check with `run_full_demo_pipeline` or `./backend/run_demo.sh`.
2. Run `run_legacy_engine_audit`.
3. Run `run_java_bond_race_test` and `run_java_bond_static_audit`.
4. Run `run_c_wire_overflow_audit` and `run_c_wire_static_analysis`.
5. Run `run_sql_injection_audit` and `run_schema_audit`.
6. Run `run_python_pension_drift_test` and `run_python_reconciliation_audit`.
7. Run `run_cobol_analysis` and, with GnuCOBOL installed, `run_cobol_build_check`.
8. Run `run_schema_validation` and `run_audit_procedure_analysis`.
9. Post a solvency-breaching settlement; confirm `REJECTED` and unchanged debt.
10. Post a valid settlement; confirm `SETTLED`, idempotency, and an audit event.
11. Replay the same idempotency key; confirm no duplicate settlement.

The MCP demo runner performs the non-blocking build/check portion. `backend/run_demo.sh` itself ends by `exec`-ing the API server, so it remains attached to the terminal by design.

### 4. Begin remediation only in a future pass

Update one defect at a time, preserve characterization evidence, change assertions from “bad behavior expected” to “good behavior expected,” and rerun the complete sequence. No source file under `backend/` should be modified during the current harness-only pass.

## Local prerequisites

Bash, Node.js, CMake, `g++`, SQLite support, Python 3, Java (`javac`/`java`), and GnuCOBOL (`cobc`) for the COBOL build and full shell demo.

```bash
./backend/run_demo.sh
```

The script builds the COBOL core, standalone C++ gateway, and modern API, then prints example requests before starting the API on `127.0.0.1:8080`.

### 5. Bob Financial Ledger Architecutre and System Diagram
[Excalidraw Bob Financial Ledger Architecutre and System Diagram](https://excalidraw.com/#json=nd3mIYmh8huyo7hoq0Asm,htP_JuUeGjnRg-59qU8fwA)
## Security and compliance rules

- Modern money paths use integer minor units; floating-point drift is a defect to expose, not a tolerance to hide.
- Modern database operations are parameterized; the legacy SQL procedure is intentionally analyzed as an injection fixture.
- Committed transactions require append-only cryptographic audit data: ISO-8601 UTC timestamp, UUID v4, minor-unit amount, masked account ID, and HMAC-SHA256 payload evidence.
- Credentials belong in environment variables or a gitignored local file, never in committed configuration, stdout, or audit output.

## Further reading

- [Architecture narrative](backend/ARCHITECTURE.md)
- [Workspace operating rules](Agents.md)
