CREATE SEQUENCE milk_processing_number AS bigint MINVALUE 1 NO CYCLE;
CREATE SEQUENCE milk_distribution_number AS bigint MINVALUE 1 NO CYCLE;

CREATE TABLE milk_quality_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 collection_id uuid NOT NULL UNIQUE REFERENCES milk_collections(id) ON DELETE RESTRICT,
 accepted_liters numeric(16,6) NOT NULL CHECK (accepted_liters >= 0),
 rejected_liters numeric(16,6) NOT NULL CHECK (rejected_liters >= 0),
 rejection_reason text CHECK (rejection_reason IN ('Failed Quality Test','Contamination','Spoilage','Temperature Issue','Suspected Adulteration','Other')),
 notes text,
 inspected_on date NOT NULL,
 inspected_by text NOT NULL CHECK (length(btrim(inspected_by)) > 0),
 recorded_by text NOT NULL CHECK (length(btrim(recorded_by)) > 0),
 source_portal text NOT NULL CHECK (source_portal IN ('Admin','Operations')),
 idempotency_key uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (rejected_liters = 0 OR rejection_reason IS NOT NULL),
 CHECK (rejection_reason IS DISTINCT FROM 'Other' OR length(btrim(coalesce(notes,''))) > 0)
);

CREATE TABLE milk_processing_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id text NOT NULL UNIQUE DEFAULT ('MP'||lpad(nextval('milk_processing_number')::text,6,'0')),
 processed_on date NOT NULL,
 input_liters numeric(16,6) NOT NULL CHECK (input_liters > 0),
 processed_liters numeric(16,6) NOT NULL CHECK (processed_liters >= 0 AND processed_liters <= input_liters),
 bottled_liters numeric(16,6) NOT NULL CHECK (bottled_liters >= 0 AND bottled_liters <= processed_liters),
 product_format text NOT NULL CHECK (length(btrim(product_format)) > 0),
 bottle_size_ml integer NOT NULL CHECK (bottle_size_ml > 0),
 bottles_produced integer NOT NULL CHECK (bottles_produced >= 0),
 notes text,
 operator_name text NOT NULL CHECK (length(btrim(operator_name)) > 0),
 recorded_by text NOT NULL CHECK (length(btrim(recorded_by)) > 0),
 source_portal text NOT NULL CHECK (source_portal IN ('Admin','Operations')),
 idempotency_key uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (bottled_liters = bottles_produced::numeric * bottle_size_ml / 1000)
);

CREATE TABLE milk_batch_allocations (
 batch_id uuid NOT NULL REFERENCES milk_processing_batches(id) ON DELETE RESTRICT,
 collection_id uuid NOT NULL REFERENCES milk_collections(id) ON DELETE RESTRICT,
 quantity_liters numeric(16,6) NOT NULL CHECK (quantity_liters > 0),
 PRIMARY KEY (batch_id,collection_id)
);
CREATE INDEX milk_batch_allocations_collection ON milk_batch_allocations(collection_id);

CREATE TABLE milk_distributions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 distribution_id text NOT NULL UNIQUE DEFAULT ('MD'||lpad(nextval('milk_distribution_number')::text,6,'0')),
 batch_id uuid NOT NULL REFERENCES milk_processing_batches(id) ON DELETE RESTRICT,
 customer_id uuid REFERENCES customers(id) ON DELETE RESTRICT,
 distributor_id uuid,
 recipient_type text NOT NULL CHECK (recipient_type IN ('customer','distributor')),
 distributed_on date NOT NULL,
 bottles integer NOT NULL CHECK (bottles > 0),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','dispatched','delivered','cancelled')),
 notes text,
 reference text,
 operator_name text NOT NULL CHECK (length(btrim(operator_name)) > 0),
 recorded_by text NOT NULL CHECK (length(btrim(recorded_by)) > 0),
 source_portal text NOT NULL CHECK (source_portal IN ('Admin','Operations')),
 idempotency_key uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((recipient_type='customer' AND customer_id IS NOT NULL AND distributor_id IS NULL) OR
        (recipient_type='distributor' AND distributor_id IS NOT NULL AND customer_id IS NULL))
);
CREATE INDEX milk_distributions_batch ON milk_distributions(batch_id);
CREATE INDEX milk_distributions_customer ON milk_distributions(customer_id,distributed_on DESC);

CREATE FUNCTION preserve_milk_operation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME = 'milk_quality_checks' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.collection_id IS DISTINCT FROM OLD.collection_id OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
   RAISE EXCEPTION 'Quality assessment identity is permanent';
  END IF;
 END IF;
 IF TG_TABLE_NAME = 'milk_distributions' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.distribution_id IS DISTINCT FROM OLD.distribution_id OR
     NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR
     NEW.recipient_type IS DISTINCT FROM OLD.recipient_type OR NEW.bottles IS DISTINCT FROM OLD.bottles OR
     NEW.distributed_on IS DISTINCT FROM OLD.distributed_on OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
   RAISE EXCEPTION 'Distribution identity and quantities are permanent';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER quality_identity BEFORE UPDATE ON milk_quality_checks FOR EACH ROW EXECUTE FUNCTION preserve_milk_operation_identity();
CREATE TRIGGER distribution_identity BEFORE UPDATE ON milk_distributions FOR EACH ROW EXECUTE FUNCTION preserve_milk_operation_identity();

CREATE TABLE milk_operation_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 entity_type text NOT NULL CHECK (entity_type IN ('quality','distribution')),
 entity_id uuid NOT NULL,
 previous_state jsonb,
 new_state jsonb NOT NULL,
 actor text NOT NULL,
 source_portal text NOT NULL CHECK (source_portal IN ('Admin','Operations')),
 changed_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON milk_quality_checks,milk_processing_batches,milk_batch_allocations,milk_distributions,milk_operation_audit FROM PUBLIC;
GRANT SELECT,INSERT ON milk_quality_checks,milk_distributions TO satima_app;
GRANT UPDATE (accepted_liters,rejected_liters,rejection_reason,notes,inspected_on,inspected_by,recorded_by,source_portal,updated_at) ON milk_quality_checks TO satima_app;
GRANT UPDATE (status,updated_at) ON milk_distributions TO satima_app;
GRANT SELECT,INSERT ON milk_processing_batches,milk_batch_allocations,milk_operation_audit TO satima_app;
GRANT USAGE ON SEQUENCE milk_processing_number,milk_distribution_number,milk_operation_audit_id_seq TO satima_app;
