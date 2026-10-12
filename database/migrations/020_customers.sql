CREATE SEQUENCE customer_number AS bigint MINVALUE 1 NO CYCLE;

CREATE FUNCTION next_customer_id() RETURNS text LANGUAGE sql VOLATILE AS $$
 SELECT 'C'||lpad(nextval('customer_number')::text,4,'0')
$$;

CREATE TABLE customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 customer_id text NOT NULL UNIQUE DEFAULT next_customer_id() CHECK (customer_id ~ '^C[0-9]{4,}$'),
 full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
 physical_address text,
 phone_number text,
 gender text CHECK (gender IN ('male','female')),
 source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION preserve_customer_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
  RAISE EXCEPTION 'Customer identifiers are permanent';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customers_identity BEFORE UPDATE ON customers
 FOR EACH ROW EXECUTE FUNCTION preserve_customer_identity();

CREATE TABLE customer_source_rows (
 document_sha256 text NOT NULL CHECK (document_sha256 ~ '^[a-f0-9]{64}$'),
 sheet_name text NOT NULL,
 row_number integer NOT NULL CHECK (row_number > 0),
 customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 PRIMARY KEY (document_sha256,sheet_name,row_number)
);
CREATE INDEX customer_source_rows_customer ON customer_source_rows(customer_id);

REVOKE ALL ON customers, customer_source_rows FROM PUBLIC;
GRANT SELECT (id,customer_id,full_name,physical_address,phone_number,gender) ON customers TO satima_app;
