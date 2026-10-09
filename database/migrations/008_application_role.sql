-- No credential in migrations: local bootstrap sets a random password separately.
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='satima_app') THEN
  CREATE ROLE satima_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
 END IF;
END $$;
GRANT CONNECT ON DATABASE satima_cms TO satima_app;
GRANT USAGE ON SCHEMA public TO satima_app;
GRANT SELECT ON farmers, farmer_contacts, farmer_payment_profiles, farmer_consents,
 farmer_verifications, farmer_registration_summary, farmer_registration_sources,
 farmer_data_issues, farmer_audit_events TO satima_app;
GRANT INSERT, UPDATE ON farmers, farmer_contacts, farmer_payment_profiles, farmer_data_issues TO satima_app;
GRANT INSERT ON farmer_consents, farmer_verifications, farmer_registration_sources TO satima_app;
GRANT UPDATE (withdrawn_at) ON farmer_consents TO satima_app;
GRANT USAGE ON SEQUENCE farmer_customer_number TO satima_app;
