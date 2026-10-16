-- Decisions are retained even after a row leaves the active review queue.
CREATE TABLE farmer_master_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_id uuid NOT NULL REFERENCES farmer_master_sources(id) ON DELETE RESTRICT,
 farmer_id uuid REFERENCES farmers(id) ON DELETE RESTRICT,
 decision text NOT NULL CHECK (decision IN ('match','create','defer')),
 approved_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
 note text,
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX farmer_master_reviews_source ON farmer_master_reviews(source_id,created_at DESC);
CREATE UNIQUE INDEX farmer_master_reviews_final ON farmer_master_reviews(source_id)
 WHERE decision IN ('match','create');
REVOKE ALL ON farmer_master_reviews FROM PUBLIC;
GRANT SELECT,INSERT ON farmer_master_reviews TO satima_app;
GRANT SELECT (document_name,sheet_name,source_phone,farmer_id,review_reason)
 ON farmer_master_sources TO satima_app;
GRANT UPDATE (farmer_id,match_result,review_reason) ON farmer_master_sources TO satima_app;
