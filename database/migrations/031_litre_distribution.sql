-- Preserve historical bottle evidence while making litres the operational quantity.
ALTER TABLE milk_processing_batches
  ALTER COLUMN bottled_liters DROP NOT NULL,
  ALTER COLUMN bottle_size_ml DROP NOT NULL,
  ALTER COLUMN bottles_produced DROP NOT NULL;

ALTER TABLE milk_distributions ADD COLUMN quantity_liters numeric(16,6);
UPDATE milk_distributions d
SET quantity_liters = d.bottles::numeric * b.bottle_size_ml::numeric / 1000
FROM milk_processing_batches b
WHERE b.id = d.batch_id;
-- An old application instance may briefly remain live during a rolling deploy.
-- Keep its bottle-based inserts compatible until every instance is replaced.
CREATE FUNCTION set_legacy_distribution_liters() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.quantity_liters IS NULL AND NEW.bottles IS NOT NULL THEN
  SELECT NEW.bottles::numeric * bottle_size_ml::numeric / 1000
  INTO NEW.quantity_liters FROM milk_processing_batches WHERE id = NEW.batch_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_legacy_liters BEFORE INSERT ON milk_distributions
 FOR EACH ROW EXECUTE FUNCTION set_legacy_distribution_liters();
ALTER TABLE milk_distributions
  ALTER COLUMN quantity_liters SET NOT NULL,
  ALTER COLUMN bottles DROP NOT NULL,
  ADD CONSTRAINT milk_distributions_positive_liters CHECK (quantity_liters > 0);
CREATE INDEX milk_distributions_batch_committed ON milk_distributions(batch_id,status)
  WHERE status IN ('dispatched','delivered');

CREATE OR REPLACE FUNCTION preserve_milk_operation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME = 'milk_quality_checks' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.collection_id IS DISTINCT FROM OLD.collection_id OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
   RAISE EXCEPTION 'Quality assessment identity is permanent';
  END IF;
 END IF;
 IF TG_TABLE_NAME = 'milk_distributions' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.distribution_id IS DISTINCT FROM OLD.distribution_id OR
     NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR
     NEW.distributor_id IS DISTINCT FROM OLD.distributor_id OR NEW.recipient_type IS DISTINCT FROM OLD.recipient_type OR
     NEW.bottles IS DISTINCT FROM OLD.bottles OR NEW.quantity_liters IS DISTINCT FROM OLD.quantity_liters OR
     NEW.distributed_on IS DISTINCT FROM OLD.distributed_on OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
   RAISE EXCEPTION 'Distribution identity and quantities are permanent';
  END IF;
 END IF;
 RETURN NEW;
END $$;

GRANT INSERT(quantity_liters) ON milk_distributions TO satima_app;
