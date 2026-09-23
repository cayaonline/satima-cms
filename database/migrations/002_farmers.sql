CREATE TABLE farmers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 customer_id text NOT NULL UNIQUE DEFAULT next_farmer_customer_id()
   CHECK (customer_id ~ '^SF-F-[0-9]{4,}$'),
 registered_business_name text,
 full_name text NOT NULL CHECK (btrim(full_name) <> ''),
 national_id text UNIQUE CHECK (national_id IS NULL OR (national_id = btrim(national_id) AND national_id <> '')),
 primary_phone text NOT NULL CHECK (btrim(primary_phone) <> ''),
 primary_phone_normalized text CHECK (primary_phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
 physical_address text,
 village_area text,
 sub_location text,
 location text,
 sub_county text,
 county text,
 kra_pin text UNIQUE CHECK (kra_pin IS NULL OR (kra_pin = upper(btrim(kra_pin)) AND kra_pin <> '')),
 registration_date date NOT NULL DEFAULT CURRENT_DATE,
 registered_by text NOT NULL CHECK (btrim(registered_by) <> ''),
 status farmer_status NOT NULL DEFAULT 'pending_verification',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Business and relational identity must remain stable. Import overrides require a migration.
CREATE FUNCTION protect_farmer_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
  RAISE EXCEPTION 'Farmer identifiers are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER farmers_identity BEFORE UPDATE ON farmers FOR EACH ROW EXECUTE FUNCTION protect_farmer_identity();
CREATE TRIGGER farmers_updated BEFORE UPDATE ON farmers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
