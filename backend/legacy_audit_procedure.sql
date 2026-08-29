-- legacy_audit_procedure.sql
--
-- LEGACY DEFECT: Treasury Transfer Stored Procedure
-- Simulates a legacy stored procedure used to move funds between
-- treasury sub-accounts. Ported from an older system that built
-- queries with string concatenation instead of bound parameters.
--
-- DEFECT CLASS: SQL INJECTION
--     Account identifiers are concatenated directly into the dynamic
--     SQL string with no parameterization or escaping, allowing
--     injected SQL to alter the WHERE clause or chain additional
--     statements.
--
-- DEFECT CLASS: MISSING AUDIT TRAIL
--     The transfer is committed with no corresponding row written to
--     an audit_log table, so the movement of public funds cannot be
--     reconstructed after the fact.

CREATE PROCEDURE legacy_transfer_treasury_funds(
    IN p_from_account VARCHAR(64),
    IN p_to_account VARCHAR(64),
    IN p_amount_cents BIGINT
)
BEGIN
    SET @sql = CONCAT(
        'UPDATE treasury_accounts SET balance_cents = balance_cents - ',
        p_amount_cents,
        ' WHERE account_id = ''', p_from_account, ''''
        -- LEGACY DEFECT: p_from_account is spliced directly into the
        -- query text; a crafted value can alter or chain the statement.
    );
    PREPARE stmt1 FROM @sql;
    EXECUTE stmt1;
    DEALLOCATE PREPARE stmt1;

    SET @sql2 = CONCAT(
        'UPDATE treasury_accounts SET balance_cents = balance_cents + ',
        p_amount_cents,
        ' WHERE account_id = ''', p_to_account, ''''
    );
    PREPARE stmt2 FROM @sql2;
    EXECUTE stmt2;
    DEALLOCATE PREPARE stmt2;

    -- LEGACY DEFECT: no INSERT INTO audit_log(from_account, to_account,
    -- amount_cents, actor, timestamp) recorded before this procedure
    -- returns, so the transfer leaves no compliance trail.
END;