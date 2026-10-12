-- Official KRA checks are historical evidence, separate from the paper-form verification flag.
ALTER TABLE farmers ADD COLUMN kra_pin_format text GENERATED ALWAYS AS (
 CASE WHEN kra_pin IS NULL OR btrim(kra_pin)='' THEN 'missing'
 WHEN upper(btrim(kra_pin)) ~ '^[AP][0-9]{9}[A-Z]$' THEN 'valid'
 ELSE 'invalid' END
) STORED;
CREATE TABLE farmer_kra_verifications (
 id bigserial PRIMARY KEY,
 farmer_id uuid NOT NULL REFERENCES farmers(id) ON DELETE RESTRICT,
 pin_snapshot text NOT NULL,
 previous_status text NOT NULL CHECK (previous_status IN ('pending','verified','failed','unavailable','needs_review')),
 outcome text NOT NULL CHECK (outcome IN ('verified','failed','unavailable','needs_review')),
 taxpayer_name text,
 pin_status text,
 name_match text NOT NULL CHECK (name_match IN ('exact','possible','mismatch','not_checked')),
 method text NOT NULL CHECK (method IN ('manual_checker')),
 checked_at date NOT NULL,
 checked_by text NOT NULL,
 remarks text,
 evidence_reference text,
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX farmer_kra_verifications_latest ON farmer_kra_verifications(farmer_id,created_at DESC,id DESC);
CREATE INDEX farmers_kra_format ON farmers(kra_pin_format) WHERE record_kind='registered';
GRANT SELECT,INSERT ON farmer_kra_verifications TO satima_app;
GRANT USAGE ON SEQUENCE farmer_kra_verifications_id_seq TO satima_app;
