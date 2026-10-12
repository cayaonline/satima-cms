-- Preserve the portal responsible for each append-only KRA verification event.
ALTER TABLE farmer_kra_verifications
 ADD COLUMN source_portal text NOT NULL DEFAULT 'Admin'
 CHECK (source_portal IN ('Admin','Operations'));
ALTER TABLE farmer_kra_verifications
 DROP CONSTRAINT farmer_kra_verifications_method_check;
ALTER TABLE farmer_kra_verifications
 ADD CONSTRAINT farmer_kra_verifications_method_check
 CHECK (method IN ('manual_checker','manual_review'));
