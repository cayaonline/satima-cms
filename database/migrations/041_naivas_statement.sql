-- Immutable retailer evidence; originals are never granted to the runtime role.
CREATE TABLE collections_source_files (
 dataset_id text PRIMARY KEY REFERENCES collections_datasets(id),
 filename text NOT NULL,
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 original_bytes bytea NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE collections_retail_statements (
 dataset_id text PRIMARY KEY,
 channel text NOT NULL DEFAULT 'distributors_stores' CHECK (channel='distributors_stores'),
 retailer_code text NOT NULL REFERENCES collections_retailers(code),
 period_start date NOT NULL,
 period_end date NOT NULL CHECK (period_end>=period_start),
 payload jsonb NOT NULL,
 FOREIGN KEY(dataset_id,channel) REFERENCES collections_datasets(id,channel)
);
ALTER TABLE collections_retail_records ADD COLUMN source_row integer CHECK(source_row>0);
ALTER TABLE collections_retail_records ADD COLUMN purchase_order text;
ALTER TABLE collections_retail_records ADD COLUMN raw_source jsonb;
ALTER TABLE collections_retail_records ADD COLUMN quality_flags jsonb NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX collections_retail_source_row ON collections_retail_records(dataset_id,source_row) WHERE source_row IS NOT NULL;
ALTER TABLE collections_retail_exceptions ADD COLUMN dataset_id text REFERENCES collections_retail_statements(dataset_id);
ALTER TABLE collections_retail_exceptions ADD COLUMN code text;
ALTER TABLE collections_retail_exceptions ADD COLUMN source_rows integer[];
CREATE TRIGGER immutable_collections_source_files BEFORE UPDATE OR DELETE OR TRUNCATE ON collections_source_files
 FOR EACH STATEMENT EXECUTE FUNCTION protect_october_evidence();
CREATE TRIGGER immutable_retail_statements BEFORE UPDATE OR DELETE OR TRUNCATE ON collections_retail_statements
 FOR EACH STATEMENT EXECUTE FUNCTION protect_october_evidence();
CREATE TRIGGER immutable_retail_source_records BEFORE UPDATE OR DELETE OR TRUNCATE ON collections_retail_records
 FOR EACH STATEMENT EXECUTE FUNCTION protect_october_evidence();
REVOKE ALL ON collections_source_files,collections_retail_statements FROM PUBLIC,satima_app;
GRANT SELECT ON collections_retail_statements TO satima_app;
