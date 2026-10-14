CREATE SEQUENCE milk_collection_number AS bigint MINVALUE 1 NO CYCLE;

CREATE FUNCTION next_milk_collection_id() RETURNS text LANGUAGE sql VOLATILE AS $$
 SELECT 'MC'||lpad(nextval('milk_collection_number')::text,6,'0')
$$;

CREATE TABLE milk_collections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 collection_id text NOT NULL UNIQUE DEFAULT next_milk_collection_id() CHECK (collection_id ~ '^MC[0-9]{6,}$'),
 farmer_id uuid NOT NULL REFERENCES farmers(id) ON DELETE RESTRICT,
 supplier_category_at_collection text,
 quantity_liters numeric(16,6) NOT NULL CHECK (quantity_liters > 0 AND quantity_liters < 1000000),
 date_received date NOT NULL,
 recorded_by text NOT NULL CHECK (length(btrim(recorded_by)) > 0),
 source_portal text NOT NULL CHECK (source_portal IN ('Admin','Operations')),
 idempotency_key uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX milk_collections_date_id ON milk_collections(date_received DESC,created_at DESC,id DESC);
CREATE INDEX milk_collections_farmer_date ON milk_collections(farmer_id,date_received DESC);

CREATE TABLE milk_collection_photos (
 collection_id uuid PRIMARY KEY REFERENCES milk_collections(id) ON DELETE RESTRICT,
 content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
 image_data bytea NOT NULL CHECK (octet_length(image_data)>0 AND octet_length(image_data)<=2097152),
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON milk_collections,milk_collection_photos FROM PUBLIC;
GRANT SELECT,INSERT ON milk_collections,milk_collection_photos TO satima_app;
GRANT USAGE ON SEQUENCE milk_collection_number TO satima_app;
