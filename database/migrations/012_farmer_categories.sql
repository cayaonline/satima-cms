-- Extend the existing farmer directory without assigning Farmer IDs to unregistered entries.
ALTER TABLE farmers ADD COLUMN category text
 CHECK (category IN ('Satima Farmers','Larger Sagana Farmers','Kangema Farmers','Others'));
ALTER TABLE farmers ADD COLUMN registration_status text NOT NULL DEFAULT 'registered'
 CHECK (registration_status IN ('registered','not_registered','review_required'));
ALTER TABLE farmers ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE farmers ALTER COLUMN primary_phone DROP NOT NULL;
ALTER TABLE farmers ALTER COLUMN registered_by DROP NOT NULL;
ALTER TABLE farmers ADD CONSTRAINT farmer_registration_identity CHECK (
 (registration_status='registered' AND customer_id IS NOT NULL AND registered_by IS NOT NULL)
 OR (registration_status IN ('not_registered','review_required') AND customer_id IS NULL AND registered_by IS NULL AND registration_date IS NULL AND status='pending_verification' AND record_kind='registered'));
CREATE OR REPLACE FUNCTION protect_farmer_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR
    (NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NOT
      (OLD.customer_id IS NULL AND NEW.customer_id ~ '^SF-F-[0-9]{4,}$'
       AND OLD.registration_status IN ('not_registered','review_required')
       AND NEW.registration_status='registered')) OR
    (OLD.registration_status='registered' AND NEW.registration_status<>'registered') THEN
  RAISE EXCEPTION 'Farmer identifiers and completed registration are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE INDEX farmers_category_registration ON farmers(record_kind,category,registration_status,created_at DESC);

-- One PDF listing may correspond to an existing farmer or an unregistered directory entry.
-- This provenance table contains only names and categories, never phones or milk quantities.
CREATE TABLE farmer_directory_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 farmer_id uuid NOT NULL REFERENCES farmers(id) ON DELETE RESTRICT,
 document_name text NOT NULL,
 document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[a-f0-9]{64}$'),
 page_number integer NOT NULL CHECK(page_number>0),
 row_number integer NOT NULL CHECK(row_number>0),
 source_name text NOT NULL,
 source_category text NOT NULL,
 match_result text NOT NULL CHECK(match_result IN ('matched','not_registered','review_required')),
 review_reason text,
 imported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_sha256,page_number,row_number)
);
CREATE INDEX farmer_directory_sources_farmer ON farmer_directory_sources(farmer_id);
GRANT SELECT ON farmer_directory_sources TO satima_app;
