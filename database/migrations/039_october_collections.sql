-- October-only evidence: no joins or foreign keys into operational/customer tables.
ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_role_check;
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_role_check
 CHECK (role IN ('administrator','viewer','registration_viewer','finance'));

CREATE TABLE collections_october_sources (
 kind text PRIMARY KEY CHECK (kind IN ('workbook','dashboard')),
 filename text NOT NULL,
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 original_bytes bytea NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE collections_october_snapshot (
 id text PRIMARY KEY CHECK (id = 'october'),
 workbook_sha256 text NOT NULL,
 dashboard_sha256 text NOT NULL,
 payload jsonb NOT NULL,
 presentation jsonb NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_october_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'October source evidence is immutable';
END $$;
CREATE TRIGGER immutable_october_sources BEFORE UPDATE OR DELETE OR TRUNCATE
 ON collections_october_sources FOR EACH STATEMENT EXECUTE FUNCTION protect_october_evidence();
CREATE TRIGGER immutable_october_snapshot BEFORE UPDATE OR DELETE OR TRUNCATE
 ON collections_october_snapshot FOR EACH STATEMENT EXECUTE FUNCTION protect_october_evidence();
REVOKE ALL ON collections_october_sources,collections_october_snapshot FROM PUBLIC,satima_app;
GRANT SELECT ON collections_october_snapshot TO satima_app;
