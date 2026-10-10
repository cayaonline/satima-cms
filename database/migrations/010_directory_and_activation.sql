-- Additive classification; backfill only the five known, fixed-UUID demo fixtures.
ALTER TABLE farmers ADD COLUMN record_kind text NOT NULL DEFAULT 'registered'
 CHECK(record_kind IN ('registered','demo'));
ALTER TABLE farmers DISABLE TRIGGER farmers_updated;
UPDATE farmers SET record_kind='demo'
 WHERE registered_by='TEST STAFF' AND id IN
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005');
ALTER TABLE farmers ENABLE TRIGGER farmers_updated;
CREATE FUNCTION protect_farmer_classification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.record_kind IS DISTINCT FROM OLD.record_kind THEN
  RAISE EXCEPTION 'Farmer classification is administrative and immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER farmers_classification BEFORE UPDATE ON farmers
 FOR EACH ROW EXECUTE FUNCTION protect_farmer_classification();
-- A stored, automatically maintained search document supports substring indexing.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER TABLE farmers ADD COLUMN search_text text GENERATED ALWAYS AS (lower(
 coalesce(full_name,'')||' '||coalesce(customer_id,'')||' '||coalesce(primary_phone,'')||' '||
 coalesce(registered_business_name,'')||' '||coalesce(village_area,'')||' '||coalesce(county,'')||' '||
 coalesce(location,'')||' '||coalesce(sub_location,'')||' '||coalesce(sub_county,'')||' '||
 coalesce(physical_address,'')||' '||CASE status WHEN 'pending_verification' THEN 'pending_verification pending verification'
 WHEN 'active' THEN 'active' WHEN 'inactive' THEN 'inactive' WHEN 'suspended' THEN 'suspended' END)) STORED;
CREATE INDEX farmers_search_trigram ON farmers USING gin(search_text gin_trgm_ops);
CREATE INDEX farmers_kind_created ON farmers(record_kind,created_at DESC,id);
CREATE INDEX farmers_kind_name ON farmers(record_kind,full_name,id);
CREATE INDEX farmers_kind_registration ON farmers(record_kind,registration_date,id);
CREATE INDEX farmers_kind_status ON farmers(record_kind,status,id);
CREATE INDEX issues_open_farmer ON farmer_data_issues(farmer_id) WHERE status='open';
-- New verification evidence records the identity/payment details that were checked.
-- Historical evidence remains unchanged; it must be reaffirmed to activate a farmer.
ALTER TABLE farmer_verifications ADD COLUMN verified_details jsonb;
CREATE FUNCTION farmer_verification_details(fid uuid) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('national_id',f.national_id,'kra_pin',f.kra_pin,'primary_phone',f.primary_phone,
 'mpesa_registered_name',p.mpesa_registered_name,'mpesa_phone_number',p.mpesa_phone_number)
 FROM public.farmers f LEFT JOIN public.farmer_payment_profiles p ON p.farmer_id=f.id AND p.is_active
 WHERE f.id=fid;
$$;
CREATE FUNCTION capture_verified_details() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN NEW.verified_details:=public.farmer_verification_details(NEW.farmer_id);RETURN NEW;END $$;
CREATE TRIGGER verifications_details BEFORE INSERT ON farmer_verifications
 FOR EACH ROW EXECUTE FUNCTION capture_verified_details();
CREATE FUNCTION require_active_farmer_evidence() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE fid uuid; f public.farmers; v public.farmer_verifications; c public.farmer_consents;
BEGIN
 IF TG_TABLE_NAME='farmers' THEN fid:=NEW.id;ELSE fid:=NEW.farmer_id;END IF;
 -- Serialise edits of evidence with edits of its parent farmer.
 SELECT * INTO f FROM public.farmers WHERE id=fid FOR UPDATE;
 IF f.status IS DISTINCT FROM 'active' THEN RETURN NEW;END IF;
 SELECT * INTO v FROM public.farmer_verifications WHERE farmer_id=fid ORDER BY created_at DESC,id DESC LIMIT 1;
 SELECT * INTO c FROM public.farmer_consents WHERE farmer_id=fid ORDER BY created_at DESC,id DESC LIMIT 1;
 IF f.national_id IS NULL OR f.kra_pin IS NULL OR f.registration_date IS NULL OR
 v.national_id_verified IS DISTINCT FROM true OR v.kra_pin_verified IS DISTINCT FROM true OR
 v.primary_phone_verified IS DISTINCT FROM true OR v.mpesa_number_verified IS DISTINCT FROM true OR
 v.mpesa_registered_name_confirmed IS DISTINCT FROM true OR v.registration_form_complete IS DISTINCT FROM true OR
 v.consent_obtained IS DISTINCT FROM true OR v.verified_at>now() OR
 v.verified_details IS DISTINCT FROM public.farmer_verification_details(fid) OR
 c.consent_given IS DISTINCT FROM true OR c.data_processing_consent IS DISTINCT FROM true OR
 c.information_accuracy_confirmed IS DISTINCT FROM true OR c.withdrawn_at IS NOT NULL OR c.consent_date>now() OR
 NOT EXISTS(SELECT FROM public.farmer_payment_profiles WHERE farmer_id=fid AND is_active AND verified AND verified_at<=now()) OR
 EXISTS(SELECT FROM public.farmer_data_issues WHERE farmer_id=fid AND status='open' AND severity='high') THEN
 RAISE EXCEPTION 'Active status requires current identity, consent, payment and verification evidence'
 USING ERRCODE='23514',CONSTRAINT='active_farmer_evidence';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['farmers','farmer_payment_profiles','farmer_consents','farmer_verifications','farmer_data_issues'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER active_farmer_evidence AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_active_farmer_evidence()',t);
 END LOOP;
END $$;
-- App grants are retained; trigger guards prevent classification/identity changes.
