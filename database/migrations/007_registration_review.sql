-- Paper evidence can be unknown. NULL means not recorded, never an inferred No.
ALTER TABLE farmer_consents
 ALTER information_accuracy_confirmed DROP NOT NULL,
 ALTER data_processing_consent DROP NOT NULL,
 ALTER communications_consent DROP NOT NULL,
 ALTER consent_given DROP NOT NULL;
ALTER TABLE farmer_consents ADD CONSTRAINT confirmed_consent_requires_explicit_evidence
 CHECK (consent_given IS DISTINCT FROM true OR
 (information_accuracy_confirmed IS TRUE AND data_processing_consent IS TRUE
 AND signed_name IS NOT NULL AND btrim(signed_name) <> '' AND signature_method IS NOT NULL));
ALTER TABLE farmer_consents ADD CONSTRAINT withdrawal_requires_confirmed_consent
 CHECK (withdrawn_at IS NULL OR consent_given IS TRUE);
ALTER TABLE farmer_verifications
 ALTER national_id_verified DROP NOT NULL, ALTER national_id_verified DROP DEFAULT,
 ALTER kra_pin_verified DROP NOT NULL, ALTER kra_pin_verified DROP DEFAULT,
 ALTER primary_phone_verified DROP NOT NULL, ALTER primary_phone_verified DROP DEFAULT,
 ALTER mpesa_number_verified DROP NOT NULL, ALTER mpesa_number_verified DROP DEFAULT,
 ALTER mpesa_registered_name_confirmed DROP NOT NULL, ALTER mpesa_registered_name_confirmed DROP DEFAULT,
 ALTER registration_form_complete DROP NOT NULL, ALTER registration_form_complete DROP DEFAULT,
 ALTER consent_obtained DROP NOT NULL, ALTER consent_obtained DROP DEFAULT;
CREATE TABLE farmer_registration_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 farmer_id uuid NOT NULL REFERENCES farmers(id) ON DELETE RESTRICT,
 document_name text NOT NULL,
 document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[a-f0-9]{64}$'),
 first_page integer NOT NULL CHECK(first_page > 0),
 last_page integer NOT NULL CHECK(last_page >= first_page),
 raw_transcription jsonb NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_sha256, first_page)
);
CREATE INDEX sources_farmer ON farmer_registration_sources(farmer_id);
CREATE TABLE farmer_data_issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 farmer_id uuid NOT NULL REFERENCES farmers(id) ON DELETE RESTRICT,
 field_name text NOT NULL CHECK(btrim(field_name) <> ''),
 description text NOT NULL CHECK(btrim(description) <> ''),
 severity text NOT NULL DEFAULT 'review' CHECK(severity IN ('review','high')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 resolution_note text,
 resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((status='open' AND resolved_at IS NULL) OR
 (status='resolved' AND resolved_at IS NOT NULL AND resolution_note IS NOT NULL AND btrim(resolution_note) <> ''))
);
CREATE INDEX issues_farmer ON farmer_data_issues(farmer_id, status);
CREATE TRIGGER issues_updated BEFORE UPDATE ON farmer_data_issues FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
-- PII-bearing change history. App may read it, but cannot update/delete it.
CREATE TABLE farmer_audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 farmer_id uuid NOT NULL REFERENCES farmers(id) ON DELETE RESTRICT,
 table_name text NOT NULL,
 operation text NOT NULL,
 actor text NOT NULL,
 before_record jsonb,
 after_record jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_farmer ON farmer_audit_events(farmer_id, created_at DESC);
CREATE FUNCTION audit_farmer_change() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE fid uuid;
BEGIN
 IF TG_TABLE_NAME = 'farmers' THEN fid := NEW.id; ELSE fid := NEW.farmer_id; END IF;
 INSERT INTO public.farmer_audit_events(farmer_id,table_name,operation,actor,before_record,after_record)
 VALUES(fid,TG_TABLE_NAME,TG_OP,coalesce(nullif(current_setting('app.actor',true),''),session_user),
 CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION audit_farmer_change() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['farmers','farmer_contacts','farmer_payment_profiles','farmer_consents','farmer_verifications','farmer_data_issues','farmer_registration_sources'] LOOP
 EXECUTE format('CREATE TRIGGER record_audit AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION audit_farmer_change()',t);
 END LOOP;
END $$;
