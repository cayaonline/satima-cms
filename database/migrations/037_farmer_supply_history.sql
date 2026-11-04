-- Source-granular farmer supply history. These rows are historical report evidence,
-- not operational milk_collections and must not create inventory movements.
CREATE TABLE farmer_supply_import_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_filename text NOT NULL,
 source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
 normalized_sha256 text NOT NULL CHECK (normalized_sha256 ~ '^[a-f0-9]{64}$'),
 source_worksheet text NOT NULL,
 actor text NOT NULL CHECK (btrim(actor) <> ''),
 revision_reason text,
 imported_at timestamptz NOT NULL DEFAULT now(),
 record_count integer NOT NULL CHECK (record_count > 0),
 status text NOT NULL DEFAULT 'committed' CHECK (status='committed'),
 UNIQUE (source_sha256,normalized_sha256)
);

CREATE TABLE farmer_supply_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 import_batch_id uuid NOT NULL REFERENCES farmer_supply_import_batches(id) ON DELETE RESTRICT,
 farmer_id uuid REFERENCES farmers(id) ON DELETE RESTRICT,
 source_row integer NOT NULL CHECK (source_row > 0),
 source_name text NOT NULL CHECK (btrim(source_name) <> ''),
 source_phone text,
 normalized_phone text CHECK (normalized_phone IS NULL OR normalized_phone ~ '^\\+[1-9][0-9]{7,14}$'),
 source_category text NOT NULL CHECK (btrim(source_category) <> ''),
 supply_date date NOT NULL,
 quantity_liters numeric(16,6) CHECK (quantity_liters IS NULL OR quantity_liters >= 0),
 original_value text,
 match_status text NOT NULL CHECK (match_status IN ('matched','review','unmatched')),
 is_current boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((match_status='matched' AND farmer_id IS NOT NULL) OR match_status<>'matched'),
 UNIQUE (import_batch_id,source_row,supply_date,revision)
);
CREATE UNIQUE INDEX farmer_supply_current_source_row ON farmer_supply_history(source_row,supply_date) WHERE is_current;
CREATE INDEX farmer_supply_farmer_date ON farmer_supply_history(farmer_id,supply_date DESC) WHERE is_current;
CREATE INDEX farmer_supply_review ON farmer_supply_history(match_status) WHERE is_current AND match_status<>'matched';

REVOKE ALL ON farmer_supply_import_batches,farmer_supply_history FROM PUBLIC;
GRANT SELECT ON farmer_supply_import_batches,farmer_supply_history TO satima_app;
