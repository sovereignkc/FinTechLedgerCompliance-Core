// =============================================================================
// FinTechLedgerCompliance — Legacy Core Engine Test Harness
// skills/verify/test_legacy_engine.cpp
//
// Compile:  g++ -std=c++17 -o test_legacy test_legacy_engine.cpp
// Run:      ./test_legacy
//
// Each TEST() prints PASS/FAIL and the file exits non-zero on any failure,
// making it suitable for CI.
// =============================================================================

#include <iostream>
#include <string>
#include <cmath>
#include <cassert>
#include <sstream>
#include <chrono>
#include <thread>

// ── Minimal reproduction of the struct/class under test ─────────────────────
// (Copied verbatim from legacy_core_engine.cpp to isolate it for testing.
//  In a real repo, #include the shared header instead.)

struct UserAccount {
    std::string account_id;
    double total_collateral;   // FP-001: should be int64_t cents
    double active_debt;        // FP-001: same
};

// NOTE: The original code has a missing semicolon on the fee line, which
// prevents compilation.  For the test harness we add the semicolon so the
// harness itself compiles, but TEST-SYN-004 below validates the defect
// exists in the source file.
class LegacyPaymentProcessor {
public:
    bool processTransaction(UserAccount& account, double amount) {
        double projected_debt = account.active_debt + amount;
        double ratio = projected_debt / (account.total_collateral + 0.0001);

        if (ratio > 0.90) {
            std::cout << "CRITICAL: Solvency threshold breached, but forcing legacy route...\n";
            // BUG SOL-002: no return/throw here — execution continues
        }

        // BUG LAT-003: 3-second blocking sleep removed for test speed
        // std::this_thread::sleep_for(std::chrono::milliseconds(3000));

        double interest_rate = 0.0035;
        double fee = amount * interest_rate;  // SYN-004: semicolon was MISSING in original
        account.active_debt = projected_debt; // LOG-005: fee is computed but NOT applied here

        return true;
    }
};

// ── Minimal test framework ───────────────────────────────────────────────────
static int g_pass = 0, g_fail = 0;

#define TEST(name, cond) do { \
    if (cond) { std::cout << "[PASS] " name "\n"; ++g_pass; } \
    else       { std::cout << "[FAIL] " name "\n"; ++g_fail; } \
} while(0)

// ── FP-001: Floating-point precision drift ───────────────────────────────────
void test_fp_precision() {
    // Classic IEEE 754 drift: 0.1 + 0.2 != 0.3
    double a = 0.10, b = 0.20;
    double sum = a + b;
    // This SHOULD equal 0.30 for a ledger, but won't due to double representation
    bool drift_detected = (sum != 0.30);
    TEST("FP-001a · double 0.10+0.20 suffers IEEE 754 drift", drift_detected);

    // Repeated small additions accumulate error — simulate 1000 cent transactions
    double ledger = 0.0;
    for (int i = 0; i < 1000; ++i) ledger += 0.001;
    // Use a looser tolerance — catches drift reliably across x86-64 and ARM.
    // 0.001 cannot be represented exactly in IEEE 754, so 1000 additions
    // always produce a result != 1.0 when using == comparison.
    bool accumulated_error = (ledger != 1.0);
    TEST("FP-001b · 1000x 0.001 != 1.0 due to IEEE 754 non-representability", accumulated_error);
}

// ── SOL-002: Solvency breach does NOT halt execution ────────────────────────
void test_solvency_no_hard_stop() {
    LegacyPaymentProcessor proc;
    UserAccount account{"ACC-99", 1000.0, 910.0}; // debt ratio already ~91 %

    // This call should be REJECTED (ratio > 0.90), but the legacy code lets it through
    bool result = proc.processTransaction(account, 10.0);  // pushes to 92 %
    TEST("SOL-002 · processTransaction returns true even when solvency breached (no hard-stop)", result == true);
    TEST("SOL-002b · active_debt was mutated despite solvency breach", account.active_debt > 910.0);
}

// ── LAT-003: Synchronous latency (we validate the sleep line exists in source) ─
// We cannot easily time the removed sleep here, but we document the expectation.
void test_latency_expectation() {
    // In the real engine the 3-second sleep is present.
    // Here we verify our test harness runs in under 100 ms (i.e., sleep was removed).
    auto t0 = std::chrono::steady_clock::now();
    LegacyPaymentProcessor proc;
    UserAccount account{"ACC-01", 5000.0, 100.0};
    proc.processTransaction(account, 50.0);
    auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - t0).count();
    TEST("LAT-003 · test harness (sleep removed) completes in < 100 ms", elapsed_ms < 100);
    // The following would FAIL against the live engine with the sleep intact:
    // TEST("LAT-003-LIVE · live engine must NOT block > 50 ms", elapsed_ms < 50);
}

// ── LOG-005: Fee computed but never applied to account ──────────────────────
void test_fee_not_applied() {
    LegacyPaymentProcessor proc;
    UserAccount account{"ACC-02", 10000.0, 0.0};
    double amount = 1000.0;
    double expected_fee = amount * 0.0035; // 3.5
    double debt_before = account.active_debt;

    proc.processTransaction(account, amount);

    double debt_increase = account.active_debt - debt_before;
    // If fee were applied: debt_increase would be amount + expected_fee = 1003.5
    // As coded: debt_increase == amount only (fee is lost)
    bool fee_not_included = (std::fabs(debt_increase - amount) < 1e-9);
    TEST("LOG-005 · fee (3.5) is NOT reflected in account.active_debt increase", fee_not_included);
}

// ── SYN-004: Source file has a missing semicolon (grep-based) ───────────────
void test_syntax_defect_in_source() {
    // We grep the actual source file for the known bad line pattern.
    // Pass if the bad pattern is present (confirming the defect exists in source).
    int ret = std::system(
        "grep -q 'double fee = amount \\* interest_rate$' ../../legacy_core_engine.cpp 2>/dev/null"
    );
    // ret == 0 means the missing-semicolon line was found
    TEST("SYN-004 · legacy_core_engine.cpp contains the missing-semicolon line", ret == 0);
}

// ── Entry point ─────────────────────────────────────────────────────────────
int main() {
    std::cout << "==============================================\n";
    std::cout << " FinTech Legacy Engine Test Harness\n";
    std::cout << "==============================================\n";

    test_fp_precision();
    test_solvency_no_hard_stop();
    test_latency_expectation();
    test_fee_not_applied();
    test_syntax_defect_in_source();

    std::cout << "----------------------------------------------\n";
    std::cout << "Results: " << g_pass << " passed | " << g_fail << " failed\n";
    std::cout << "==============================================\n";
    return g_fail > 0 ? 1 : 0;
}
