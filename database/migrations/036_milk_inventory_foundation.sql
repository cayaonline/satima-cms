-- Separate, prospective stock ledger. No historical report or operational
-- transaction is backfilled into it by this migration.
CREATE TABLE milk_inventory_opening_balances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 stock_type text NOT NULL CHECK (stock_type IN ('raw','pasteurized')),
 quantity_liters numeric(16,6) NOT NULL CHECK (quantity_liters > 0),
 effective_on date NOT NULL,
 source_reference text NOT NULL CHECK (length(btrim(source_reference)) BETWEEN 3 AND 200),
 verification_notes text NOT NULL CHECK (length(btrim(verification_notes)) BETWEEN 10 AND 2000),
 proposed_by text NOT NULL,
 proposed_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 reviewed_by text,
 reviewed_at timestamptz,
 review_reason text,
 idempotency_key uuid NOT NULL UNIQUE,
 CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
   OR (status IN ('approved','rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
       AND review_reason IS NOT NULL AND length(btrim(review_reason)) BETWEEN 10 AND 500))
);
CREATE UNIQUE INDEX one_approved_milk_opening_per_type
 ON milk_inventory_opening_balances(stock_type) WHERE status='approved';

CREATE TABLE milk_inventory_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 stock_type text NOT NULL CHECK (stock_type IN ('raw','pasteurized')),
 inventory_state text NOT NULL DEFAULT 'available' CHECK (inventory_state IN ('available','quarantine')),
 movement_type text NOT NULL CHECK (movement_type IN
  ('opening_balance','raw_receipt','issue_to_processing','pasteurized_output',
   'distribution_dispatch','return_quarantine','return_release','rescue',
   'inhouse_use','rnd_use','waste','adjustment')),
 quantity_liters numeric(16,6) NOT NULL CHECK (quantity_liters <> 0),
 effective_on date NOT NULL,
 reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
 source_type text NOT NULL,
 source_id uuid NOT NULL,
 opening_balance_id uuid UNIQUE REFERENCES milk_inventory_opening_balances(id) ON DELETE RESTRICT,
 recorded_by text NOT NULL,
 approved_by text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((movement_type='opening_balance' AND quantity_liters>0 AND opening_balance_id IS NOT NULL
   AND source_type='approved_opening_balance' AND source_id=opening_balance_id AND approved_by IS NOT NULL)
   OR (movement_type<>'opening_balance' AND opening_balance_id IS NULL)),
 CHECK ((inventory_state='quarantine' AND stock_type='pasteurized' AND movement_type='return_quarantine')
   OR (inventory_state='available' AND movement_type<>'return_quarantine'))
);
CREATE INDEX milk_inventory_movements_order ON milk_inventory_movements(stock_type,effective_on,id);
CREATE UNIQUE INDEX milk_inventory_source_once ON milk_inventory_movements(source_type,source_id,movement_type,stock_type);

CREATE FUNCTION preserve_milk_inventory_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Inventory movements are append-only';
END $$;
CREATE TRIGGER milk_inventory_no_update BEFORE UPDATE OR DELETE ON milk_inventory_movements
 FOR EACH ROW EXECUTE FUNCTION preserve_milk_inventory_movement();

REVOKE ALL ON milk_inventory_opening_balances,milk_inventory_movements FROM PUBLIC;
GRANT SELECT ON milk_inventory_opening_balances,milk_inventory_movements TO satima_app;
GRANT INSERT ON milk_inventory_opening_balances,milk_inventory_movements TO satima_app;
GRANT UPDATE (status,reviewed_by,reviewed_at,review_reason) ON milk_inventory_opening_balances TO satima_app;
