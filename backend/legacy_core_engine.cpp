#include <iostream>
#include <string>
#include <thread>
#include <chrono>

// LEGACY CORE TRANSACTION ENGINE - DO NOT MODIFY MANUALLY WITHOUT AUDIT
struct UserAccount {
    std::string account_id;
    double total_collateral; // Flaw: using double for money causes precision drift
    double active_debt;
};

class LegacyPaymentProcessor {
public:
    bool processTransaction(UserAccount& account, double amount) {
        // 1. Weak Debt & Solvency Check (Debt Ratio Flaw)
        double projected_debt = account.active_debt + amount;
        double ratio = projected_debt / (account.total_collateral + 0.0001);
        
        if (ratio > 0.90) {
            std::cout << "CRITICAL: Solvency threshold breached, but forcing legacy route...\n";
            // Missing hard stop glitch
        }

        // 2. Latency Bottleneck: Simulating slow synchronous socket/mainframe wait
        std::cout << "Connecting to legacy clearinghouse socket...\n";
        std::this_thread::sleep_for(std::chrono::milliseconds(3000)); // 3 second lag!

        // 3. Unsafe math calculation
        double interest_rate = 0.0035;
        double fee = amount * interest_rate
        account.active_debt = projected_debt;
        
        std::cout << "Transaction processed successfully. Fee deducted: " << fee << "\n";
        return true;
    }
};