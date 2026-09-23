# Farmer Registration Form mapping

| Form field / recording metadata | Database field |
|---|---|
| Registered farm / Business name | `farmers.registered_business_name` |
| Full name (Farmer / Contact person) | `farmers.full_name` |
| National ID | `farmers.national_id` |
| Primary phone number | `farmers.primary_phone` |
| Physical address | `farmers.physical_address` |
| Village / Area | `farmers.village_area` |
| Sub-location | `farmers.sub_location` |
| Location | `farmers.location` |
| Sub-county | `farmers.sub_county` |
| County | `farmers.county` |
| KRA PIN | `farmers.kra_pin` |
| Alternative contact / Next of kin name | `farmer_contacts.full_name` |
| Alternative contact phone number | `farmer_contacts.phone_number` |
| Relationship to farmer | `farmer_contacts.relationship` |
| M-Pesa registered name | `farmer_payment_profiles.mpesa_registered_name` |
| M-Pesa phone number | `farmer_payment_profiles.mpesa_phone_number` |
| Information accuracy confirmed | `farmer_consents.information_accuracy_confirmed` |
| Data processing consent | `farmer_consents.data_processing_consent` |
| Communications consent | `farmer_consents.communications_consent` |
| Consent given | `farmer_consents.consent_given` |
| Signed name | `farmer_consents.signed_name` |
| Signature method | `farmer_consents.signature_method` |
| Consent date | `farmer_consents.consent_date` |
| Consent version | `farmer_consents.consent_version` |
| Withdrawn at | `farmer_consents.withdrawn_at` |
| National id verified | `farmer_verifications.national_id_verified` |
| Kra pin verified | `farmer_verifications.kra_pin_verified` |
| Primary phone verified | `farmer_verifications.primary_phone_verified` |
| Mpesa number verified | `farmer_verifications.mpesa_number_verified` |
| Mpesa registered name confirmed | `farmer_verifications.mpesa_registered_name_confirmed` |
| Registration form complete | `farmer_verifications.registration_form_complete` |
| Consent obtained | `farmer_verifications.consent_obtained` |
| Verified by | `farmer_verifications.verified_by` |
| Verified at | `farmer_verifications.verified_at` |
| Notes | `farmer_verifications.notes` |
| Registration date | `farmers.registration_date` |
| Registered by | `farmers.registered_by` |
| Farmer Customer ID (proposed paper field) | `farmers.customer_id` |

The three declarations are recorded separately. `consent_given` summarizes captured consent evidence; communications permission remains optional. `consent_version`, `withdrawn_at`, and signature method are recording metadata where absent from paper. Record next of kin as `contact_type=next_of_kin`, normally `is_primary_alternative=true`. Payment starts as `payment_method=mpesa`, `is_active=true`, `verified=false`; verification timestamp is required when it becomes verified. Master status starts pending_verification. Insert registration and related rows in one transaction. Missing optional values use NULL, not empty identifier strings. Do not infer checkmarks or staff identities from blank form fields.
