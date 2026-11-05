-- Independent financial channels. No linkage to operational customer/store tables.
CREATE TABLE collections_datasets (
 id text PRIMARY KEY,
 channel text NOT NULL CHECK (channel IN ('home_customers','distributors_stores')),
 kind text NOT NULL CHECK (kind IN ('receivables_snapshot','invoices','retailer_records')),
 source_filename text NOT NULL,
 source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
 classification_basis text NOT NULL,
 reporting_month date,
 snapshot_as_of date,
 imported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,channel)
);
CREATE TABLE collections_home_accounts (
 dataset_id text NOT NULL,
 channel text NOT NULL DEFAULT 'home_customers' CHECK (channel='home_customers'),
 source_row integer NOT NULL CHECK (source_row>1),
 source_overdue boolean NOT NULL,
 style_evidence jsonb NOT NULL,
 invoice_date date,
 invoice_month date,
 due_date date,
 PRIMARY KEY(dataset_id,source_row),
 FOREIGN KEY(dataset_id,channel) REFERENCES collections_datasets(id,channel)
);
CREATE TABLE collections_account_reviews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 dataset_id text NOT NULL,
 source_row integer NOT NULL,
 overdue_state text NOT NULL CHECK (overdue_state IN ('overdue','not_overdue','needs_review')),
 follow_up_stage text CHECK (follow_up_stage IN ('contact_planned','contacted','promise_to_pay','disputed','legal_review_requested','legal_referred','closed')),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 2000),
 reviewer_name text NOT NULL CHECK (length(btrim(reviewer_name)) BETWEEN 2 AND 150),
 actor text NOT NULL,
 reviewed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(dataset_id,source_row) REFERENCES collections_home_accounts(dataset_id,source_row)
);
CREATE INDEX collections_reviews_account ON collections_account_reviews(dataset_id,source_row,id DESC);

-- Future invoice documents are separate sources, never inferred from the snapshot.
CREATE TABLE collections_home_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 dataset_id text NOT NULL,
 channel text NOT NULL DEFAULT 'home_customers' CHECK (channel='home_customers'),
 source_reference text NOT NULL,
 account_name text NOT NULL,
 invoice_reference text,
 invoice_date date,
 due_date date,
 amount numeric(18,2) NOT NULL,
 FOREIGN KEY(dataset_id,channel) REFERENCES collections_datasets(id,channel),
 UNIQUE(dataset_id,source_reference)
);

CREATE TABLE collections_retailers (
 code text PRIMARY KEY,
 name text NOT NULL,
 source_status text NOT NULL DEFAULT 'awaiting_source' CHECK (source_status IN ('awaiting_source','under_review','reconciled'))
);
-- Configuration only: no financial records or branch assumptions are seeded.
INSERT INTO collections_retailers(code,name) VALUES('naivas','Naivas');
CREATE TABLE collections_retail_branches (
 retailer_code text NOT NULL REFERENCES collections_retailers(code),
 branch_code text NOT NULL,
 branch_name text NOT NULL,
 source_reference text NOT NULL,
 PRIMARY KEY(retailer_code,branch_code)
);
CREATE TABLE collections_retail_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 dataset_id text NOT NULL,
 channel text NOT NULL DEFAULT 'distributors_stores' CHECK (channel='distributors_stores'),
 retailer_code text NOT NULL REFERENCES collections_retailers(code),
 branch_code text,
 kind text NOT NULL CHECK (kind IN ('supply','invoice','credit_note','return','remittance','payment')),
 source_reference text NOT NULL,
 document_reference text,
 event_date date,
 due_date date,
 amount numeric(18,2) NOT NULL CHECK (amount>=0),
 currency text NOT NULL DEFAULT 'KES' CHECK (currency='KES'),
 payment_verified boolean NOT NULL DEFAULT false,
 verification_reference text,
 verified_by text,
 verified_at timestamptz,
 FOREIGN KEY(dataset_id,channel) REFERENCES collections_datasets(id,channel),
 FOREIGN KEY(retailer_code,branch_code) REFERENCES collections_retail_branches(retailer_code,branch_code),
 CHECK (NOT payment_verified OR (kind='payment' AND verification_reference IS NOT NULL AND verified_by IS NOT NULL AND length(btrim(verification_reference))>0 AND length(btrim(verified_by))>0 AND verified_at IS NOT NULL)),
 UNIQUE(dataset_id,source_reference,kind),
 UNIQUE(id,retailer_code)
);
CREATE TABLE collections_retail_matches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 retailer_code text NOT NULL,
 left_record_id uuid NOT NULL,
 right_record_id uuid NOT NULL,
 matched_amount numeric(18,2) NOT NULL CHECK (matched_amount>0),
 evidence_reference text NOT NULL,
 reviewed_by text NOT NULL,
 reviewed_at timestamptz NOT NULL DEFAULT now(),
 CHECK (left_record_id<>right_record_id),
 FOREIGN KEY(left_record_id,retailer_code) REFERENCES collections_retail_records(id,retailer_code),
 FOREIGN KEY(right_record_id,retailer_code) REFERENCES collections_retail_records(id,retailer_code),
 UNIQUE(left_record_id,right_record_id)
);
CREATE TABLE collections_retail_exceptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 retailer_code text NOT NULL REFERENCES collections_retailers(code),
 record_id uuid,
 description text NOT NULL,
 source_reference text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
 resolution text,
 FOREIGN KEY(record_id,retailer_code) REFERENCES collections_retail_records(id,retailer_code),
 CHECK (status<>'resolved' OR (resolution IS NOT NULL AND length(btrim(resolution))>0))
);

CREATE TRIGGER immutable_collections_datasets BEFORE UPDATE OR DELETE OR TRUNCATE ON collections_datasets
 FOR EACH STATEMENT EXECUTE FUNCTION protect_october_evidence();
CREATE TRIGGER immutable_home_source_metadata BEFORE UPDATE OR DELETE OR TRUNCATE ON collections_home_accounts
 FOR EACH STATEMENT EXECUTE FUNCTION protect_october_evidence();
CREATE TRIGGER append_only_collections_reviews BEFORE UPDATE OR DELETE OR TRUNCATE ON collections_account_reviews
 FOR EACH STATEMENT EXECUTE FUNCTION protect_october_evidence();
REVOKE ALL ON collections_datasets,collections_home_accounts,collections_account_reviews,collections_home_invoices,
 collections_retailers,collections_retail_branches,collections_retail_records,collections_retail_matches,collections_retail_exceptions FROM PUBLIC,satima_app;
GRANT SELECT ON collections_datasets,collections_home_accounts,collections_account_reviews,collections_home_invoices,
 collections_retailers,collections_retail_branches,collections_retail_records,collections_retail_matches,collections_retail_exceptions TO satima_app;
GRANT INSERT ON collections_account_reviews TO satima_app;
GRANT USAGE,SELECT ON SEQUENCE collections_account_reviews_id_seq TO satima_app;
