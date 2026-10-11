-- Existing records retain an explicit unknown state until an administrator checks a source.
ALTER TABLE farmers ADD COLUMN gender text NOT NULL DEFAULT 'not_verified'
 CHECK (gender IN ('male','female','not_verified'));
ALTER TABLE farmers ADD COLUMN gender_source text
 CHECK (gender_source IN ('registration_document','farmer_confirmation'));
ALTER TABLE farmers ADD COLUMN gender_verified_at timestamptz;
ALTER TABLE farmers ADD CONSTRAINT farmer_gender_evidence CHECK (
 (gender='not_verified' AND gender_source IS NULL AND gender_verified_at IS NULL)
 OR (gender IN ('male','female') AND gender_source IS NOT NULL AND gender_verified_at IS NOT NULL)
);
CREATE INDEX farmers_gender ON farmers(record_kind,gender);

-- Binary data is separate from farmer records and never exposed by directory/detail JSON.
-- A database backup includes photographs; Render's ephemeral filesystem is not used.
CREATE TABLE farmer_photographs (
 farmer_id uuid PRIMARY KEY REFERENCES farmers(id) ON DELETE RESTRICT,
 content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
 image_data bytea NOT NULL CHECK (octet_length(image_data) BETWEEN 1 AND 2097152),
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON farmer_photographs TO satima_app;
