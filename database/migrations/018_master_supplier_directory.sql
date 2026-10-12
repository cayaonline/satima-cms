-- Keep earlier farmer records without including them in the current supplier directory.
ALTER TABLE farmers ADD COLUMN master_list_status text NOT NULL DEFAULT 'current'
 CHECK (master_list_status IN ('current','historical','pending_review'));
CREATE INDEX farmers_master_list_status ON farmers(record_kind,master_list_status,category);

-- Private provenance for every source row, including rows that cannot identify a farmer.
CREATE TABLE farmer_master_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_sha256 text NOT NULL CHECK (document_sha256 ~ '^[a-f0-9]{64}$'),
 document_name text NOT NULL,
 sheet_name text NOT NULL,
 row_number integer NOT NULL CHECK (row_number > 0),
 source_name text NOT NULL,
 source_phone text,
 source_category text CHECK (source_category IN ('Satima Farmers','Larger Sagana Farmers','Kangema Farmers','Others')),
 farmer_id uuid REFERENCES farmers(id) ON DELETE RESTRICT,
 match_result text NOT NULL CHECK (match_result IN ('matched','added','review_required','non_farmer','unidentified')),
 review_reason text,
 imported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_sha256,sheet_name,row_number)
);
CREATE INDEX farmer_master_sources_farmer ON farmer_master_sources(farmer_id);
REVOKE ALL ON farmer_master_sources FROM PUBLIC;
