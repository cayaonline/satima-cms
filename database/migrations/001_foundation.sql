-- UUID generation is built into PostgreSQL; no extension is necessary.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TYPE farmer_status AS ENUM ('active', 'inactive', 'suspended', 'pending_verification');
CREATE SEQUENCE farmer_customer_number AS bigint MINVALUE 1 NO CYCLE;
CREATE FUNCTION next_farmer_customer_id() RETURNS text LANGUAGE sql VOLATILE AS $$
 SELECT 'SF-F-' || CASE WHEN length(n::text) < 4 THEN lpad(n::text, 4, '0') ELSE n::text END
 FROM (SELECT nextval('farmer_customer_number') AS n) s;
$$;
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.created_at := OLD.created_at;
 NEW.updated_at := clock_timestamp();
 RETURN NEW;
END $$;
CREATE FUNCTION reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Verification history is append-only; insert a new verification record';
END $$;
