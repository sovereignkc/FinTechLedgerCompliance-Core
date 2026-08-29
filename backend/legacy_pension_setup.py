"""
legacy_pension_settlement.py

LEGACY DEFECT: Public Pension Fund Disbursement Calculator
Simulates a state pension fund's monthly disbursement calculation, ported
from an older mainframe batch process with all its numeric problems intact.

DEFECT CLASS: FLOATING-POINT ACCUMULATION DRIFT
    The original process accumulates thousands of small disbursement
    lines using native float arithmetic. Over a large batch, binary
    rounding error compounds and the ledger no longer reconciles against
    the fund's real balance -- often off by several cents to dollars per
    run, which is unacceptable for public fund auditing.

DEFECT CLASS: NO RECONCILIATION INVARIANT
    The function returns a final balance with no check that
    total_disbursed + remaining == starting_balance, so drift silently
    passes through to downstream reporting instead of raising an alert.
"""

from typing import List, Dict


def calculate_pension_disbursements(starting_balance: float, monthly_payouts: List[float]) -> float:
    """Returns remaining pension fund balance after processing monthly payouts.

    NOTE: Uses native float, not Decimal/int-cents -- this is the defect
    under test, mirroring the drift class already repaired in the C++
    credit engine but left untreated here.
    """
    remaining = starting_balance
    for payout in monthly_payouts:
        # LEGACY DEFECT: naive float subtraction accumulates binary
        # rounding error across large batches (10k+ retirees/month).
        remaining -= payout
    return remaining


def batch_settle(starting_balance: float, monthly_payouts: List[float]) -> Dict[str, float]:
    # LEGACY DEFECT: sum() over floats has the same drift issue.
    total_paid = sum(monthly_payouts)
    remaining = calculate_pension_disbursements(starting_balance, monthly_payouts)

    # LEGACY DEFECT: no assertion that starting_balance == total_paid + remaining
    # (within a defined epsilon) before this result is trusted downstream.
    return {
        "starting_balance": starting_balance,
        "total_paid": total_paid,
        "remaining_balance": remaining,
    }


if __name__ == "__main__":
    payouts = [1834.17] * 12000  # simulate a large monthly retiree batch
    result = batch_settle(5_000_000_000.00, payouts)
    print(result)