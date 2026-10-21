-- Existing D codes remain permanent legacy references. Stores receive an
-- independent S-series public identity, ordered by their original D codes.
CREATE SEQUENCE store_number AS bigint MINVALUE 1 NO CYCLE;
ALTER TABLE distributors ADD COLUMN store_code text;
WITH numbered AS (
 SELECT id,row_number() OVER (ORDER BY substring(distributor_code FROM 2)::bigint,id) AS n
 FROM distributors WHERE record_type='store'
)
UPDATE distributors d SET store_code='S'||lpad(numbered.n::text,4,'0')
FROM numbered WHERE numbered.id=d.id;
SELECT setval('store_number',greatest((SELECT count(*) FROM distributors WHERE record_type='store'),1),
 (SELECT count(*)>0 FROM distributors WHERE record_type='store'));

ALTER TABLE distributors DROP CONSTRAINT distributors_distributor_code_check;
ALTER TABLE distributors ALTER COLUMN distributor_code DROP DEFAULT;
ALTER TABLE distributors ADD CONSTRAINT distributors_typed_code CHECK (
 (record_type='distributor' AND distributor_code ~ '^D[0-9]{4,}$' AND store_code IS NULL)
 OR (record_type='store' AND distributor_code ~ '^[DS][0-9]{4,}$' AND store_code ~ '^S[0-9]{4,}$')
);
CREATE UNIQUE INDEX distributors_store_code_unique ON distributors(store_code) WHERE store_code IS NOT NULL;

CREATE FUNCTION assign_distributor_public_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.record_type='store' THEN
  IF NEW.store_code IS NULL THEN NEW.store_code:='S'||lpad(nextval('store_number')::text,4,'0'); END IF;
  IF NEW.distributor_code IS NULL THEN NEW.distributor_code:=NEW.store_code; END IF;
 ELSIF NEW.record_type='distributor' THEN
  IF NEW.distributor_code IS NULL THEN NEW.distributor_code:='D'||lpad(nextval('distributor_number')::text,4,'0'); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distributors_public_code BEFORE INSERT ON distributors
 FOR EACH ROW EXECUTE FUNCTION assign_distributor_public_code();

CREATE OR REPLACE FUNCTION preserve_distributor_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.distributor_code IS DISTINCT FROM OLD.distributor_code OR
    NEW.store_code IS DISTINCT FROM OLD.store_code OR NEW.record_type IS DISTINCT FROM OLD.record_type OR
    NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256 THEN
  RAISE EXCEPTION 'Distributor identity and source are permanent';
 END IF;
 RETURN NEW;
END $$;
