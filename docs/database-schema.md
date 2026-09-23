# Database schema

Generated from the running PostgreSQL catalog. All five child/master entities use UUID primary keys defaulting to gen_random_uuid(); relationship keys reference farmers.id with ON DELETE RESTRICT. Timestamps use timestamptz. No operational-profile table is created.

## farmers

Canonical farmer/contact person. Status replaces routine deletion.

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` |
| `customer_id` | `text` | NO | `next_farmer_customer_id()` |
| `registered_business_name` | `text` | YES | `—` |
| `full_name` | `text` | NO | `—` |
| `national_id` | `text` | YES | `—` |
| `primary_phone` | `text` | NO | `—` |
| `primary_phone_normalized` | `text` | YES | `—` |
| `physical_address` | `text` | YES | `—` |
| `village_area` | `text` | YES | `—` |
| `sub_location` | `text` | YES | `—` |
| `location` | `text` | YES | `—` |
| `sub_county` | `text` | YES | `—` |
| `county` | `text` | YES | `—` |
| `kra_pin` | `text` | YES | `—` |
| `registration_date` | `date` | NO | `CURRENT_DATE` |
| `registered_by` | `text` | NO | `—` |
| `status` | `farmer_status` | NO | `'pending_verification'::farmer_status` |
| `created_at` | `timestamptz` | NO | `now()` |
| `updated_at` | `timestamptz` | NO | `now()` |

Constraints:

- `farmers_created_at_not_null`: `NOT NULL created_at`
- `farmers_customer_id_check`: `CHECK ((customer_id ~ '^SF-F-[0-9]{4,}$'::text))`
- `farmers_customer_id_key`: `UNIQUE (customer_id)`
- `farmers_customer_id_not_null`: `NOT NULL customer_id`
- `farmers_full_name_check`: `CHECK ((btrim(full_name) <> ''::text))`
- `farmers_full_name_not_null`: `NOT NULL full_name`
- `farmers_id_not_null`: `NOT NULL id`
- `farmers_kra_pin_check`: `CHECK (((kra_pin IS NULL) OR ((kra_pin = upper(btrim(kra_pin))) AND (kra_pin <> ''::text))))`
- `farmers_kra_pin_key`: `UNIQUE (kra_pin)`
- `farmers_national_id_check`: `CHECK (((national_id IS NULL) OR ((national_id = btrim(national_id)) AND (national_id <> ''::text))))`
- `farmers_national_id_key`: `UNIQUE (national_id)`
- `farmers_pkey`: `PRIMARY KEY (id)`
- `farmers_primary_phone_check`: `CHECK ((btrim(primary_phone) <> ''::text))`
- `farmers_primary_phone_normalized_check`: `CHECK ((primary_phone_normalized ~ '^\+[1-9][0-9]{7,14}$'::text))`
- `farmers_primary_phone_not_null`: `NOT NULL primary_phone`
- `farmers_registered_by_check`: `CHECK ((btrim(registered_by) <> ''::text))`
- `farmers_registered_by_not_null`: `NOT NULL registered_by`
- `farmers_registration_date_not_null`: `NOT NULL registration_date`
- `farmers_status_not_null`: `NOT NULL status`
- `farmers_updated_at_not_null`: `NOT NULL updated_at`

## farmer_contacts

Multiple alternative/next-of-kin contacts; at most one primary alternative per farmer.

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` |
| `farmer_id` | `uuid` | NO | `—` |
| `contact_type` | `text` | NO | `'next_of_kin'::text` |
| `full_name` | `text` | NO | `—` |
| `phone_number` | `text` | NO | `—` |
| `relationship` | `text` | NO | `—` |
| `is_primary_alternative` | `bool` | NO | `false` |
| `created_at` | `timestamptz` | NO | `now()` |
| `updated_at` | `timestamptz` | NO | `now()` |

Constraints:

- `farmer_contacts_contact_type_check`: `CHECK ((contact_type = ANY (ARRAY['next_of_kin'::text, 'alternative'::text])))`
- `farmer_contacts_contact_type_not_null`: `NOT NULL contact_type`
- `farmer_contacts_created_at_not_null`: `NOT NULL created_at`
- `farmer_contacts_farmer_id_fkey`: `FOREIGN KEY (farmer_id) REFERENCES farmers(id) ON DELETE RESTRICT`
- `farmer_contacts_farmer_id_not_null`: `NOT NULL farmer_id`
- `farmer_contacts_full_name_check`: `CHECK ((btrim(full_name) <> ''::text))`
- `farmer_contacts_full_name_not_null`: `NOT NULL full_name`
- `farmer_contacts_id_not_null`: `NOT NULL id`
- `farmer_contacts_is_primary_alternative_not_null`: `NOT NULL is_primary_alternative`
- `farmer_contacts_phone_number_check`: `CHECK ((btrim(phone_number) <> ''::text))`
- `farmer_contacts_phone_number_not_null`: `NOT NULL phone_number`
- `farmer_contacts_pkey`: `PRIMARY KEY (id)`
- `farmer_contacts_relationship_check`: `CHECK ((btrim(relationship) <> ''::text))`
- `farmer_contacts_relationship_not_null`: `NOT NULL relationship`
- `farmer_contacts_updated_at_not_null`: `NOT NULL updated_at`

## farmer_payment_profiles

M-Pesa details independent of farmer name; at most one active profile per farmer.

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` |
| `farmer_id` | `uuid` | NO | `—` |
| `payment_method` | `text` | NO | `'mpesa'::text` |
| `mpesa_registered_name` | `text` | NO | `—` |
| `mpesa_phone_number` | `text` | NO | `—` |
| `is_active` | `bool` | NO | `true` |
| `verified` | `bool` | NO | `false` |
| `verified_at` | `timestamptz` | YES | `—` |
| `created_at` | `timestamptz` | NO | `now()` |
| `updated_at` | `timestamptz` | NO | `now()` |

Constraints:

- `farmer_payment_profiles_check`: `CHECK ((verified = (verified_at IS NOT NULL)))`
- `farmer_payment_profiles_created_at_not_null`: `NOT NULL created_at`
- `farmer_payment_profiles_farmer_id_fkey`: `FOREIGN KEY (farmer_id) REFERENCES farmers(id) ON DELETE RESTRICT`
- `farmer_payment_profiles_farmer_id_not_null`: `NOT NULL farmer_id`
- `farmer_payment_profiles_id_not_null`: `NOT NULL id`
- `farmer_payment_profiles_is_active_not_null`: `NOT NULL is_active`
- `farmer_payment_profiles_mpesa_phone_number_check`: `CHECK ((btrim(mpesa_phone_number) <> ''::text))`
- `farmer_payment_profiles_mpesa_phone_number_not_null`: `NOT NULL mpesa_phone_number`
- `farmer_payment_profiles_mpesa_registered_name_check`: `CHECK ((btrim(mpesa_registered_name) <> ''::text))`
- `farmer_payment_profiles_mpesa_registered_name_not_null`: `NOT NULL mpesa_registered_name`
- `farmer_payment_profiles_payment_method_check`: `CHECK ((payment_method = 'mpesa'::text))`
- `farmer_payment_profiles_payment_method_not_null`: `NOT NULL payment_method`
- `farmer_payment_profiles_pkey`: `PRIMARY KEY (id)`
- `farmer_payment_profiles_updated_at_not_null`: `NOT NULL updated_at`
- `farmer_payment_profiles_verified_not_null`: `NOT NULL verified`

## farmer_consents

Versioned paper consent evidence, with separate declarations and one-way withdrawal.

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` |
| `farmer_id` | `uuid` | NO | `—` |
| `consent_version` | `text` | NO | `—` |
| `information_accuracy_confirmed` | `bool` | NO | `—` |
| `data_processing_consent` | `bool` | NO | `—` |
| `communications_consent` | `bool` | NO | `—` |
| `consent_given` | `bool` | NO | `—` |
| `signed_name` | `text` | YES | `—` |
| `signature_method` | `text` | YES | `—` |
| `consent_date` | `timestamptz` | NO | `—` |
| `withdrawn_at` | `timestamptz` | YES | `—` |
| `created_at` | `timestamptz` | NO | `now()` |
| `updated_at` | `timestamptz` | NO | `now()` |

Constraints:

- `farmer_consents_check`: `CHECK (((NOT consent_given) OR (information_accuracy_confirmed AND data_processing_consent AND (signed_name IS NOT NULL) AND (btrim(signed_name) <> ''::text) AND (signature_method IS NOT NULL))))`
- `farmer_consents_check1`: `CHECK (((withdrawn_at IS NULL) OR (consent_given AND (withdrawn_at >= consent_date))))`
- `farmer_consents_communications_consent_not_null`: `NOT NULL communications_consent`
- `farmer_consents_consent_date_not_null`: `NOT NULL consent_date`
- `farmer_consents_consent_given_not_null`: `NOT NULL consent_given`
- `farmer_consents_consent_version_check`: `CHECK ((btrim(consent_version) <> ''::text))`
- `farmer_consents_consent_version_not_null`: `NOT NULL consent_version`
- `farmer_consents_created_at_not_null`: `NOT NULL created_at`
- `farmer_consents_data_processing_consent_not_null`: `NOT NULL data_processing_consent`
- `farmer_consents_farmer_id_fkey`: `FOREIGN KEY (farmer_id) REFERENCES farmers(id) ON DELETE RESTRICT`
- `farmer_consents_farmer_id_not_null`: `NOT NULL farmer_id`
- `farmer_consents_id_not_null`: `NOT NULL id`
- `farmer_consents_information_accuracy_confirmed_not_null`: `NOT NULL information_accuracy_confirmed`
- `farmer_consents_pkey`: `PRIMARY KEY (id)`
- `farmer_consents_signature_method_check`: `CHECK ((signature_method = ANY (ARRAY['signature'::text, 'thumbprint'::text, 'digital'::text])))`
- `farmer_consents_updated_at_not_null`: `NOT NULL updated_at`

## farmer_verifications

Append-only historical checks; corrections/rechecks insert new rows.

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` |
| `farmer_id` | `uuid` | NO | `—` |
| `national_id_verified` | `bool` | NO | `false` |
| `kra_pin_verified` | `bool` | NO | `false` |
| `primary_phone_verified` | `bool` | NO | `false` |
| `mpesa_number_verified` | `bool` | NO | `false` |
| `mpesa_registered_name_confirmed` | `bool` | NO | `false` |
| `registration_form_complete` | `bool` | NO | `false` |
| `consent_obtained` | `bool` | NO | `false` |
| `verified_by` | `text` | NO | `—` |
| `verified_at` | `timestamptz` | NO | `now()` |
| `notes` | `text` | YES | `—` |
| `created_at` | `timestamptz` | NO | `now()` |
| `updated_at` | `timestamptz` | NO | `now()` |

Constraints:

- `farmer_verifications_consent_obtained_not_null`: `NOT NULL consent_obtained`
- `farmer_verifications_created_at_not_null`: `NOT NULL created_at`
- `farmer_verifications_farmer_id_fkey`: `FOREIGN KEY (farmer_id) REFERENCES farmers(id) ON DELETE RESTRICT`
- `farmer_verifications_farmer_id_not_null`: `NOT NULL farmer_id`
- `farmer_verifications_id_not_null`: `NOT NULL id`
- `farmer_verifications_kra_pin_verified_not_null`: `NOT NULL kra_pin_verified`
- `farmer_verifications_mpesa_number_verified_not_null`: `NOT NULL mpesa_number_verified`
- `farmer_verifications_mpesa_registered_name_confirmed_not_null`: `NOT NULL mpesa_registered_name_confirmed`
- `farmer_verifications_national_id_verified_not_null`: `NOT NULL national_id_verified`
- `farmer_verifications_pkey`: `PRIMARY KEY (id)`
- `farmer_verifications_primary_phone_verified_not_null`: `NOT NULL primary_phone_verified`
- `farmer_verifications_registration_form_complete_not_null`: `NOT NULL registration_form_complete`
- `farmer_verifications_updated_at_not_null`: `NOT NULL updated_at`
- `farmer_verifications_verified_at_not_null`: `NOT NULL verified_at`
- `farmer_verifications_verified_by_check`: `CHECK ((btrim(verified_by) <> ''::text))`
- `farmer_verifications_verified_by_not_null`: `NOT NULL verified_by`

## schema_migrations

Migration filenames, SHA256 checksums and application timestamps.

| Column | Type | Nullable | Default |
|---|---|---|---|
| `version` | `text` | NO | `—` |
| `checksum` | `text` | NO | `—` |
| `applied_at` | `timestamptz` | NO | `now()` |

Constraints:

- `schema_migrations_applied_at_not_null`: `NOT NULL applied_at`
- `schema_migrations_checksum_not_null`: `NOT NULL checksum`
- `schema_migrations_pkey`: `PRIMARY KEY (version)`
- `schema_migrations_version_not_null`: `NOT NULL version`

## Indexes and history rules

Unique constraints supply indexes on customer_id, national_id and kra_pin; multiple NULL identifiers are allowed. Nonblank trimmed national IDs and uppercase trimmed KRA PINs are enforced. No realistic format check is imposed yet. Do not enter blank strings.

The case-insensitive name index supports `lower(full_name) LIKE 'prefix%'`, not arbitrary substring search. Phone indexes support exact raw/normalized searches, registration_date supports ranges, and all child foreign keys are indexed. Latest consent/verification indexes support lateral queries. Partial unique indexes enforce one primary alternative and one active payment profile. Other fields are not indiscriminately indexed.

Update triggers preserve created_at and refresh updated_at on mutable tables. Verification timestamps remain fixed because updates/deletes are rejected. Consent payloads are immutable except a first withdrawal. Payment details changed in an UPDATE clear payment verification automatically. Identity UUID and customer_id cannot change after insert. Privileged administrators can still bypass protections; full change auditing remains future work.

## Summary view

farmer_registration_summary returns one row per farmer. It chooses the primary next-of-kin (otherwise newest), the active payment profile, and newest verification by verified_at, created_at, then UUID as deterministic tie-breaker. Verification status is not_verified / incomplete / verified based on all seven historical checks. It does not claim currently valid consent or payment eligibility. National ID, KRA PIN and addresses are omitted. Application authorization must restrict the remaining PII.
