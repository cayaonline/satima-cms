-- Private, persistent PDF archive. The master bytes are immutable after insert;
-- only protected two-page (or otherwise bounded) extracts are served to viewers.
CREATE TABLE registration_archive_batches (
 id text PRIMARY KEY CHECK (id ~ '^[A-Z0-9-]{3,40}$'),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
 original_filename text NOT NULL CHECK (length(btrim(original_filename)) BETWEEN 1 AND 200),
 sha256 text NOT NULL UNIQUE CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 pdf_data bytea NOT NULL CHECK (octet_length(pdf_data) BETWEEN 1 AND 83886080),
 page_count integer NOT NULL CHECK (page_count BETWEEN 1 AND 500),
 expected_farmer_count integer NOT NULL CHECK (expected_farmer_count BETWEEN 1 AND 500),
 source_format text NOT NULL DEFAULT 'PDF' CHECK (source_format='PDF'),
 registration_type text NOT NULL DEFAULT 'Original physical registration forms',
 document_status text NOT NULL DEFAULT 'Archived' CHECK (document_status='Archived'),
 archived_at timestamptz NOT NULL DEFAULT now(),
 uploaded_by text NOT NULL
);
CREATE TABLE registration_archive_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id text NOT NULL REFERENCES registration_archive_batches(id) ON DELETE RESTRICT,
 farmer_id uuid REFERENCES farmers(id) ON DELETE RESTRICT,
 page_start integer NOT NULL CHECK (page_start > 0),
 page_end integer NOT NULL CHECK (page_end >= page_start),
 verification_status text NOT NULL DEFAULT 'unmatched'
  CHECK (verification_status IN ('unmatched','needs_review','matched','verified')),
 isolated_pdf bytea NOT NULL CHECK (octet_length(isolated_pdf) BETWEEN 1 AND 83886080),
 isolated_sha256 text NOT NULL CHECK (isolated_sha256 ~ '^[a-f0-9]{64}$'),
 associated_at timestamptz NOT NULL DEFAULT now(),
 associated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(batch_id,page_start,page_end),
 CHECK ((farmer_id IS NULL AND verification_status IN ('unmatched','needs_review'))
     OR (farmer_id IS NOT NULL AND verification_status IN ('matched','verified','needs_review')))
);
CREATE INDEX registration_archive_entries_farmer ON registration_archive_entries(farmer_id,associated_at DESC);
CREATE TABLE registration_archive_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 batch_id text NOT NULL REFERENCES registration_archive_batches(id) ON DELETE RESTRICT,
 entry_id uuid REFERENCES registration_archive_entries(id) ON DELETE RESTRICT,
 actor_role text NOT NULL CHECK (actor_role IN ('administrator','registration_viewer')),
 action text NOT NULL CHECK (action IN ('upload','associate','reassociate','view','download')),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT ON registration_archive_batches TO satima_app;
GRANT SELECT,INSERT,UPDATE ON registration_archive_entries TO satima_app;
GRANT INSERT ON registration_archive_events TO satima_app;
GRANT USAGE ON SEQUENCE registration_archive_events_id_seq TO satima_app;
