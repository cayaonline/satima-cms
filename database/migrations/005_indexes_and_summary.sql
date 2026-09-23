-- UNIQUE constraints already index customer_id, national_id and kra_pin.
CREATE INDEX farmers_name_prefix ON farmers(lower(full_name) text_pattern_ops);
CREATE INDEX farmers_primary_phone ON farmers(primary_phone);
CREATE INDEX farmers_phone_normalized ON farmers(primary_phone_normalized) WHERE primary_phone_normalized IS NOT NULL;
CREATE INDEX farmers_registration_date ON farmers(registration_date);
CREATE INDEX contacts_farmer ON farmer_contacts(farmer_id);
CREATE INDEX payments_farmer ON farmer_payment_profiles(farmer_id);
CREATE INDEX payments_phone ON farmer_payment_profiles(mpesa_phone_number);
CREATE INDEX consents_latest ON farmer_consents(farmer_id, consent_date DESC, created_at DESC, id DESC);
CREATE INDEX verifications_latest ON farmer_verifications(farmer_id, verified_at DESC, created_at DESC, id DESC);
CREATE VIEW farmer_registration_summary AS
SELECT f.id AS farmer_id, f.customer_id, f.full_name AS farmer_name,
 f.registered_business_name AS business_name, f.primary_phone, f.county,
 c.full_name AS next_of_kin_name, c.phone_number AS next_of_kin_phone,
 p.mpesa_registered_name, p.mpesa_phone_number, f.registration_date, f.status,
 CASE WHEN v.id IS NULL THEN 'not_verified'
 WHEN v.national_id_verified AND v.kra_pin_verified AND v.primary_phone_verified
 AND v.mpesa_number_verified AND v.mpesa_registered_name_confirmed
 AND v.registration_form_complete AND v.consent_obtained THEN 'verified'
 ELSE 'incomplete' END AS latest_verification_status
FROM farmers f
LEFT JOIN LATERAL (SELECT * FROM farmer_contacts c WHERE c.farmer_id=f.id AND c.contact_type='next_of_kin'
 ORDER BY c.is_primary_alternative DESC, c.created_at DESC, c.id DESC LIMIT 1) c ON true
LEFT JOIN farmer_payment_profiles p ON p.farmer_id=f.id AND p.is_active
LEFT JOIN LATERAL (SELECT * FROM farmer_verifications v WHERE v.farmer_id=f.id
 ORDER BY v.verified_at DESC, v.created_at DESC, v.id DESC LIMIT 1) v ON true;
COMMENT ON VIEW farmer_registration_summary IS 'Restricted PII view: latest verification is historical evidence, not current authorization or eligibility.';
