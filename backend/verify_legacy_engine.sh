#!/usr/bin/env bash
# =============================================================================
# FinTechLedgerCompliance — Legacy Core Engine Static Audit Script
# skills/verify/verify_legacy_engine.sh
#
# Checks legacy_core_engine.cpp for:
#   1. Floating-point money types  (double / float instead of fixed-point / int64)
#   2. Missing solvency hard-stop  (ratio > threshold without return/throw)
#   3. Synchronous sleep latency   (sleep_for / sleep / usleep / nanosleep)
#   4. Syntax error — missing semicolons on expression statements
#   5. Fee calculated but never applied to account state
#   6. Attempt to compile and report errors
# =============================================================================

TARGET="${1:-legacy_core_engine.cpp}"
PASS=0
FAIL=0

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GRN}[PASS]${NC} $1"; ((PASS++)); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; ((FAIL++)); }
warn() { echo -e "${YLW}[WARN]${NC} $1"; }

echo "======================================================"
echo " FinTech Legacy Engine Audit: $TARGET"
echo "======================================================"

# ── 1. Floating-point money fields ──────────────────────────────────────────
if grep -Eq '\bdouble\b.*(collateral|debt|amount|balance|fee|rate)' "$TARGET"; then
    fail "FP-001 · double used for monetary fields — precision drift risk (IEEE 754)"
    grep -En '\bdouble\b.*(collateral|debt|amount|balance|fee|rate)' "$TARGET" | \
        sed "s/^/        Line /"
else
    pass "FP-001 · No double monetary fields detected"
fi

# ── 2. Solvency check missing hard stop ─────────────────────────────────────
# Strategy: find the line number of the ratio > 0.9 check, then look for
# return/throw/exit INSIDE the following if-block (before the closing brace).
if grep -q 'ratio > 0' "$TARGET"; then
    # Extract the if-block lines after the ratio check
    BLOCK=$(awk '/ratio > 0\.9/{found=1; next} found{print; if(/}/) exit}' "$TARGET")
    if echo "$BLOCK" | grep -qE '\breturn\b|\bthrow\b|\bexit\b'; then
        pass "SOL-002 · Solvency breach path contains a hard-stop"
    else
        fail "SOL-002 · Solvency threshold breached but if-block has no return/throw/exit (execution falls through)"
        echo "$BLOCK" | head -5 | sed "s/^/        /"
    fi
else
    warn "SOL-002 · No solvency ratio check found — skipping"
fi

# ── 3. Synchronous blocking sleep ───────────────────────────────────────────
if grep -Eq 'sleep_for|std::this_thread::sleep|usleep|nanosleep|::sleep\(' "$TARGET"; then
    fail "LAT-003 · Synchronous thread sleep in transaction hot-path — latency bottleneck"
    grep -En 'sleep_for|std::this_thread::sleep|usleep|nanosleep|::sleep\(' "$TARGET" | \
        sed "s/^/        Line /"
else
    pass "LAT-003 · No blocking sleep calls found"
fi

# ── 4. Missing semicolon (simple heuristic) ─────────────────────────────────
# Look for lines that end with an identifier/value but have no semicolon.
# Uses BSD-compatible grep (no -P).
BAD_LINES=$(grep -En '[a-zA-Z0-9_][[:space:]]*$' "$TARGET" | grep -v '//' | grep -v '{' | grep -v '}')
if [ -n "$BAD_LINES" ]; then
    fail "SYN-004 · Possible missing semicolon on expression line(s)"
    echo "$BAD_LINES" | sed "s/^/        Line /"
else
    pass "SYN-004 · No obvious missing-semicolon lines detected by static grep"
fi

# ── 5. Fee never applied to account ─────────────────────────────────────────
if grep -q '\bfee\b' "$TARGET"; then
    if ! grep -q 'account.*fee\|fee.*account\|active_debt.*fee\|fee.*active_debt' "$TARGET"; then
        fail "LOG-005 · 'fee' computed but never applied to account.active_debt or any account field"
    else
        pass "LOG-005 · Fee appears to be applied to an account field"
    fi
else
    warn "LOG-005 · No fee variable found — skipping"
fi

# ── 6. Attempt compilation (requires g++ or clang++) ────────────────────────
echo ""
echo "── Compilation check ──────────────────────────────────"
if command -v g++ &>/dev/null || command -v clang++ &>/dev/null; then
    CXX=$(command -v g++ || command -v clang++)
    COMPILE_ERR=$("$CXX" -std=c++17 -fsyntax-only "$TARGET" 2>&1)
    if [ $? -eq 0 ]; then
        pass "COMP-006 · File compiles cleanly (syntax-only check)"
    else
        fail "COMP-006 · Compilation errors detected:"
        echo "$COMPILE_ERR" | sed "s/^/        /"
    fi
else
    warn "COMP-006 · No C++ compiler found — skipping compilation check"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "======================================================"
echo " Results: ${PASS} passed  |  ${FAIL} failed"
echo "======================================================"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
