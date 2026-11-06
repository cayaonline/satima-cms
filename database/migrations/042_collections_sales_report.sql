-- One mixed-channel source, kept distinct from receivables snapshots and statements.
CREATE TABLE collections_sales_evidence (
 id text PRIMARY KEY,
 filename text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 original_bytes bytea NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE collections_sales_reports (
 id text PRIMARY KEY REFERENCES collections_sales_evidence(id),
 reporting_month date NOT NULL,
 payload jsonb NOT NULL
);
CREATE TRIGGER immutable_sales_evidence BEFORE UPDATE OR DELETE OR TRUNCATE ON collections_sales_evidence
 FOR EACH STATEMENT EXECUTE FUNCTION protect_october_evidence();
CREATE TRIGGER immutable_sales_report BEFORE UPDATE OR DELETE OR TRUNCATE ON collections_sales_reports
 FOR EACH STATEMENT EXECUTE FUNCTION protect_october_evidence();
REVOKE ALL ON collections_sales_evidence,collections_sales_reports FROM PUBLIC,satima_app;
GRANT SELECT ON collections_sales_reports TO satima_app;
INSERT INTO collections_retailers(code,name) VALUES
 ('chandarana','Chandarana'),('karen_provision_stores','Karen Provision Stores'),
 ('on_the_way','On The Way'),('cleanshelf','Cleanshelf Supermarket') ON CONFLICT DO NOTHING;
-- Raw red-fill evidence is unchanged. Its meaning is a review flag, not an automatic overdue decision.
ALTER TABLE collections_account_reviews DROP CONSTRAINT collections_account_reviews_overdue_state_check;
ALTER TABLE collections_account_reviews ADD CONSTRAINT collections_account_reviews_overdue_state_check
 CHECK(overdue_state IN ('overdue','not_overdue','needs_review','overpaid'));
