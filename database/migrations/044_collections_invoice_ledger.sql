-- Collections invoice projections and audited payment records.
-- Source reports remain immutable; this table is a traceable, queryable projection.
CREATE TABLE collections_invoice_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_report_id text NOT NULL REFERENCES collections_sales_reports(id) ON DELETE RESTRICT,
 reporting_month date NOT NULL,
 channel text NOT NULL CHECK(channel IN ('home_customers','distributors_stores')),
 source_reference text NOT NULL,
 source_row integer,
 source_name text NOT NULL CHECK(length(btrim(source_name))>0),
 distributor_code text,
 customer_id uuid REFERENCES customers(id) ON DELETE RESTRICT,
 distributor_id uuid REFERENCES distributors(id) ON DELETE RESTRICT,
 store_id uuid REFERENCES distributors(id) ON DELETE RESTRICT,
 invoice_date date,
 due_date date,
 source_payment_status text CHECK(source_payment_status IN ('Paid','Unpaid')),
 amount numeric(18,2) NOT NULL CHECK(amount>=0),
 UNIQUE(source_report_id,channel,source_reference),
 UNIQUE(id,channel)
);
CREATE INDEX collections_invoice_period ON collections_invoice_records(reporting_month,channel);
CREATE INDEX collections_invoice_account ON collections_invoice_records(source_report_id,channel,source_name);

-- Backfill from the immutable monthly report JSON. No name-based CMS matching is performed.
INSERT INTO collections_invoice_records(source_report_id,reporting_month,channel,source_reference,source_row,source_name,distributor_code,invoice_date,due_date,source_payment_status,amount)
SELECT r.id,r.reporting_month,'home_customers',coalesce(nullif(x.item->>'sourceReference',''),'source row '||coalesce(x.item->>'row',x.ordinality::text)),
 nullif(x.item->>'row','')::integer,x.item->>'name',NULL,nullif(x.item->>'invoiceDate','')::date,nullif(x.item->>'dueDate','')::date,
 CASE WHEN x.item->>'paymentStatus' IN ('Paid','paid') THEN 'Paid' WHEN x.item->>'paymentStatus' IN ('Not Paid','Unpaid','unpaid','Partial','Partially Paid','partially_paid') THEN 'Unpaid' END,(x.item->>'amount')::numeric
FROM collections_sales_reports r CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.payload->'homes','[]'::jsonb)) WITH ORDINALITY x(item,ordinality)
ON CONFLICT(source_report_id,channel,source_reference) DO NOTHING;
INSERT INTO collections_invoice_records(source_report_id,reporting_month,channel,source_reference,source_row,source_name,distributor_code,invoice_date,due_date,source_payment_status,amount)
SELECT r.id,r.reporting_month,'distributors_stores',coalesce(nullif(x.item->>'sourceReference',''),'source row '||coalesce(x.item->>'row',x.ordinality::text)),
 nullif(x.item->>'row','')::integer,coalesce(nullif(x.item->>'displayName',''),x.item->>'name'),nullif(x.item->>'code',''),
 nullif(x.item->>'invoiceDate','')::date,nullif(x.item->>'dueDate','')::date,
 CASE WHEN x.item->>'paymentStatus' IN ('Paid','paid') THEN 'Paid' WHEN x.item->>'paymentStatus' IN ('Not Paid','Unpaid','unpaid','Partial','Partially Paid','partially_paid') THEN 'Unpaid' END,(x.item->>'amount')::numeric
FROM collections_sales_reports r CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.payload->'stores','[]'::jsonb)) WITH ORDINALITY x(item,ordinality)
ON CONFLICT(source_report_id,channel,source_reference) DO NOTHING;

CREATE TABLE collections_home_payment_status_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 source_report_id text NOT NULL REFERENCES collections_sales_reports(id) ON DELETE RESTRICT,
 source_name text NOT NULL CHECK(length(btrim(source_name))>0),
 customer_id uuid REFERENCES customers(id) ON DELETE RESTRICT,
 previous_status text CHECK(previous_status IN ('Paid','Unpaid')),
 new_status text NOT NULL CHECK(new_status IN ('Paid','Unpaid')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 1000),
 actor text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collections_home_status_latest ON collections_home_payment_status_changes(source_report_id,source_name,id DESC);

CREATE TABLE collections_invoice_adjustments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id uuid NOT NULL REFERENCES collections_invoice_records(id) ON DELETE RESTRICT,
 adjustment_reference text NOT NULL UNIQUE,
 amount numeric(18,2) NOT NULL CHECK(amount>0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 1000),
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collections_invoice_adjustments_invoice ON collections_invoice_adjustments(invoice_id);

CREATE TABLE collections_payment_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 channel text NOT NULL CHECK(channel IN ('home_customers','distributors_stores')),
 payer_name text NOT NULL CHECK(length(btrim(payer_name))>0),
 payment_reference text NOT NULL UNIQUE CHECK(length(btrim(payment_reference))>0),
 received_on date NOT NULL,
 amount numeric(18,2) NOT NULL CHECK(amount>0),
 verification_reference text NOT NULL CHECK(length(btrim(verification_reference))>0),
 verified_by text NOT NULL CHECK(length(btrim(verified_by))>1),
 verified_at timestamptz NOT NULL DEFAULT now(),
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE collections_payment_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 payment_id uuid NOT NULL REFERENCES collections_payment_receipts(id) ON DELETE RESTRICT,
 invoice_id uuid NOT NULL REFERENCES collections_invoice_records(id) ON DELETE RESTRICT,
 amount numeric(18,2) NOT NULL CHECK(amount>0),
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(payment_id,invoice_id)
);
CREATE INDEX collections_allocations_invoice ON collections_payment_allocations(invoice_id);

CREATE TABLE collections_payment_reversals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 allocation_id uuid NOT NULL REFERENCES collections_payment_allocations(id) ON DELETE RESTRICT,
 reversal_reference text NOT NULL UNIQUE CHECK(length(btrim(reversal_reference))>0),
 amount numeric(18,2) NOT NULL CHECK(amount>0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 1000),
 actor text NOT NULL,
 reversed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collections_payment_reversals_allocation ON collections_payment_reversals(allocation_id);

CREATE FUNCTION validate_collections_payment_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 receipt collections_payment_receipts%ROWTYPE;
 invoice collections_invoice_records%ROWTYPE;
 prior_receipt numeric(18,2);
 prior_invoice numeric(18,2);
 reversed numeric(18,2);
 credits numeric(18,2);
BEGIN
 PERFORM pg_advisory_xact_lock(728410046,hashtext(NEW.payment_id::text));
 PERFORM pg_advisory_xact_lock(728410047,hashtext(NEW.invoice_id::text));
 SELECT * INTO receipt FROM collections_payment_receipts WHERE id=NEW.payment_id;
 SELECT * INTO invoice FROM collections_invoice_records WHERE id=NEW.invoice_id;
 IF receipt.id IS NULL OR invoice.id IS NULL OR receipt.channel<>invoice.channel THEN
  RAISE EXCEPTION 'Payment and invoice channels must match';
 END IF;
 IF lower(trim(receipt.payer_name))<>lower(trim(invoice.source_name)) THEN
  RAISE EXCEPTION 'Allocate a payment only to invoice rows for the same source account';
 END IF;
 SELECT coalesce(sum(amount),0) INTO prior_receipt FROM collections_payment_allocations WHERE payment_id=NEW.payment_id;
 IF prior_receipt+NEW.amount>receipt.amount THEN RAISE EXCEPTION 'Allocations cannot exceed the verified receipt'; END IF;
 SELECT coalesce(sum(amount),0) INTO prior_invoice FROM collections_payment_allocations WHERE invoice_id=NEW.invoice_id;
 SELECT coalesce(sum(r.amount),0) INTO reversed FROM collections_payment_reversals r JOIN collections_payment_allocations a ON a.id=r.allocation_id WHERE a.invoice_id=NEW.invoice_id;
 SELECT coalesce(sum(amount),0) INTO credits FROM collections_invoice_adjustments WHERE invoice_id=NEW.invoice_id;
 IF prior_invoice-reversed+credits+NEW.amount>invoice.amount THEN RAISE EXCEPTION 'Allocation exceeds the invoice balance'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER collections_allocation_guard BEFORE INSERT ON collections_payment_allocations
 FOR EACH ROW EXECUTE FUNCTION validate_collections_payment_allocation();

CREATE FUNCTION validate_collections_invoice_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 invoice collections_invoice_records%ROWTYPE;
 allocated numeric(18,2);
 reversed numeric(18,2);
 credits numeric(18,2);
BEGIN
 PERFORM pg_advisory_xact_lock(728410047,hashtext(NEW.invoice_id::text));
 SELECT * INTO invoice FROM collections_invoice_records WHERE id=NEW.invoice_id;
 IF invoice.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
 SELECT coalesce(sum(amount),0) INTO allocated FROM collections_payment_allocations WHERE invoice_id=NEW.invoice_id;
 SELECT coalesce(sum(r.amount),0) INTO reversed FROM collections_payment_reversals r JOIN collections_payment_allocations p ON p.id=r.allocation_id WHERE p.invoice_id=NEW.invoice_id;
 SELECT coalesce(sum(amount),0) INTO credits FROM collections_invoice_adjustments WHERE invoice_id=NEW.invoice_id;
 IF allocated-reversed+credits+NEW.amount>invoice.amount THEN RAISE EXCEPTION 'Credit exceeds remaining invoice balance'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER collections_credit_guard BEFORE INSERT ON collections_invoice_adjustments
 FOR EACH ROW EXECUTE FUNCTION validate_collections_invoice_credit();

CREATE FUNCTION validate_collections_payment_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocation collections_payment_allocations%ROWTYPE; already_reversed numeric(18,2); invoice_id uuid;
BEGIN
 SELECT a.invoice_id INTO invoice_id FROM collections_payment_allocations a WHERE a.id=NEW.allocation_id;
 IF invoice_id IS NULL THEN RAISE EXCEPTION 'Payment allocation not found'; END IF;
 PERFORM pg_advisory_xact_lock(728410047,hashtext(invoice_id::text));
 PERFORM pg_advisory_xact_lock(728410048,hashtext(NEW.allocation_id::text));
 SELECT * INTO allocation FROM collections_payment_allocations WHERE id=NEW.allocation_id;
 IF allocation.id IS NULL THEN RAISE EXCEPTION 'Payment allocation not found'; END IF;
 SELECT coalesce(sum(amount),0) INTO already_reversed FROM collections_payment_reversals WHERE allocation_id=NEW.allocation_id;
 IF already_reversed+NEW.amount>allocation.amount THEN RAISE EXCEPTION 'Reversal exceeds the allocated payment amount'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER collections_reversal_guard BEFORE INSERT ON collections_payment_reversals
 FOR EACH ROW EXECUTE FUNCTION validate_collections_payment_reversal();

CREATE FUNCTION immutable_collections_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Collections invoice, payment and audit records are append-only'; END $$;
CREATE TRIGGER immutable_collections_invoice_records BEFORE UPDATE OR DELETE OR TRUNCATE ON collections_invoice_records
 FOR EACH STATEMENT EXECUTE FUNCTION immutable_collections_ledger();
CREATE TRIGGER immutable_collections_status_changes BEFORE UPDATE OR DELETE OR TRUNCATE ON collections_home_payment_status_changes
 FOR EACH STATEMENT EXECUTE FUNCTION immutable_collections_ledger();
CREATE TRIGGER immutable_collections_invoice_adjustments BEFORE UPDATE OR DELETE OR TRUNCATE ON collections_invoice_adjustments
 FOR EACH STATEMENT EXECUTE FUNCTION immutable_collections_ledger();
CREATE TRIGGER immutable_collections_payment_receipts BEFORE UPDATE OR DELETE OR TRUNCATE ON collections_payment_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION immutable_collections_ledger();
CREATE TRIGGER immutable_collections_payment_allocations BEFORE UPDATE OR DELETE OR TRUNCATE ON collections_payment_allocations
 FOR EACH STATEMENT EXECUTE FUNCTION immutable_collections_ledger();
CREATE TRIGGER immutable_collections_payment_reversals BEFORE UPDATE OR DELETE OR TRUNCATE ON collections_payment_reversals
 FOR EACH STATEMENT EXECUTE FUNCTION immutable_collections_ledger();

REVOKE ALL ON collections_invoice_records,collections_home_payment_status_changes,collections_invoice_adjustments,collections_payment_receipts,collections_payment_allocations,collections_payment_reversals FROM PUBLIC,satima_app;
GRANT SELECT ON collections_invoice_records,collections_home_payment_status_changes,collections_invoice_adjustments,collections_payment_receipts,collections_payment_allocations,collections_payment_reversals TO satima_app;
GRANT INSERT ON collections_home_payment_status_changes,collections_invoice_adjustments,collections_payment_receipts,collections_payment_allocations,collections_payment_reversals TO satima_app;
GRANT USAGE,SELECT ON SEQUENCE collections_home_payment_status_changes_id_seq TO satima_app;
