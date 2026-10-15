-- Private, immutable provenance for repeatable master-directory imports.
CREATE TABLE master_sync_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entity text NOT NULL CHECK (entity IN ('farmers','customers','distributors')),
 source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
 plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
 row_count integer NOT NULL CHECK (row_count >= 0),
 applied_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (entity,source_sha256)
);
CREATE TABLE master_sync_rows (
 run_id uuid NOT NULL REFERENCES master_sync_runs(id) ON DELETE RESTRICT,
 source_row integer NOT NULL CHECK (source_row > 1),
 result text NOT NULL CHECK (result IN ('updated','unchanged','added','review')),
 record_id uuid,
 reason text,
 changes jsonb NOT NULL DEFAULT '{}'::jsonb,
 PRIMARY KEY (run_id,source_row)
);
CREATE INDEX master_sync_rows_record ON master_sync_rows(record_id);
REVOKE ALL ON master_sync_runs,master_sync_rows FROM PUBLIC;
