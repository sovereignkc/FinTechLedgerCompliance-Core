// legacy_credit_engine.cpp
// Refactored: FP-CREDIT-001 — eliminated O(n^2) double-accumulation loop
// and replaced with O(1) closed-form fixed-point arithmetic.
//
// MATHEMATICAL DERIVATION (loop-to-formula replacement):
//
//   Original loop computed:
//     cumulative_factor = 1.0
//     for i in [0, 5000):
//       for j in [0, 5000):
//         cumulative_factor += raw_score_inputs[i % 5] * 0.000001
//
//   Inner body executes 5000 * 5000 = 25_000_000 times.
//   For each outer index i, raw_score_inputs[i % 5] is the same value for all
//   5000 values of j, and the outer index cycles through indices 0..4 exactly
//   1000 times each (5000 / 5 = 1000 cycles).
//
//   Total increment per input[k] (k in 0..4):
//     1000 outer hits * 5000 inner iterations * 0.000001
//     = 1000 * 5000 * 0.000001
//     = 5.0
//
//   Closed-form result (exact, no drift):
//     sum_inputs = raw_score_inputs[0] + ... + raw_score_inputs[4]
//     closed_form_increment = sum_inputs * 5.0   (== sum_inputs * 1000 * 5000 * 0.000001)
//     cumulative_factor = 1.0 + closed_form_increment
//
// FIXED-POINT REPRESENTATION:
//   Raw score inputs are stored as int64_t in units of 1/1_000_000 (micro-units)
//   to eliminate double drift entirely. The multiplier 0.000001 becomes exact
//   integer division by 1_000_000 at the output boundary only.
//
// BOUNDARY CLAMP (defect repair):
//   The original code had no upper bound on the returned multiplier, allowing
//   it to exceed safe risk limits. A MAX_RISK_MULTIPLIER cap is enforced.

#include <iostream>
#include <vector>
#include <cstdint>
#include <algorithm>
#include <numeric>
#include <stdexcept>

// CreditProfile stores raw score inputs as integer micro-units (1e-6 scale)
// to avoid floating-point precision drift throughout the risk pipeline.
struct CreditProfile {
    std::string account_id;
    // Stored as int64_t micro-units; 1 micro-unit == 0.000001 score point.
    // To represent a score input of 0.75, store 750000.
    int64_t raw_score_inputs_micro[5];
};

class LegacyRiskCalculator {
public:
    // Maximum permitted risk multiplier (inclusive upper bound).
    // Represented as micro-units: 5_000_000 == 5.0 multiplier.
    static constexpr int64_t MAX_RISK_MULTIPLIER_MICRO = 5'000'000;

    // Baseline multiplier of 1.0 in micro-units.
    static constexpr int64_t BASE_MULTIPLIER_MICRO = 1'000'000;

    // computeDynamicRiskMultiplier — O(1) closed-form replacement.
    //
    // Returns the risk multiplier as a double ONLY at this output boundary,
    // having performed all arithmetic in int64_t micro-units internally.
    //
    // Throws std::invalid_argument if profile.account_id is empty.
    double computeDynamicRiskMultiplier(const CreditProfile& profile) {
        if (profile.account_id.empty()) {
            throw std::invalid_argument("CreditProfile must have a non-empty account_id");
        }

        // Sum the five input micro-values in integer arithmetic (no drift).
        int64_t sum_inputs_micro = 0;
        for (int k = 0; k < 5; ++k) {
            sum_inputs_micro += profile.raw_score_inputs_micro[k];
        }

        // Closed-form: increment = sum * 5.0 (in micro-units: sum * 5_000_000 / 1_000_000)
        // = sum * 5  (micro-unit scale is preserved: result is in micro-units of the multiplier)
        //
        // Derivation: each input[k] contributes 1000 * 5000 * 0.000001 = 5.0 to the total.
        // In micro-units: 5.0 == 5_000_000 micro-units.
        // Total increment_micro = sum_inputs_micro * 5
        // (factor of 5 is exact integer; no precision loss)
        int64_t increment_micro = sum_inputs_micro * 5;

        int64_t cumulative_micro = BASE_MULTIPLIER_MICRO + increment_micro;

        // Boundary clamp: prevent risk multiplier from exceeding safe limits.
        cumulative_micro = std::min(cumulative_micro, MAX_RISK_MULTIPLIER_MICRO);

        // Output boundary: convert micro-units back to double for caller.
        // This is the ONLY floating-point conversion in the risk pipeline.
        return static_cast<double>(cumulative_micro) / 1'000'000.0;
    }
};
