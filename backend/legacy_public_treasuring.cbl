       IDENTIFICATION DIVISION.
       PROGRAM-ID. LEGACY-PUBLIC-TREASURY.
      *================================================================*
      * legacy_public_treasuring.cbl -- modernized treasury allocator  *
      *                                                                 *
      * TRUNC-001 FIXED: monetary values stored as integer micro-units  *
      *   (1 micro-unit = 0.000001 of base currency unit).              *
      *   PIC S9(18) COMP-5 is native binary int64, no packed-decimal   *
      *   truncation.  Ratio 12555/100000 applied in integer arithmetic. *
      *                                                                 *
      * AUDIT-001-CBL FIXED: structured audit record written to DISPLAY  *
      *   BEFORE the SUBTRACT mutates WS-PUBLIC-ASSETS-MU.              *
      *================================================================*

       DATA DIVISION.
       WORKING-STORAGE SECTION.
      *----------------------------------------------------------------*
      * TRUNC-001 FIX: all monetary fields use integer micro-units.    *
      * PIC S9(18) COMP-5 = signed native-binary 64-bit integer.       *
      * 1 monetary unit = 1000000 micro-units.                         *
      * $5,000,000,000.00 = 5000000000000000 micro-units.              *
      *----------------------------------------------------------------*
       01  WS-MICRO-SCALE           PIC 9(7) COMP-5 VALUE 1000000.
       01  WS-PUBLIC-ASSETS-MU      PIC S9(18) COMP-5
                                    VALUE 5000000000000000.
       01  WS-ALLOCATION-RATIO-NUM  PIC S9(9)  COMP-5 VALUE 12555.
       01  WS-ALLOCATION-RATIO-DEN  PIC S9(9)  COMP-5 VALUE 100000.
       01  WS-ALLOCATION-MU         PIC S9(18) COMP-5 VALUE 0.
       01  WS-REMAINDER-MU          PIC S9(18) COMP-5 VALUE 0.
       01  WS-ASSETS-DIV-DEN        PIC S9(18) COMP-5 VALUE 0.
       01  WS-ASSETS-MOD-DEN        PIC S9(18) COMP-5 VALUE 0.
       01  WS-AUDIT-ASSETS-PRE      PIC S9(18) COMP-5 VALUE 0.
      *----------------------------------------------------------------*
      * Display helpers: human-readable dollar amounts.                *
      *----------------------------------------------------------------*
       01  WS-DISPLAY-ALLOC         PIC Z(15)9.99.
       01  WS-DISPLAY-REMAINDER     PIC Z(15)9.99.
      *----------------------------------------------------------------*
      * Masked account identifier for audit trail (AUDIT-001-CBL).     *
      *----------------------------------------------------------------*
       01  WS-MASKED-ACCT           PIC X(20)
                                    VALUE "TREAS-XXXX-PUB-001".

       PROCEDURE DIVISION.
       CALCULATE-TREASURY-DRIFT.
      *----------------------------------------------------------------*
      * TRUNC-001 FIX: integer ratio allocation.                       *
      *   ALLOCATION = (ASSETS / DEN) * NUM                            *
      *              + (ASSETS MOD DEN) * NUM / DEN                    *
      * Split avoids intermediate overflow (5e15 * 12555 > int64).     *
      * For ASSETS = 5000000000000000:                                  *
      *   DIV  = 5000000000000000 / 100000 = 50000000000              *
      *   MOD  = 0                                                     *
      *   ALLOC = 50000000000 * 12555 = 627750000000000                *
      * which equals $627,750,000.00 exactly.                          *
      *----------------------------------------------------------------*
           COMPUTE WS-ASSETS-DIV-DEN =
               WS-PUBLIC-ASSETS-MU / WS-ALLOCATION-RATIO-DEN
           END-COMPUTE.

           COMPUTE WS-ASSETS-MOD-DEN =
               WS-PUBLIC-ASSETS-MU -
               WS-ASSETS-DIV-DEN * WS-ALLOCATION-RATIO-DEN
           END-COMPUTE.

           COMPUTE WS-ALLOCATION-MU =
               WS-ASSETS-DIV-DEN * WS-ALLOCATION-RATIO-NUM
               + WS-ASSETS-MOD-DEN * WS-ALLOCATION-RATIO-NUM
                 / WS-ALLOCATION-RATIO-DEN
           END-COMPUTE.

      *----------------------------------------------------------------*
      * AUDIT-001-CBL FIX: write structured audit record BEFORE the   *
      * SUBTRACT so the pre-mutation state is on the audit trail.      *
      *----------------------------------------------------------------*
           MOVE WS-PUBLIC-ASSETS-MU TO WS-AUDIT-ASSETS-PRE.

           DISPLAY "AUDIT|BEFORE-REALLOC"
               " acct=" WS-MASKED-ACCT
               " assets_pre_mu=" WS-AUDIT-ASSETS-PRE
               " allocation_mu=" WS-ALLOCATION-MU
               " ratio_num=" WS-ALLOCATION-RATIO-NUM
               " ratio_den=" WS-ALLOCATION-RATIO-DEN
           END-DISPLAY.

      *----------------------------------------------------------------*
      * Reallocation: subtract allocation from integer micro-unit bal. *
      *----------------------------------------------------------------*
           SUBTRACT WS-ALLOCATION-MU FROM WS-PUBLIC-ASSETS-MU
           END-SUBTRACT.

           COMPUTE WS-REMAINDER-MU = WS-PUBLIC-ASSETS-MU
           END-COMPUTE.

      *----------------------------------------------------------------*
      * Post-mutation audit record confirms the committed change.      *
      *----------------------------------------------------------------*
           DISPLAY "AUDIT|AFTER-REALLOC"
               " acct=" WS-MASKED-ACCT
               " assets_post_mu=" WS-PUBLIC-ASSETS-MU
               " allocation_mu=" WS-ALLOCATION-MU
           END-DISPLAY.

      *----------------------------------------------------------------*
      * Human-readable summary (micro-units converted to dollar value) *
      *----------------------------------------------------------------*
           DISPLAY " "
           END-DISPLAY.
           DISPLAY "=== TREASURY REALLOCATION SUMMARY ==="
           END-DISPLAY.

           DIVIDE WS-ALLOCATION-MU BY WS-MICRO-SCALE
               GIVING WS-DISPLAY-ALLOC
           END-DIVIDE.
           DISPLAY "Allocated (USD):       " WS-DISPLAY-ALLOC
           END-DISPLAY.

           DIVIDE WS-PUBLIC-ASSETS-MU BY WS-MICRO-SCALE
               GIVING WS-DISPLAY-REMAINDER
           END-DIVIDE.
           DISPLAY "Remaining assets (USD):" WS-DISPLAY-REMAINDER
           END-DISPLAY.

           DISPLAY "Arithmetic: integer micro-units, no floating point."
           END-DISPLAY.
           DISPLAY "Audit record written before balance mutation."
           END-DISPLAY.
           DISPLAY " "
           END-DISPLAY.

           STOP RUN.

       END PROGRAM LEGACY-PUBLIC-TREASURY.
