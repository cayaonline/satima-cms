ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender_source text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender_verified_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS suggested_gender text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender_suggestion_status text NOT NULL DEFAULT 'not_reviewed';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender_suggestion_source text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender_suggestion_reason text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender_reviewed_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='customers_gender_suggestion_values') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_gender_suggestion_values CHECK (suggested_gender IN ('male','female') OR suggested_gender IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='customers_gender_review_status_values') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_gender_review_status_values CHECK (gender_suggestion_status IN ('not_reviewed','pending_review','accepted','rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='customers_gender_source_values') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_gender_source_values CHECK (gender_source IS NULL OR gender_source IN ('manual_confirmation','source_document'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION touch_customer_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS customers_updated_at ON customers;
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION touch_customer_updated_at();

CREATE TABLE IF NOT EXISTS customer_audit (
  id bigserial PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  previous_state jsonb NOT NULL,
  new_state jsonb NOT NULL,
  actor text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_audit_customer_changed ON customer_audit(customer_id,changed_at DESC);

GRANT SELECT (id,customer_id,full_name,physical_address,phone_number,gender,category,updated_at,gender_source,gender_verified_at,suggested_gender,gender_suggestion_status,gender_suggestion_source,gender_suggestion_reason,gender_reviewed_at) ON customers TO satima_app;
GRANT UPDATE (full_name,physical_address,phone_number,gender,category,gender_source,gender_verified_at,suggested_gender,gender_suggestion_status,gender_suggestion_reason,gender_reviewed_at,updated_at) ON customers TO satima_app;
GRANT INSERT ON customer_audit TO satima_app;
GRANT USAGE,SELECT ON SEQUENCE customer_audit_id_seq TO satima_app;
