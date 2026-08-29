#!/usr/bin/env python3
"""
Integration tests for the modern ledger API.

Requires:
    pip install requests

Start ./ledger_api before running this file.
"""

import json
import sys
import time
import requests

BASE = "http://127.0.0.1:8080"
TOKEN = "demo-token-ibm-bob"


def post(amount, idem):
    return requests.post(
        f"{BASE}/api/v1/ledger/settle",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Idempotency-Key": idem,
            "Content-Type": "application/json",
        },
        json={
            "account_id": "ACC-DEMO-001",
            "amount": amount,
        },
        timeout=30,
    )


def test_health():
    r = requests.get(f"{BASE}/health", timeout=5)
    assert r.status_code == 200
    assert r.json()["status"] == "UP"
    print("[PASS] health")


def test_auth():
    r = requests.post(
        f"{BASE}/api/v1/ledger/settle",
        json={"account_id": "ACC-DEMO-001", "amount": "1.00"},
        timeout=5,
    )
    assert r.status_code == 401
    print("[PASS] authentication required")


def test_solvency_hard_stop():
    # Demo account starts at $85,000 debt / $100,000 assets.
    # Adding $6,000 gives $91,000 / $100,000 = 91%.
    r = post("6000.00", "bob-solvency-001")

    assert r.status_code == 400
    data = r.json()
    assert data["status"] == "REJECTED"
    assert data["database_mutated"] is False
    assert "90%" in data["reason"]
    print("[PASS] >90% solvency request hard-rejected")


def test_settlement():
    # Adding $100 gives 85.1%, safely below the threshold.
    r = post("100.00", "bob-settlement-001")

    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "SETTLED"
    assert data["database_mutated"] is True
    assert data["audit_written"] is True
    print("[PASS] valid settlement committed")


def test_idempotency():
    key = "bob-idempotency-001"

    first = post("10.00", key)
    second = post("10.00", key)

    assert first.status_code == 200
    assert second.status_code == 200

    a = first.json()
    b = second.json()

    assert a["transaction_id"] == b["transaction_id"]
    assert b["idempotent_replay"] is True

    print("[PASS] idempotent replay returns original transaction")


if __name__ == "__main__":
    test_health()
    test_auth()
    test_solvency_hard_stop()
    test_settlement()
    test_idempotency()

    print("\nAll modern API integration tests passed.")
