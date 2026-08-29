       IDENTIFICATION DIVISION.
       PROGRAM-ID. LEGACY-CORE.

      *================================================================*
      * FinTechLedgerCompliance
      * Legacy COBOL Core Ledger Demonstration
      *
      * Demonstrates three modernization defects:
      *
      *   FP-001  COMP-1 floating-point currency arithmetic
      *   LAT-003 Synchronous C$SLEEP blocking ledger processing
      *   SOL-002 Debt validation logs a breach but has no hard stop
      *
      * Build:
      *   cobc -x -free -o legacy_core legacy_core.cbl
      *
      * Run:
      *   ./legacy_core
      *
      * IMPORTANT:
      *   This program intentionally demonstrates unsafe legacy behavior.
      *   It is not suitable for production financial processing.
      *================================================================*

       DATA DIVISION.
       WORKING-STORAGE SECTION.

       01  WS-ACCOUNT-ID              PIC X(16)
           VALUE "ACC-COBOL-001".

       01  WS-ASSETS                   COMP-1 VALUE 1000.00.
       01  WS-DEBT                     COMP-1 VALUE 890.00.
       01  WS-TRANSACTION-AMOUNT       COMP-1 VALUE 25.00.

       01  WS-DEBT-BEFORE              COMP-1 VALUE 0.
       01  WS-PROJECTED-DEBT           COMP-1 VALUE 0.
       01  WS-DEBT-ASSET-RATIO         COMP-1 VALUE 0.

       01  WS-INTEREST-RATE            COMP-1 VALUE 0.0035.
       01  WS-FEE                      COMP-1 VALUE 0.
       01  WS-POSTED-AMOUNT            COMP-1 VALUE 0.

       01  WS-SLEEP-SECONDS            PIC 9(4) COMP VALUE 3.

       01  WS-SOLVENCY-LIMIT           COMP-1 VALUE 0.90.

       01  WS-STATUS                   PIC X(12)
           VALUE "UNPROCESSED".

       01  WS-CURRENCY-TEST-A         COMP-1 VALUE 0.10.
       01  WS-CURRENCY-TEST-B         COMP-1 VALUE 0.20.
       01  WS-CURRENCY-SUM            COMP-1 VALUE 0.00.

       01  WS-REPEAT-INDEX            PIC 9(4) COMP VALUE 0.
       01  WS-DRIFT-LEDGER            COMP-1 VALUE 0.00.

       01  WS-DISPLAY-ASSETS          PIC -ZZZZZZ9.99.
       01  WS-DISPLAY-DEBT            PIC -ZZZZZZ9.99.
       01  WS-DISPLAY-RATIO           PIC 9.9999.
       01  WS-DISPLAY-FEE             PIC -ZZZZ9.9999.
       01  WS-DISPLAY-SUM             PIC -ZZZZ9.999999.

       PROCEDURE DIVISION.

       MAIN-PROCEDURE.

           DISPLAY "==============================================".
           DISPLAY " FinTech Legacy COBOL Core Ledger".
           DISPLAY "==============================================".
           DISPLAY "Account: " WS-ACCOUNT-ID.
           DISPLAY " ".

           PERFORM DEMONSTRATE-FLOATING-POINT-DRIFT.

           PERFORM PROCESS-TRANSACTION.

           DISPLAY " ".
           DISPLAY "==============================================".
           DISPLAY " Final Ledger State".
           DISPLAY "==============================================".
           MOVE WS-ASSETS TO WS-DISPLAY-ASSETS.
           MOVE WS-DEBT TO WS-DISPLAY-DEBT.

           DISPLAY "Assets:        " WS-DISPLAY-ASSETS.
           DISPLAY "Debt:          " WS-DISPLAY-DEBT.
           DISPLAY "Status:        " WS-STATUS.

           DISPLAY " ".
           DISPLAY "Legacy processing complete.".

           STOP RUN.


       DEMONSTRATE-FLOATING-POINT-DRIFT.

           DISPLAY "----------------------------------------------".
           DISPLAY "FP-001: COMP-1 Floating-Point Currency Drift".
           DISPLAY "----------------------------------------------".

           COMPUTE WS-CURRENCY-SUM =
               WS-CURRENCY-TEST-A + WS-CURRENCY-TEST-B.

           MOVE WS-CURRENCY-SUM TO WS-DISPLAY-SUM.

           DISPLAY "0.10 + 0.20 = " WS-DISPLAY-SUM.

           MOVE 0.00 TO WS-DRIFT-LEDGER.

           PERFORM VARYING WS-REPEAT-INDEX
               FROM 1 BY 1
               UNTIL WS-REPEAT-INDEX > 1000

               COMPUTE WS-DRIFT-LEDGER =
                   WS-DRIFT-LEDGER + 0.001

           END-PERFORM.

           MOVE WS-DRIFT-LEDGER TO WS-DISPLAY-SUM.

           DISPLAY "1000 x 0.001 = " WS-DISPLAY-SUM.
           DISPLAY "Currency is stored in COMP-1 floating point.".
           DISPLAY "Modern ledger should use exact integer minor units.".
           DISPLAY " ".


       PROCESS-TRANSACTION.

           DISPLAY "----------------------------------------------".
           DISPLAY "Transaction Processing".
           DISPLAY "----------------------------------------------".

           MOVE WS-DEBT TO WS-DEBT-BEFORE.

           COMPUTE WS-PROJECTED-DEBT =
               WS-DEBT-BEFORE + WS-TRANSACTION-AMOUNT.

           COMPUTE WS-DEBT-ASSET-RATIO =
               WS-PROJECTED-DEBT / WS-ASSETS.

           MOVE WS-DEBT-ASSET-RATIO TO WS-DISPLAY-RATIO.

           DISPLAY "Existing debt:       " WS-DEBT-BEFORE.
           DISPLAY "Transaction amount:  " WS-TRANSACTION-AMOUNT.
           DISPLAY "Projected debt:      " WS-PROJECTED-DEBT.
           DISPLAY "Debt/asset ratio:    " WS-DISPLAY-RATIO.

      *----------------------------------------------------------------*
      * SOL-002:
      * The validation detects the dangerous condition but DOES NOT
      * terminate processing, return an error, or roll back the request.
      *----------------------------------------------------------------*

           IF WS-DEBT-ASSET-RATIO > WS-SOLVENCY-LIMIT

               DISPLAY "CRITICAL: SOLVENCY LIMIT BREACHED."
               DISPLAY "CRITICAL: Ratio exceeds 0.90."
               DISPLAY "WARNING: Legacy validation has NO HARD STOP."

               MOVE "BREACHED" TO WS-STATUS

           ELSE

               DISPLAY "Solvency validation passed."
               MOVE "APPROVED" TO WS-STATUS

           END-IF.

      *----------------------------------------------------------------*
      * LAT-003:
      * Simulates a legacy external dependency using GnuCOBOL's
      * C$SLEEP runtime extension. This blocks the current process.
      *----------------------------------------------------------------*

           DISPLAY " ".
           DISPLAY "LAT-003: Acquiring legacy ledger connection...".
           DISPLAY "Blocking for " WS-SLEEP-SECONDS " seconds.".

           CALL "C$SLEEP" USING WS-SLEEP-SECONDS.

           DISPLAY "Legacy connection acquired.".

      *----------------------------------------------------------------*
      * The critical defect:
      *
      * Even if the solvency validation above reports BREACHED,
      * execution continues here and posts the transaction.
      *----------------------------------------------------------------*

           COMPUTE WS-FEE =
               WS-TRANSACTION-AMOUNT * WS-INTEREST-RATE.

           COMPUTE WS-POSTED-AMOUNT =
               WS-TRANSACTION-AMOUNT + WS-FEE.

           COMPUTE WS-DEBT =
               WS-DEBT-BEFORE + WS-POSTED-AMOUNT.

           DISPLAY " ".
           DISPLAY "Transaction posted through legacy core.".
           DISPLAY "Fee calculated:      " WS-FEE.
           DISPLAY "Amount posted:       " WS-POSTED-AMOUNT.
           DISPLAY "Resulting debt:      " WS-DEBT.

           IF WS-STATUS = "BREACHED"
               DISPLAY "WARNING: Transaction POSTED despite solvency breach."
           END-IF.

           EXIT.


       END PROGRAM LEGACY-CORE.