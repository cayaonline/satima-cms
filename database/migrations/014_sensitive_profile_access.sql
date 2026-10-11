-- Record each successful elevated read without copying sensitive profile contents.
CREATE TABLE farmer_sensitive_access_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 farmer_id uuid NOT NULL REFERENCES farmers(id) ON DELETE RESTRICT,
 viewer_username text NOT NULL,
 accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX farmer_sensitive_access_farmer ON farmer_sensitive_access_events(farmer_id,accessed_at DESC);
GRANT INSERT ON farmer_sensitive_access_events TO satima_app;
GRANT USAGE ON SEQUENCE farmer_sensitive_access_events_id_seq TO satima_app;
