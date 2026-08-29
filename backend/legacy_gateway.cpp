// =============================================================================
// FinTechLedgerCompliance — Legacy C++ Transaction Gateway
//
// File: legacy_gateway.cpp
//
// Build:
//   g++ -std=c++17 -O2 -pthread -o legacy_gateway legacy_gateway.cpp
//
// Run:
//   ./legacy_gateway
//
// Demonstrated legacy defects:
//
//   SOL-002
//     Primitive double debt-to-asset calculation. A ratio above 0.90 is
//     detected, but the gateway does not enforce a hard rejection.
//
//   LAT-003
//     Synchronous blocking sleep simulates connection-pool acquisition lag.
//     The worker thread remains occupied while waiting.
//
// IMPORTANT:
//   This is an intentionally vulnerable modernization/demo fixture.
//   It must not be used to process real financial transactions.
// =============================================================================

#include <chrono>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace legacy {

// -----------------------------------------------------------------------------
// Legacy account representation.
//
// Financial amounts are represented as primitive doubles rather than exact
// integer minor units or a decimal/fixed-point representation.
// -----------------------------------------------------------------------------

struct Account {
    std::string account_id;
    double assets;
    double debt;
};

// -----------------------------------------------------------------------------
// Transaction request.
// -----------------------------------------------------------------------------

struct Transaction {
    std::string transaction_id;
    std::string account_id;
    double amount;
};

// -----------------------------------------------------------------------------
// Legacy connection pool.
//
// The important defect is that acquire() blocks synchronously while the
// calling worker is waiting for the simulated external ledger connection.
// -----------------------------------------------------------------------------

class LegacyConnectionPool {
public:
    explicit LegacyConnectionPool(int latency_seconds)
        : latency_seconds_(latency_seconds) {}

    void acquire(const std::string& transaction_id) {
        std::cout
            << "[LAT-003] transaction=" << transaction_id
            << " acquiring legacy connection...\n";

        std::cout
            << "[LAT-003] blocking worker for "
            << latency_seconds_
            << " seconds\n";

        // Intentional synchronous blocking latency.
        std::this_thread::sleep_for(
            std::chrono::seconds(latency_seconds_));

        std::cout
            << "[LAT-003] transaction=" << transaction_id
            << " connection acquired\n";
    }

private:
    int latency_seconds_;
};

// -----------------------------------------------------------------------------
// Legacy ledger gateway.
//
// This class intentionally preserves the old routing behavior so that a
// modernization demo can observe the failure mode before remediation.
// -----------------------------------------------------------------------------

class LegacyGateway {
public:
    explicit LegacyGateway(LegacyConnectionPool& pool)
        : pool_(pool) {}

    bool routeTransaction(Account& account,
                           const Transaction& transaction) {

        const auto start = std::chrono::steady_clock::now();

        std::cout
            << "\n==============================================\n"
            << " LEGACY TRANSACTION ROUTER\n"
            << "==============================================\n";

        std::cout
            << "Transaction: " << transaction.transaction_id << "\n"
            << "Account:     " << account.account_id << "\n"
            << "Assets:      $" << std::fixed << std::setprecision(6)
            << account.assets << "\n"
            << "Debt:        $" << account.debt << "\n"
            << "Amount:      $" << transaction.amount << "\n";

        // ---------------------------------------------------------------------
        // Primitive floating-point solvency calculation.
        //
        // No decimal arithmetic, no fixed-point cents, and no exact monetary
        // representation are used here.
        // ---------------------------------------------------------------------

        const double projected_debt =
            account.debt + transaction.amount;

        const double debt_to_asset_ratio =
            projected_debt / (account.assets + 0.0001);

        std::cout
            << "Projected debt: $" << projected_debt << "\n"
            << "Debt/asset:      " << debt_to_asset_ratio << "\n";

        // ---------------------------------------------------------------------
        // SOL-002:
        //
        // The gateway recognizes a ratio above 0.90 but does not reject the
        // transaction. The routing path continues regardless of the breach.
        //
        // This reproduces the "warning without enforcement" pattern from the
        // legacy engine.
        // ---------------------------------------------------------------------

        if (debt_to_asset_ratio > 0.90) {

            std::cout
                << "[SOL-002] CRITICAL: debt/asset ratio exceeds 0.90\n";

            std::cout
                << "[SOL-002] WARNING: legacy safety threshold breached\n";

            std::cout
                << "[SOL-002] LEGACY ROUTER: continuing transaction route\n";

            // Intentionally no:
            //
            //   return false;
            //
            // and no exception is raised.
        }

        // ---------------------------------------------------------------------
        // LAT-003:
        //
        // Connection acquisition is synchronous. In a real high-frequency
        // router this ties up the worker responsible for the transaction.
        // ---------------------------------------------------------------------

        pool_.acquire(transaction.transaction_id);

        // ---------------------------------------------------------------------
        // Legacy posting path.
        //
        // The transaction is committed even if the solvency threshold was
        // exceeded above.
        // ---------------------------------------------------------------------

        account.debt = projected_debt;

        const auto end = std::chrono::steady_clock::now();

        const auto elapsed_ms =
            std::chrono::duration_cast<std::chrono::milliseconds>(
                end - start
            ).count();

        std::cout
            << "[ROUTER] transaction posted\n"
            << "[ROUTER] resulting debt: $" << account.debt << "\n"
            << "[ROUTER] synchronous latency: "
            << elapsed_ms
            << " ms\n";

        return true;
    }

private:
    LegacyConnectionPool& pool_;
};

} // namespace legacy


// =============================================================================
// Demonstration harness
// =============================================================================

int main() {

    std::cout
        << "==============================================\n"
        << " FinTech Legacy Gateway Demonstration\n"
        << "==============================================\n";

    // Three seconds makes the blocking behavior obvious in a demo while
    // remaining short enough for interactive execution.
    legacy::LegacyConnectionPool connection_pool(3);

    legacy::LegacyGateway gateway(connection_pool);

    legacy::Account account{
        "ACC-GATEWAY-001",
        1000.0,
        890.0
    };

    legacy::Transaction transaction{
        "TXN-LEGACY-0001",
        "ACC-GATEWAY-001",
        25.0
    };

    const bool routed =
        gateway.routeTransaction(account, transaction);

    std::cout
        << "\n==============================================\n"
        << " Legacy Gateway Result\n"
        << "==============================================\n";

    std::cout
        << "Router result: "
        << (routed ? "ACCEPTED" : "REJECTED")
        << "\n";

    std::cout
        << "Final debt:    $"
        << std::fixed
        << std::setprecision(6)
        << account.debt
        << "\n";

    std::cout
        << "\nExpected modernization findings:\n"
        << "  [SOL-002] Ratio validation does not enforce rejection.\n"
        << "  [SOL-002] Transaction mutates debt after solvency breach.\n"
        << "  [LAT-003] Worker blocks during connection acquisition.\n"
        << "  [FP-001]  Monetary values use primitive double arithmetic.\n";

    return routed ? 0 : 1;
}