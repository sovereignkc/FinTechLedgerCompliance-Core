# FinTechLedgerCompliance: Modernization Architecture

## SDLC demonstration

Agent Bob should treat the repository as a modernization project:

1. Discover legacy assets
2. Analyze defects
3. Produce a remediation plan
4. Implement modernization
5. Generate regression tests
6. Build legacy and modern components
7. Execute tests
8. Compare legacy and modern behavior
9. Deploy the modern API
10. Verify operational behavior

## Components

### legacy_core.cbl

Intentional COBOL-era defects:

- COMP-1 floating-point monetary arithmetic
- C$SLEEP synchronous blocking latency
- solvency breach logged without a hard stop

### legacy_gateway.cpp

Intentional C++ legacy defects:

- primitive double debt/asset calculation
- >90% threshold detected but transaction continues
- synchronous connection-pool sleep

### ledger_api.cpp

Modern authoritative settlement boundary:

- C++ REST API
- bearer authentication for the demo
- idempotency keys
- strict request validation
- exact integer-cent financial representation
- cross-multiplication for solvency comparison
- SQLite WAL mode
- atomic settlement transaction
- parameterized SQL
- audit events
- legacy compatibility invocation and latency capture

## Important trust boundary

The legacy COBOL/C++ components are invoked for compatibility testing and observability.

They are NOT trusted to make the final settlement decision.

The modern service computes:

    projected_debt_cents / assets_cents > 90 / 100

without floating-point arithmetic.

The rejection is written to the transaction/audit tables without changing
the account debt.

A successful transaction updates the account and transaction record inside
one SQLite transaction.

## Demo narrative

Legacy:

    request
      -> floating point
      -> warning
      -> blocking legacy dependency
      -> transaction continues

Modern:

    request
      -> authentication
      -> schema validation
      -> integer-cent arithmetic
      -> exact solvency invariant
      -> hard rejection OR atomic settlement
      -> audit event

This creates a concrete before/after modernization demonstration rather than
an API-only code-generation demo.
