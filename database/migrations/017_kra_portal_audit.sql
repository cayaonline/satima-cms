-- Preserve the portal responsible for each append-only KRA verification event.
ALTER TABLE farmer_kra_verifications
 ADD COLUMN source_portal text NOT NULL DEFAULT 'Admin'
 CHECK (source_portal IN ('Admin','Operations'));
