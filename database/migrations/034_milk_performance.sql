-- Historical aggregate reporting is deliberately separate from operational inventory.
CREATE TABLE milk_performance_import_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_filename text NOT NULL,
 source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
 normalized_filename text NOT NULL,
 normalized_sha256 text NOT NULL CHECK (normalized_sha256 ~ '^[a-f0-9]{64}$'),
 source_worksheet text NOT NULL,
 actor text NOT NULL,
 revision_reason text,
 imported_at timestamptz NOT NULL DEFAULT now(),
 record_count integer NOT NULL CHECK (record_count > 0),
 issue_count integer NOT NULL CHECK (issue_count >= 0),
 status text NOT NULL DEFAULT 'committed' CHECK (status='committed'),
 UNIQUE (source_sha256,normalized_sha256)
);

CREATE TABLE milk_performance_weeks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 import_batch_id uuid NOT NULL REFERENCES milk_performance_import_batches(id) ON DELETE RESTRICT,
 report_year integer NOT NULL CHECK (report_year BETWEEN 2020 AND 2200),
 report_month integer NOT NULL CHECK (report_month BETWEEN 1 AND 12),
 week_number integer NOT NULL CHECK (week_number BETWEEN 1 AND 6),
 week_start date,
 week_end date,
 revision integer NOT NULL CHECK (revision > 0),
 is_current boolean NOT NULL DEFAULT true,
 source_row integer NOT NULL CHECK (source_row > 0),
 source_week_label text NOT NULL,
 original_pasteurization_expression text,
 farmers_milk_supply_liters numeric(16,6),
 available_for_pasteurization_liters numeric(16,6),
 pstd_inc_cf_reported_total_liters numeric(16,6),
 pstd_inc_cf_calculated_components_liters numeric(16,6),
 milk_out_stores_liters numeric(16,6),
 milk_out_homes_liters numeric(16,6),
 milk_out_raw_liters numeric(16,6),
 total_milk_out_liters numeric(16,6),
 returns_liters numeric(16,6),
 return_rate_source_fraction numeric(24,18),
 total_sales_source_liters numeric(16,6),
 rescued_liters numeric(16,6),
 inhouse_liters numeric(16,6),
 rnd_liters numeric(16,6),
 carry_forward_pasteurized_liters numeric(16,6),
 carry_forward_raw_liters numeric(16,6),
 workbook_cells jsonb NOT NULL,
 normalized_source_row jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (week_start IS NULL AND week_end IS NULL OR week_start IS NOT NULL AND week_end IS NOT NULL AND week_start<=week_end),
 UNIQUE (report_year,report_month,week_number,revision)
);
CREATE UNIQUE INDEX milk_performance_one_current_week ON milk_performance_weeks(report_year,report_month,week_number) WHERE is_current;
CREATE INDEX milk_performance_month_lookup ON milk_performance_weeks(report_year DESC,report_month DESC,week_number) WHERE is_current;

CREATE TABLE milk_performance_issues (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 week_id uuid NOT NULL REFERENCES milk_performance_weeks(id) ON DELETE RESTRICT,
 metric text NOT NULL,
 reported_value numeric(16,6),
 calculated_value numeric(16,6),
 difference numeric(16,6),
 severity text NOT NULL CHECK (severity IN ('warning','error')),
 review_status text NOT NULL DEFAULT 'open' CHECK (review_status IN ('open','reviewed','resolved')),
 note text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX milk_performance_issues_week ON milk_performance_issues(week_id);

REVOKE ALL ON milk_performance_import_batches,milk_performance_weeks,milk_performance_issues FROM PUBLIC;
GRANT SELECT ON milk_performance_import_batches,milk_performance_weeks,milk_performance_issues TO satima_app;
