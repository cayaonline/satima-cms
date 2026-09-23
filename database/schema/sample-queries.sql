-- Restricted staff/admin inspection only: these results contain PII.
SELECT * FROM farmers ORDER BY created_at DESC;
SELECT * FROM farmers WHERE customer_id = 'SF-F-0001';
SELECT * FROM farmer_registration_summary ORDER BY customer_id;
-- Prefix lookup uses the lower(full_name) text_pattern_ops index.
SELECT id, customer_id, full_name FROM farmers WHERE lower(full_name) LIKE 'fictional%';
-- Full registration, one row per farmer, preserving all contacts/profiles.
SELECT f.*, c.contacts, p.payment_profiles,
       to_jsonb(consent) AS latest_consent, to_jsonb(v) AS latest_verification
FROM farmers f
LEFT JOIN LATERAL (
 SELECT jsonb_agg(c ORDER BY c.is_primary_alternative DESC, c.created_at, c.id) AS contacts
 FROM farmer_contacts c WHERE c.farmer_id=f.id
) c ON true
LEFT JOIN LATERAL (
 SELECT jsonb_agg(p ORDER BY p.is_active DESC, p.created_at, p.id) AS payment_profiles
 FROM farmer_payment_profiles p WHERE p.farmer_id=f.id
) p ON true
LEFT JOIN LATERAL (
 SELECT * FROM farmer_consents s WHERE s.farmer_id=f.id
 ORDER BY s.consent_date DESC, s.created_at DESC, s.id DESC LIMIT 1
) consent ON true
LEFT JOIN LATERAL (
 SELECT * FROM farmer_verifications v WHERE v.farmer_id=f.id
 ORDER BY v.verified_at DESC, v.created_at DESC, v.id DESC LIMIT 1
) v ON true
WHERE f.customer_id='SF-F-0001';
