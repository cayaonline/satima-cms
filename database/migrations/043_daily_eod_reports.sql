CREATE TABLE daily_report_sources (
 id text PRIMARY KEY,
 filename text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 original_bytes bytea NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE daily_report_imports (
 id text PRIMARY KEY,
 source_shas jsonb NOT NULL,
 row_counts jsonb NOT NULL,
 expected_control_totals jsonb NOT NULL,
 importer_version text NOT NULL,
 actor text NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE daily_report_days (
 operational_date date NOT NULL,
 report_type text NOT NULL CHECK(report_type IN ('EOD','Manifest')),
 report_available boolean NOT NULL DEFAULT true,
 report_id text,
 store_count integer,
 home_customer_count integer,
 stores_litres_calculated numeric(10,2), stores_litres_reported numeric(10,2),
 homes_litres_calculated numeric(10,2), homes_litres_reported numeric(10,2),
 overall_litres_calculated numeric(10,2), overall_litres_reported numeric(10,2),
 returns_litres numeric(10,2), rescued_litres numeric(10,2), spoilt_litres numeric(10,2), replacements_litres numeric(10,2),
 validation_status text NOT NULL CHECK(validation_status IN ('OK','DISCREPANCY','MISSING','UNVERIFIED')),
 source_id text REFERENCES daily_report_sources(id),
 import_id text NOT NULL REFERENCES daily_report_imports(id),
 PRIMARY KEY(import_id,operational_date,report_type)
);
CREATE TABLE daily_report_store_lines (
 import_id text NOT NULL REFERENCES daily_report_imports(id),
 operational_date date NOT NULL,
 store_name_std text NOT NULL,
 qty_1l_bottles numeric(10,2), qty_500ml_bottles numeric(10,2),
 litres_calculated numeric(10,2), quantity_status text,
 report_id text
);
CREATE TABLE daily_report_home_monthly (
 import_id text NOT NULL REFERENCES daily_report_imports(id),
 month date NOT NULL,
 distinct_home_customers integer,
 home_deliveries integer,
 home_litres numeric(10,2),
 customers_all_months integer,
 customers_one_month integer,
 PRIMARY KEY(import_id,month)
);
CREATE FUNCTION protect_daily_report_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Daily report evidence is immutable'; END $$;
CREATE TRIGGER immutable_daily_report_sources BEFORE UPDATE OR DELETE OR TRUNCATE ON daily_report_sources FOR EACH STATEMENT EXECUTE FUNCTION protect_daily_report_evidence();
CREATE TRIGGER immutable_daily_report_imports BEFORE UPDATE OR DELETE OR TRUNCATE ON daily_report_imports FOR EACH STATEMENT EXECUTE FUNCTION protect_daily_report_evidence();
CREATE TRIGGER immutable_daily_report_days BEFORE UPDATE OR DELETE OR TRUNCATE ON daily_report_days FOR EACH STATEMENT EXECUTE FUNCTION protect_daily_report_evidence();
CREATE TRIGGER immutable_daily_report_store_lines BEFORE UPDATE OR DELETE OR TRUNCATE ON daily_report_store_lines FOR EACH STATEMENT EXECUTE FUNCTION protect_daily_report_evidence();
CREATE TRIGGER immutable_daily_report_home_monthly BEFORE UPDATE OR DELETE OR TRUNCATE ON daily_report_home_monthly FOR EACH STATEMENT EXECUTE FUNCTION protect_daily_report_evidence();
REVOKE ALL ON daily_report_sources,daily_report_imports,daily_report_days,daily_report_store_lines,daily_report_home_monthly FROM PUBLIC,satima_app;
GRANT SELECT ON daily_report_imports,daily_report_days,daily_report_store_lines,daily_report_home_monthly TO satima_app;
