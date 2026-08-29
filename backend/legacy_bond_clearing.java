/**
 * legacy_bond_clearing.java
 *
 * LEGACY DEFECT: Municipal Bond Clearing Engine
 * Simulates a legacy overnight batch job that clears municipal bond
 * settlements across multiple worker threads for throughput. Ported
 * from a single-threaded process without adding proper synchronization.
 *
 * DEFECT CLASS: RACE CONDITION / NON-ATOMIC UPDATE
 *     clearedBalance is read, modified, and written back across threads
 *     with no lock, synchronized block, or atomic type. Under concurrent
 *     settlement, updates can be lost, producing an incorrect cleared
 *     balance for the municipal bond pool.
 *
 * DEFECT CLASS: NO AUDIT LOG ON MUTATION
 *     Balance changes are applied with no corresponding audit record,
 *     violating basic financial control requirements.
 */
public class LegacyBondClearingEngine {

    // LEGACY DEFECT: plain field, not AtomicLong / volatile + lock.
    private double clearedBalance = 0.0;

    public void settleBond(double faceValue) {
        // LEGACY DEFECT: read-modify-write is not atomic across threads.
        double current = clearedBalance;
        double updated = current + faceValue;
        clearedBalance = updated;
        // LEGACY DEFECT: no audit trail write here.
    }

    public double getClearedBalance() {
        return clearedBalance;
    }

    public static void main(String[] args) throws InterruptedException {
        LegacyBondClearingEngine engine = new LegacyBondClearingEngine();
        int settlementsPerWorker = 10000;
        double faceValuePerBond = 1000.0;

        Runnable worker = () -> {
            for (int i = 0; i < settlementsPerWorker; i++) {
                engine.settleBond(faceValuePerBond);
            }
        };

        Thread t1 = new Thread(worker);
        Thread t2 = new Thread(worker);
        t1.start();
        t2.start();
        t1.join();
        t2.join();

        double expected = 2 * settlementsPerWorker * faceValuePerBond;
        System.out.println("Expected cleared balance: " + expected);
        System.out.println("Actual cleared balance:   " + engine.getClearedBalance());
        // Actual will usually be less than expected due to lost updates
        // under concurrent settlement -- that gap is the defect signature.
    }
}