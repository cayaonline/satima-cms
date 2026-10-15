-- Optional farmer attributes. Historical records remain unknown until confirmed.
ALTER TABLE farmers ADD COLUMN date_of_birth date;
ALTER TABLE farmers ADD COLUMN preferred_language text
 CHECK (preferred_language IN ('English','Kiswahili'));

-- A paper form can be complete even when the field-officer box was left blank.
-- Keep that absence as NULL; the normal admin registration form still requires it.
ALTER TABLE farmers DROP CONSTRAINT farmer_registration_identity;
ALTER TABLE farmers ADD CONSTRAINT farmer_registration_identity CHECK (
 (registration_status='registered' AND customer_id IS NOT NULL)
 OR (registration_status IN ('not_registered','review_required') AND customer_id IS NULL
     AND registered_by IS NULL AND registration_date IS NULL
     AND status='pending_verification' AND record_kind='registered'));

ALTER TABLE farmers DROP CONSTRAINT farmers_gender_source_check;
ALTER TABLE farmers ADD CONSTRAINT farmers_gender_source_check
 CHECK (gender_source IN ('registration_document','farmer_confirmation','supplier_document'));
ALTER TABLE farmer_directory_sources ADD COLUMN source_gender text
 CHECK (source_gender IN ('male','female'));
