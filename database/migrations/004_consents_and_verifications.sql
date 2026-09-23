CREATE TABLE farmer_consents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 farmer_id uuid NOT NULL REFERENCES farmers(id) ON DELETE RESTRICT,
 consent_version text NOT NULL CHECK (btrim(consent_version) <> ''),
 information_accuracy_confirmed boolean NOT NULL,
 data_processing_consent boolean NOT NULL,
 communications_consent boolean NOT NULL,
 consent_given boolean NOT NULL,
 signed_name text,
 signature_method text CHECK (signature_method IN ('signature', 'thumbprint', 'digital')),
 consent_date timestamptz NOT NULL,
 withdrawn_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (NOT consent_given OR (information_accuracy_confirmed AND data_processing_consent
        AND signed_name IS NOT NULL AND btrim(signed_name) <> '' AND signature_method IS NOT NULL)),
 CHECK (withdrawn_at IS NULL OR (consent_given AND withdrawn_at >= consent_date))
);
-- Consent evidence is immutable except for a one-time withdrawal timestamp.
CREATE FUNCTION protect_consent_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Consent evidence cannot be deleted'; END IF;
 IF (to_jsonb(NEW) - 'withdrawn_at' - 'updated_at') IS DISTINCT FROM
    (to_jsonb(OLD) - 'withdrawn_at' - 'updated_at') OR
    (OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at) THEN
   RAISE EXCEPTION 'Insert new consent evidence; only first withdrawal is allowed';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consents_evidence BEFORE UPDATE OR DELETE ON farmer_consents FOR EACH ROW EXECUTE FUNCTION protect_consent_evidence();
CREATE TRIGGER consents_updated BEFORE UPDATE ON farmer_consents FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TABLE farmer_verifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 farmer_id uuid NOT NULL REFERENCES farmers(id) ON DELETE RESTRICT,
 national_id_verified boolean NOT NULL DEFAULT false,
 kra_pin_verified boolean NOT NULL DEFAULT false,
 primary_phone_verified boolean NOT NULL DEFAULT false,
 mpesa_number_verified boolean NOT NULL DEFAULT false,
 mpesa_registered_name_confirmed boolean NOT NULL DEFAULT false,
 registration_form_complete boolean NOT NULL DEFAULT false,
 consent_obtained boolean NOT NULL DEFAULT false,
 verified_by text NOT NULL CHECK (btrim(verified_by) <> ''),
 verified_at timestamptz NOT NULL DEFAULT now(),
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER verifications_immutable BEFORE UPDATE OR DELETE ON farmer_verifications
 FOR EACH ROW EXECUTE FUNCTION reject_history_change();
