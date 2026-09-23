\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.must_fail(statement text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
 BEGIN
  EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE;
  IF actual = expected_state THEN RETURN; END IF;
  RAISE EXCEPTION 'Wrong error: expected %, got % for %', expected_state, actual, statement;
 END;
 RAISE EXCEPTION 'Expected error % but statement succeeded: %', expected_state, statement;
END $$;
INSERT INTO farmers(id, full_name, national_id, kra_pin, primary_phone, registered_by)
VALUES('10000000-0000-4000-8000-000000000001', 'TEST INTEGRITY', 'INTEGRITY-ID', 'INTEGRITY-PIN', 'TEST-PHONE', 'TEST');
SELECT pg_temp.must_fail($q$INSERT INTO farmers(full_name, national_id, primary_phone, registered_by) VALUES('TEST', 'INTEGRITY-ID', 'TEST', 'TEST')$q$, '23505');
SELECT pg_temp.must_fail($q$INSERT INTO farmers(full_name, kra_pin, primary_phone, registered_by) VALUES('TEST', 'INTEGRITY-PIN', 'TEST', 'TEST')$q$, '23505');
SELECT pg_temp.must_fail($q$INSERT INTO farmers(full_name, customer_id, primary_phone, registered_by) SELECT 'TEST', customer_id, 'TEST', 'TEST' FROM farmers WHERE national_id='INTEGRITY-ID'$q$, '23505');
SELECT pg_temp.must_fail($q$INSERT INTO farmers(full_name, kra_pin, primary_phone, registered_by) VALUES('TEST', 'lowercase', 'TEST', 'TEST')$q$, '23514');
SELECT pg_temp.must_fail($q$INSERT INTO farmers(full_name, primary_phone, registered_by, status) VALUES('TEST','TEST','TEST','invalid')$q$, '22P02');
INSERT INTO farmers(full_name, primary_phone, registered_by) VALUES('TEST NULL 1','TEST','TEST'), ('TEST NULL 2','TEST','TEST');
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['farmer_contacts','farmer_payment_profiles','farmer_consents','farmer_verifications'] LOOP
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid=t::regclass AND contype='f') THEN RAISE EXCEPTION 'Missing FK: %', t; END IF;
 END LOOP;
END $$;
SELECT pg_temp.must_fail($q$INSERT INTO farmer_contacts(farmer_id,full_name,phone_number,relationship) VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','TEST','TEST','TEST')$q$,'23503');
SELECT pg_temp.must_fail($q$INSERT INTO farmer_payment_profiles(farmer_id,mpesa_registered_name,mpesa_phone_number) VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','TEST','TEST')$q$,'23503');
SELECT pg_temp.must_fail($q$INSERT INTO farmer_consents(farmer_id,consent_version,information_accuracy_confirmed,data_processing_consent,communications_consent,consent_given,consent_date) VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','TEST',false,false,false,false,now())$q$,'23503');
SELECT pg_temp.must_fail($q$INSERT INTO farmer_verifications(farmer_id,verified_by) VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','TEST')$q$,'23503');
INSERT INTO farmer_contacts(farmer_id,full_name,phone_number,relationship,is_primary_alternative) VALUES('10000000-0000-4000-8000-000000000001','TEST','TEST','TEST',true);
SELECT pg_temp.must_fail($q$INSERT INTO farmer_contacts(farmer_id,full_name,phone_number,relationship,is_primary_alternative) VALUES('10000000-0000-4000-8000-000000000001','TEST','TEST','TEST',true)$q$,'23505');
INSERT INTO farmer_payment_profiles(farmer_id,mpesa_registered_name,mpesa_phone_number) VALUES('10000000-0000-4000-8000-000000000001','TEST','TEST');
SELECT pg_temp.must_fail($q$INSERT INTO farmer_payment_profiles(farmer_id,mpesa_registered_name,mpesa_phone_number) VALUES('10000000-0000-4000-8000-000000000001','TEST','TEST')$q$,'23505');
SELECT pg_temp.must_fail($q$UPDATE farmer_payment_profiles SET verified=true WHERE farmer_id='10000000-0000-4000-8000-000000000001'$q$,'23514');
UPDATE farmer_payment_profiles SET verified=true, verified_at=now() WHERE farmer_id='10000000-0000-4000-8000-000000000001';
UPDATE farmer_payment_profiles SET mpesa_phone_number='TEST-CHANGED' WHERE farmer_id='10000000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM farmer_payment_profiles WHERE farmer_id='10000000-0000-4000-8000-000000000001' AND (verified OR verified_at IS NOT NULL)) THEN RAISE EXCEPTION 'Changed payment retained verification'; END IF;
END $$;
INSERT INTO farmer_verifications(farmer_id,verified_by,verified_at) VALUES('10000000-0000-4000-8000-000000000001','TEST','2020-01-01'), ('10000000-0000-4000-8000-000000000001','TEST','2021-01-01');
SELECT pg_temp.must_fail($q$UPDATE farmer_verifications SET notes='overwrite' WHERE farmer_id='10000000-0000-4000-8000-000000000001'$q$,'P0001');
SELECT pg_temp.must_fail($q$DELETE FROM farmer_verifications WHERE farmer_id='10000000-0000-4000-8000-000000000001'$q$,'P0001');
SELECT pg_temp.must_fail($q$UPDATE farmers SET customer_id='SF-F-9999' WHERE national_id='INTEGRITY-ID'$q$,'P0001');
SELECT pg_temp.must_fail($q$DELETE FROM farmers WHERE national_id='INTEGRITY-ID'$q$,'23001');
INSERT INTO farmer_consents(farmer_id,consent_version,information_accuracy_confirmed,data_processing_consent,communications_consent,consent_given,signed_name,signature_method,consent_date)
 VALUES('10000000-0000-4000-8000-000000000001','TEST',true,true,false,true,'TEST','signature','2020-01-01');
SELECT pg_temp.must_fail($q$UPDATE farmer_consents SET signed_name='changed' WHERE farmer_id='10000000-0000-4000-8000-000000000001'$q$,'P0001');
UPDATE farmer_consents SET withdrawn_at=now() WHERE farmer_id='10000000-0000-4000-8000-000000000001';
SELECT pg_temp.must_fail($q$UPDATE farmer_consents SET withdrawn_at=NULL WHERE farmer_id='10000000-0000-4000-8000-000000000001'$q$,'P0001');
DO $$
BEGIN
 IF (SELECT count(*) FROM farmer_registration_summary) <> (SELECT count(*) FROM farmers) THEN RAISE EXCEPTION 'View fanout'; END IF;
 IF (SELECT count(*) FROM farmer_verifications WHERE farmer_id='10000000-0000-4000-8000-000000000001') <> 2 THEN RAISE EXCEPTION 'Lost history'; END IF;
 IF next_farmer_customer_id() = next_farmer_customer_id() THEN RAISE EXCEPTION 'Duplicate sequence value'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: integrity, uniqueness, FK, history, consent and view assertions (rows rolled back).'
