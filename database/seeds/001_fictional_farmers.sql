-- Deliberately invalid contact/identity strings prevent confusion with real people.
-- Fixed UUIDs make reruns no-ops; all writes form one transaction.
BEGIN;
DO $$
DECLARE n integer; fid uuid;
BEGIN
 FOR n IN 1..5 LOOP
  fid := ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
  IF EXISTS (SELECT 1 FROM farmers WHERE id=fid) THEN CONTINUE; END IF;
  INSERT INTO farmers(id, full_name, registered_business_name, national_id, primary_phone,
   physical_address, village_area, sub_location, location, sub_county, county, kra_pin, registered_by)
  VALUES(fid, 'Fictional Farmer '||n, 'TEST ONLY Farm '||n, 'TEST-ID-'||n, 'TEST-PHONE-'||n,
   'Fictional address', 'Test Village', 'Test Sub-location', 'Test Location', 'Test Sub-county',
   'Test County', 'TEST-PIN-'||n, 'TEST STAFF');
  INSERT INTO farmer_contacts(farmer_id, full_name, phone_number, relationship, is_primary_alternative)
   VALUES(fid, 'Fictional Next of Kin '||n, 'TEST-KIN-PHONE-'||n, 'Test relationship', true);
  INSERT INTO farmer_payment_profiles(farmer_id, mpesa_registered_name, mpesa_phone_number)
   VALUES(fid, 'Fictional Payee '||n, 'TEST-MPESA-'||n);
  INSERT INTO farmer_consents(farmer_id, consent_version, information_accuracy_confirmed,
   data_processing_consent, communications_consent, consent_given, signed_name, signature_method, consent_date)
   VALUES(fid, 'TEST-PAPER-v1', true, true, false, true, 'Fictional Farmer '||n, 'signature', now());
  INSERT INTO farmer_verifications(farmer_id, registration_form_complete, consent_obtained, verified_by, notes)
   VALUES(fid, true, true, 'TEST STAFF', 'Fictional fixture only; identity and payment checks intentionally unverified.');
 END LOOP;
END $$;
COMMIT;
