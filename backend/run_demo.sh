#!/usr/bin/env bash
set -euo pipefail

echo "=== FinTech Ledger Modernization Demo ==="

command -v cobc >/dev/null 2>&1 || {
  echo "cobc is required."
  exit 1
}

command -v g++ >/dev/null 2>&1 || {
  echo "g++ is required."
  exit 1
}

echo "[1/4] Building legacy COBOL core..."
cobc -x -free -o legacy_core legacy_core.cbl

echo "[2/4] Building legacy C++ gateway..."
g++ -std=c++17 -O2 -pthread -o legacy_gateway legacy_gateway.cpp

echo "[3/4] Building modern C++ REST API..."
if command -v cmake >/dev/null 2>&1; then
  cmake -S . -B build
  cmake --build build -j
  cp build/ledger_api ./ledger_api
else
  echo "CMake not found; compile ledger_api.cpp manually with Crow and SQLite3."
  exit 1
fi

echo "[4/4] Starting API..."
echo
echo "Health:"
echo "  curl http://127.0.0.1:8080/health"
echo
echo "Solvency rejection:"
echo '  curl -X POST http://127.0.0.1:8080/api/v1/ledger/settle \'
echo '    -H "Authorization: Bearer demo-token-ibm-bob" \'
echo '    -H "Idempotency-Key: demo-reject-001" \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '\''{"account_id":"ACC-DEMO-001","amount":"6000.00"}'\'''
echo
echo "Starting..."
exec ./ledger_api
