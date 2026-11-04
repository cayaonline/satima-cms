-- Correct the phone constraint added with the supply-history table.  The stored
-- normalized value is +254..., so the plus sign must be escaped once for the
-- PostgreSQL regular-expression engine.
ALTER TABLE farmer_supply_history
  DROP CONSTRAINT farmer_supply_history_normalized_phone_check,
  ADD CONSTRAINT farmer_supply_history_normalized_phone_check
    CHECK (normalized_phone IS NULL OR normalized_phone ~ '^\+[1-9][0-9]{7,14}$');
