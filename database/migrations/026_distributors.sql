CREATE SEQUENCE distributor_number AS bigint MINVALUE 1 NO CYCLE;

CREATE TABLE distributors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 distributor_code text NOT NULL UNIQUE DEFAULT ('D'||lpad(nextval('distributor_number')::text,4,'0')) CHECK (distributor_code ~ '^D[0-9]{4,}$'),
 name text NOT NULL CHECK (length(btrim(name)) > 0),
 record_type text NOT NULL CHECK (record_type IN ('distributor','store')),
 parent_id uuid REFERENCES distributors(id) ON DELETE RESTRICT,
 route_name text,
 manager_name text,
 phone_number text,
 location text,
 source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (parent_id IS NULL OR record_type='store'),
 CHECK (id IS DISTINCT FROM parent_id)
);
CREATE INDEX distributors_parent ON distributors(parent_id);
CREATE INDEX distributors_name ON distributors(lower(name));

CREATE TABLE distributor_source_rows (
 document_sha256 text NOT NULL CHECK (document_sha256 ~ '^[a-f0-9]{64}$'),
 sheet_name text NOT NULL,
 row_number integer NOT NULL CHECK (row_number > 0),
 distributor_id uuid NOT NULL REFERENCES distributors(id) ON DELETE RESTRICT,
 PRIMARY KEY (document_sha256,sheet_name,row_number)
);
CREATE INDEX distributor_source_rows_distributor ON distributor_source_rows(distributor_id);

CREATE TABLE distributor_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 distributor_id uuid NOT NULL REFERENCES distributors(id) ON DELETE RESTRICT,
 previous_state jsonb NOT NULL,
 new_state jsonb NOT NULL,
 actor text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION preserve_distributor_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.distributor_code IS DISTINCT FROM OLD.distributor_code OR
    NEW.record_type IS DISTINCT FROM OLD.record_type OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR
    NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256 THEN
  RAISE EXCEPTION 'Distributor identity and source are permanent';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distributors_identity BEFORE UPDATE ON distributors FOR EACH ROW EXECUTE FUNCTION preserve_distributor_identity();

ALTER TABLE milk_distributions ADD CONSTRAINT milk_distributions_distributor_fk FOREIGN KEY (distributor_id) REFERENCES distributors(id) ON DELETE RESTRICT;
CREATE INDEX milk_distributions_distributor ON milk_distributions(distributor_id,distributed_on DESC);
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
     NEW.bottles IS DISTINCT FROM OLD.bottles OR NEW.distributed_on IS DISTINCT FROM OLD.distributed_on OR
     NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
   RAISE EXCEPTION 'Distribution identity and quantities are permanent';
  END IF;
 END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON distributors,distributor_source_rows,distributor_audit FROM PUBLIC;
GRANT SELECT ON distributors,distributor_source_rows,distributor_audit TO satima_app;
GRANT UPDATE (name,route_name,manager_name,phone_number,location,updated_at) ON distributors TO satima_app;
GRANT INSERT ON distributor_audit TO satima_app;
GRANT USAGE ON SEQUENCE distributor_audit_id_seq TO satima_app;
