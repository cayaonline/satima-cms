CREATE TABLE milk_collection_audit (
 id bigserial PRIMARY KEY,
 collection_id uuid NOT NULL REFERENCES milk_collections(id) ON DELETE RESTRICT,
 previous_state jsonb NOT NULL,
 new_state jsonb NOT NULL,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 500),
 actor text NOT NULL,
 source_portal text NOT NULL CHECK (source_portal IN ('Admin','Operations')),
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX milk_collection_audit_collection_time ON milk_collection_audit(collection_id,changed_at DESC,id DESC);
REVOKE ALL ON milk_collection_audit FROM PUBLIC;
GRANT SELECT,INSERT ON milk_collection_audit TO satima_app;
GRANT USAGE ON SEQUENCE milk_collection_audit_id_seq TO satima_app;
GRANT UPDATE(farmer_id,supplier_category_at_collection,quantity_liters,date_received,updated_at) ON milk_collections TO satima_app;
