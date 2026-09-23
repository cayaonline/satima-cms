CREATE TABLE farmer_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 farmer_id uuid NOT NULL REFERENCES farmers(id) ON DELETE RESTRICT,
 contact_type text NOT NULL DEFAULT 'next_of_kin' CHECK (contact_type IN ('next_of_kin', 'alternative')),
 full_name text NOT NULL CHECK (btrim(full_name) <> ''),
 phone_number text NOT NULL CHECK (btrim(phone_number) <> ''),
 relationship text NOT NULL CHECK (btrim(relationship) <> ''),
 is_primary_alternative boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contacts_one_primary ON farmer_contacts(farmer_id) WHERE is_primary_alternative;
CREATE TABLE farmer_payment_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 farmer_id uuid NOT NULL REFERENCES farmers(id) ON DELETE RESTRICT,
 payment_method text NOT NULL DEFAULT 'mpesa' CHECK (payment_method = 'mpesa'),
 mpesa_registered_name text NOT NULL CHECK (btrim(mpesa_registered_name) <> ''),
 mpesa_phone_number text NOT NULL CHECK (btrim(mpesa_phone_number) <> ''),
 is_active boolean NOT NULL DEFAULT true,
 verified boolean NOT NULL DEFAULT false,
 verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (verified = (verified_at IS NOT NULL))
);
CREATE UNIQUE INDEX payments_one_active ON farmer_payment_profiles(farmer_id) WHERE is_active;
CREATE TRIGGER contacts_updated BEFORE UPDATE ON farmer_contacts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER payments_updated BEFORE UPDATE ON farmer_payment_profiles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
