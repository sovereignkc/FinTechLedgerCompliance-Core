// =============================================================================
// FinTechLedgerCompliance - Modern C++ REST Settlement API
//
// Demo architecture:
//   REST -> secure validation -> exact integer-cent financial math -> SQLite
//        -> legacy COBOL/C++ compatibility invocation -> audit trail
//
// Dependencies:
//   - C++17
//   - Crow (header-only)
//   - SQLite3
//
// Build example:
//   g++ -std=c++17 -O2 -pthread ledger_api.cpp -lsqlite3 -o ledger_api
//
// Start:
//   ./ledger_api
//
// The API intentionally keeps the legacy systems as compatibility components.
// The authoritative modern settlement path uses integer minor units and an
// atomic SQLite transaction. Legacy components are invoked for observability,
// not trusted with the final financial decision.
// =============================================================================

#include "crow_all.h"

#include <sqlite3.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;

static constexpr int64_t SOLVENCY_NUMERATOR = 90;
static constexpr int64_t SOLVENCY_DENOMINATOR = 100;
static constexpr int64_t MAX_TRANSACTION_CENTS = 10'000'000'00LL; // $10M
static constexpr const char* DB_PATH = "ledger.db";
static constexpr const char* API_TOKEN = "demo-token-ibm-bob";

struct LegacyResult {
    int exit_code;
    std::string output;
    long long elapsed_ms;
};

static std::string json_escape(const std::string& input) {
    std::string out;
    for (char c : input) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out += c;
        }
    }
    return out;
}

static std::string cents_to_money(int64_t cents) {
    std::ostringstream os;
    os << std::fixed << std::setprecision(2)
       << static_cast<double>(cents) / 100.0;
    return os.str();
}

static bool parse_money_to_cents(const std::string& text, int64_t& cents) {
    if (text.empty()) return false;

    std::size_t pos = 0;
    bool negative = false;
    if (text[pos] == '+' || text[pos] == '-') {
        negative = text[pos] == '-';
        ++pos;
    }
    if (pos == text.size()) return false;

    int64_t dollars = 0;
    bool saw_digit = false;

    while (pos < text.size() && std::isdigit(static_cast<unsigned char>(text[pos]))) {
        saw_digit = true;
        int digit = text[pos++] - '0';
        if (dollars > (INT64_MAX - digit) / 10) return false;
        dollars = dollars * 10 + digit;
    }

    int64_t cents_part = 0;
    int fractional_digits = 0;

    if (pos < text.size() && text[pos] == '.') {
        ++pos;
        while (pos < text.size() &&
               std::isdigit(static_cast<unsigned char>(text[pos]))) {
            if (fractional_digits >= 2) return false;
            cents_part = cents_part * 10 + (text[pos++] - '0');
            ++fractional_digits;
        }
    }

    if (!saw_digit || pos != text.size()) return false;
    if (fractional_digits == 1) cents_part *= 10;

    if (dollars > (INT64_MAX - cents_part) / 100) return false;

    int64_t result = dollars * 100 + cents_part;
    cents = negative ? -result : result;
    return true;
}

static std::string make_id(const char* prefix) {
    static std::atomic<unsigned long long> counter{0};
    auto now = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();

    std::ostringstream os;
    os << prefix << "-" << now << "-" << ++counter;
    return os.str();
}

// -----------------------------------------------------------------------------
// Process adapter.
// Uses exec-style argv rather than passing request strings through a shell.
// This keeps the demo from turning an API field into shell syntax.
// -----------------------------------------------------------------------------

static LegacyResult run_program(const std::string& executable,
                                const std::vector<std::string>& args) {
    auto start = std::chrono::steady_clock::now();

#if defined(_WIN32)
    (void)executable;
    (void)args;
    return {-1, "Legacy process adapter requires POSIX process APIs in this demo.", 0};
#else
    int pipefd[2];
    if (pipe(pipefd) != 0) {
        return {-1, "pipe() failed", 0};
    }

    pid_t pid = fork();
    if (pid < 0) {
        close(pipefd[0]);
        close(pipefd[1]);
        return {-1, "fork() failed", 0};
    }

    if (pid == 0) {
        dup2(pipefd[1], STDOUT_FILENO);
        dup2(pipefd[1], STDERR_FILENO);
        close(pipefd[0]);
        close(pipefd[1]);

        std::vector<char*> argv;
        argv.push_back(const_cast<char*>(executable.c_str()));
        std::vector<std::string> storage = args;
        for (auto& arg : storage)
            argv.push_back(const_cast<char*>(arg.c_str()));
        argv.push_back(nullptr);

        execv(executable.c_str(), argv.data());
        _exit(127);
    }

    close(pipefd[1]);

    std::string output;
    char buffer[4096];
    ssize_t n;
    while ((n = read(pipefd[0], buffer, sizeof(buffer))) > 0)
        output.append(buffer, static_cast<std::size_t>(n));
    close(pipefd[0]);

    int status = 0;
    waitpid(pid, &status, 0);

    int exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;

    auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - start).count();

    return {exit_code, output, elapsed};
#endif
}

class Database {
public:
    Database() {
        if (sqlite3_open(DB_PATH, &db_) != SQLITE_OK)
            throw std::runtime_error("Unable to open SQLite database");

        exec("PRAGMA journal_mode=WAL;");
        exec("PRAGMA foreign_keys=ON;");
        exec("PRAGMA busy_timeout=5000;");
        initialize();
    }

    ~Database() {
        if (db_) sqlite3_close(db_);
    }

    Database(const Database&) = delete;
    Database& operator=(const Database&) = delete;

    void initialize() {
        exec(R"SQL(
            CREATE TABLE IF NOT EXISTS accounts (
                account_id TEXT PRIMARY KEY,
                asset_cents INTEGER NOT NULL CHECK(asset_cents >= 0),
                debt_cents INTEGER NOT NULL CHECK(debt_cents >= 0),
                version INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS transactions (
                transaction_id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                idempotency_key TEXT NOT NULL UNIQUE,
                amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
                status TEXT NOT NULL,
                reason TEXT,
                legacy_core_latency_ms INTEGER,
                legacy_gateway_latency_ms INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(account_id) REFERENCES accounts(account_id)
            );

            CREATE TABLE IF NOT EXISTS audit_events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                details TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        )SQL");
    }

    void seed_demo_account() {
        std::lock_guard<std::mutex> lock(mu_);
        sqlite3_stmt* stmt = nullptr;

        const char* sql =
            "INSERT OR IGNORE INTO accounts(account_id, asset_cents, debt_cents) "
            "VALUES(?, ?, ?)";

        if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK)
            throw std::runtime_error("prepare seed failed");

        sqlite3_bind_text(stmt, 1, "ACC-DEMO-001", -1, SQLITE_STATIC);
        sqlite3_bind_int64(stmt, 2, 10000000); // $100,000
        sqlite3_bind_int64(stmt, 3, 8500000);  // $85,000

        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
    }

    struct AccountRow {
        int64_t assets;
        int64_t debt;
        int64_t version;
    };

    std::optional<AccountRow> get_account(const std::string& id) {
        std::lock_guard<std::mutex> lock(mu_);
        sqlite3_stmt* stmt = nullptr;

        const char* sql =
            "SELECT asset_cents, debt_cents, version "
            "FROM accounts WHERE account_id=?";

        if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK)
            throw std::runtime_error("prepare account lookup failed");

        sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);

        std::optional<AccountRow> result;
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            result = AccountRow{
                sqlite3_column_int64(stmt, 0),
                sqlite3_column_int64(stmt, 1),
                sqlite3_column_int64(stmt, 2)
            };
        }

        sqlite3_finalize(stmt);
        return result;
    }

    bool transaction_exists(const std::string& key, std::string& transaction_id,
                            std::string& status) {
        std::lock_guard<std::mutex> lock(mu_);
        sqlite3_stmt* stmt = nullptr;

        const char* sql =
            "SELECT transaction_id, status FROM transactions "
            "WHERE idempotency_key=?";

        if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK)
            throw std::runtime_error("prepare idempotency lookup failed");

        sqlite3_bind_text(stmt, 1, key.c_str(), -1, SQLITE_TRANSIENT);

        bool found = false;
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            found = true;
            transaction_id =
                reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0));
            status =
                reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1));
        }

        sqlite3_finalize(stmt);
        return found;
    }

    void record_rejection(const std::string& tx,
                           const std::string& account,
                           const std::string& idem,
                           int64_t amount,
                           const std::string& reason) {
        std::lock_guard<std::mutex> lock(mu_);
        exec("BEGIN IMMEDIATE;");

        sqlite3_stmt* stmt = nullptr;
        const char* sql =
            "INSERT INTO transactions "
            "(transaction_id, account_id, idempotency_key, amount_cents, status, reason) "
            "VALUES(?, ?, ?, ?, 'REJECTED', ?)";

        if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
            exec("ROLLBACK;");
            throw std::runtime_error("prepare rejection failed");
        }

        sqlite3_bind_text(stmt, 1, tx.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, account.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 3, idem.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 4, amount);
        sqlite3_bind_text(stmt, 5, reason.c_str(), -1, SQLITE_TRANSIENT);

        if (sqlite3_step(stmt) != SQLITE_DONE) {
            sqlite3_finalize(stmt);
            exec("ROLLBACK;");
            throw std::runtime_error("insert rejection failed");
        }
        sqlite3_finalize(stmt);

        insert_audit_locked(tx, "SOLVENCY_REJECTION", reason);
        exec("COMMIT;");
    }

    void settle(const std::string& tx,
                const std::string& account,
                const std::string& idem,
                int64_t amount,
                int64_t projected_debt,
                long long core_latency,
                long long gateway_latency) {
        std::lock_guard<std::mutex> lock(mu_);
        exec("BEGIN IMMEDIATE;");

        sqlite3_stmt* update = nullptr;
        const char* update_sql =
            "UPDATE accounts SET debt_cents=?, version=version+1, "
            "updated_at=CURRENT_TIMESTAMP WHERE account_id=?";

        if (sqlite3_prepare_v2(db_, update_sql, -1, &update, nullptr) != SQLITE_OK) {
            exec("ROLLBACK;");
            throw std::runtime_error("prepare settlement update failed");
        }

        sqlite3_bind_int64(update, 1, projected_debt);
        sqlite3_bind_text(update, 2, account.c_str(), -1, SQLITE_TRANSIENT);

        if (sqlite3_step(update) != SQLITE_DONE) {
            sqlite3_finalize(update);
            exec("ROLLBACK;");
            throw std::runtime_error("account update failed");
        }
        sqlite3_finalize(update);

        sqlite3_stmt* insert = nullptr;
        const char* insert_sql =
            "INSERT INTO transactions "
            "(transaction_id, account_id, idempotency_key, amount_cents, status, "
            "legacy_core_latency_ms, legacy_gateway_latency_ms) "
            "VALUES(?, ?, ?, ?, 'SETTLED', ?, ?)";

        if (sqlite3_prepare_v2(db_, insert_sql, -1, &insert, nullptr) != SQLITE_OK) {
            exec("ROLLBACK;");
            throw std::runtime_error("prepare transaction insert failed");
        }

        sqlite3_bind_text(insert, 1, tx.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(insert, 2, account.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(insert, 3, idem.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(insert, 4, amount);
        sqlite3_bind_int64(insert, 5, core_latency);
        sqlite3_bind_int64(insert, 6, gateway_latency);

        if (sqlite3_step(insert) != SQLITE_DONE) {
            sqlite3_finalize(insert);
            exec("ROLLBACK;");
            throw std::runtime_error("transaction insert failed");
        }
        sqlite3_finalize(insert);

        std::ostringstream details;
        details << "amount_cents=" << amount
                << ";projected_debt_cents=" << projected_debt
                << ";solvency_limit=90%;"
                << "legacy_core_latency_ms=" << core_latency
                << ";legacy_gateway_latency_ms=" << gateway_latency;

        insert_audit_locked(tx, "SETTLEMENT_ACCEPTED", details.str());

        exec("COMMIT;");
    }

private:
    sqlite3* db_ = nullptr;
    std::mutex mu_;

    void exec(const char* sql) {
        char* error = nullptr;
        if (sqlite3_exec(db_, sql, nullptr, nullptr, &error) != SQLITE_OK) {
            std::string message = error ? error : "SQLite error";
            sqlite3_free(error);
            throw std::runtime_error(message);
        }
    }

    void insert_audit_locked(const std::string& tx,
                             const std::string& event_type,
                             const std::string& details) {
        sqlite3_stmt* stmt = nullptr;

        const char* sql =
            "INSERT INTO audit_events(transaction_id, event_type, details) "
            "VALUES(?, ?, ?)";

        if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK)
            throw std::runtime_error("prepare audit failed");

        sqlite3_bind_text(stmt, 1, tx.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, event_type.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 3, details.c_str(), -1, SQLITE_TRANSIENT);

        if (sqlite3_step(stmt) != SQLITE_DONE) {
            sqlite3_finalize(stmt);
            throw std::runtime_error("audit insert failed");
        }

        sqlite3_finalize(stmt);
    }
};

static bool authorized(const crow::request& req) {
    auto header = req.get_header_value("Authorization");
    return header == std::string("Bearer ") + API_TOKEN;
}

static crow::response error_response(int code,
                                     const std::string& error,
                                     const std::string& request_id) {
    crow::json::wvalue body;
    body["status"] = "ERROR";
    body["error"] = error;
    body["request_id"] = request_id;

    crow::response response(code, body);
    response.set_header("Cache-Control", "no-store");
    return response;
}

int main() {
    try {
        Database database;
        database.seed_demo_account();

        crow::SimpleApp app;

        CROW_ROUTE(app, "/health").methods(crow::HTTPMethod::GET)
        ([] {
            crow::json::wvalue body;
            body["status"] = "UP";
            body["service"] = "modern-ledger-api";
            body["version"] = "1.0";
            return crow::response(200, body);
        });

        CROW_ROUTE(app, "/api/v1/ledger/settle").methods(crow::HTTPMethod::POST)
        ([&database](const crow::request& req) {
            const std::string request_id = make_id("REQ");

            if (!authorized(req))
                return error_response(401, "Unauthorized", request_id);

            auto idem = req.get_header_value("Idempotency-Key");
            if (idem.empty() || idem.size() > 128)
                return error_response(400, "Missing or invalid Idempotency-Key", request_id);

            std::string existing_tx;
            std::string existing_status;
            if (database.transaction_exists(idem, existing_tx, existing_status)) {
                crow::json::wvalue body;
                body["status"] = existing_status;
                body["transaction_id"] = existing_tx;
                body["request_id"] = request_id;
                body["idempotent_replay"] = true;
                return crow::response(200, body);
            }

            crow::json::rvalue payload;
            try {
                payload = crow::json::load(req.body);
            } catch (...) {
                return error_response(400, "Malformed JSON", request_id);
            }

            if (!payload || !payload.has("account_id") || !payload.has("amount"))
                return error_response(400, "account_id and amount are required", request_id);

            std::string account_id = payload["account_id"].s();
            std::string amount_text = payload["amount"].s();

            if (account_id.empty() || account_id.size() > 64)
                return error_response(400, "Invalid account_id", request_id);

            int64_t amount_cents = 0;
            if (!parse_money_to_cents(amount_text, amount_cents) ||
                amount_cents <= 0 ||
                amount_cents > MAX_TRANSACTION_CENTS) {
                return error_response(
                    400,
                    "Amount must be a positive decimal monetary value <= $10,000,000.00",
                    request_id);
            }

            auto account = database.get_account(account_id);
            if (!account)
                return error_response(404, "Account not found", request_id);

            // Exact financial comparison:
            //
            // projected_debt / assets > 90 / 100
            //
            // Cross multiplication avoids floating point entirely.
            if (account->debt > INT64_MAX - amount_cents)
                return error_response(400, "Projected debt overflow", request_id);

            const int64_t projected_debt =
                account->debt + amount_cents;

            // The operands are bounded by the demo account/transaction limits,
            // so multiplication is safe for the intended demo domain.
            const bool solvency_breach =
                projected_debt * SOLVENCY_DENOMINATOR >
                account->assets * SOLVENCY_NUMERATOR;

            const std::string transaction_id = make_id("TXN");

            // Call the legacy COBOL core and C++ gateway for compatibility
            // observability. Their unsafe decisions are NOT authoritative.
            //
            // These executables are expected beside the API:
            //   ./legacy_core
            //   ./legacy_gateway
            //
            // The current legacy fixtures are intentionally slow and/or fixed
            // demo workloads, so this path is explicitly labeled legacy.
            LegacyResult cobol =
                run_program("./legacy_core", {});

            LegacyResult gateway =
                run_program("./legacy_gateway", {});

            if (solvency_breach) {
                const std::string reason =
                    "Solvency threshold violation: projected debt exceeds 90% "
                    "of collateral/assets";

                database.record_rejection(
                    transaction_id,
                    account_id,
                    idem,
                    amount_cents,
                    reason);

                crow::json::wvalue body;
                body["status"] = "REJECTED";
                body["transaction_id"] = transaction_id;
                body["request_id"] = request_id;
                body["reason"] = reason;
                body["projected_debt"] = cents_to_money(projected_debt);
                body["assets"] = cents_to_money(account->assets);
                body["solvency_limit"] = "0.90";
                body["legacy_core_exit_code"] = cobol.exit_code;
                body["legacy_core_latency_ms"] = cobol.elapsed_ms;
                body["legacy_gateway_exit_code"] = gateway.exit_code;
                body["legacy_gateway_latency_ms"] = gateway.elapsed_ms;
                body["database_mutated"] = false;

                return crow::response(400, body);
            }

            database.settle(
                transaction_id,
                account_id,
                idem,
                amount_cents,
                projected_debt,
                cobol.elapsed_ms,
                gateway.elapsed_ms);

            crow::json::wvalue body;
            body["status"] = "SETTLED";
            body["transaction_id"] = transaction_id;
            body["request_id"] = request_id;
            body["amount"] = cents_to_money(amount_cents);
            body["projected_debt"] = cents_to_money(projected_debt);
            body["solvency_ratio"] =
                static_cast<double>(projected_debt) /
                static_cast<double>(account->assets);
            body["legacy_core_exit_code"] = cobol.exit_code;
            body["legacy_core_latency_ms"] = cobol.elapsed_ms;
            body["legacy_gateway_exit_code"] = gateway.exit_code;
            body["legacy_gateway_latency_ms"] = gateway.elapsed_ms;
            body["database_mutated"] = true;
            body["audit_written"] = true;

            return crow::response(200, body);
        });

        std::cout
            << "Modern Ledger API listening on http://127.0.0.1:8080\n"
            << "Demo account: ACC-DEMO-001 ($100,000 assets / $85,000 debt)\n"
            << "POST /api/v1/ledger/settle\n";

        app.port(8080).multithreaded().run();

    } catch (const std::exception& ex) {
        std::cerr << "Fatal: " << ex.what() << '\n';
        return 1;
    }

    return 0;
}
