# Collections invoice ledger

Collections invoice reports are immutable source documents. The imported JSON reports remain the source-of-record projection; `collections_invoice_records` adds stable row IDs and optional CMS relationship IDs for payment processing. Every ledger row retains its report ID, original source reference, row number, account label, channel, reporting month and original amount. No customer is linked by a name-only match. A Finance or Administrator user may select a CMS customer explicitly when reviewing a Home Customer status; no source invoice/customer identity is inferred.

The ledger is isolated in Collections tables and does not combine the older receivables snapshot with monthly invoice reports. Existing July through October report rows are imported into their own cohorts. Missing invoice dates and due dates remain null. Distributor rows are parent-level summaries where that is all the source report provides; branch-level allocation is not represented as if it were available.

## KPI treatment

- **Invoiced** is the sum of source invoice row amounts in the selected reporting-month cohort, less approved, referenced credit-note adjustments.
- **Collected** is verified receipt value allocated to those invoice rows, less append-only reversals. The receipt date does not move the value to a different invoice cohort: a November payment allocated to October invoices updates October cohort collections, not November cash receipts.
- **Outstanding** is source invoice value less approved credits and net allocated payments. An unallocated receipt is retained and displayed separately; it is not counted as collected against an invoice or subtracted from an invoice balance.
- **Overdue** includes outstanding amounts only when the invoice row has a verified due date before the current Nairobi date. Explicitly reviewed overdue classifications remain a separate workflow. Unpaid rows without due dates remain unclassified.
- **Ageing** uses the same due-date basis and places rows without dates in “Unclassified / Due Date Unknown.” No historical aging is inferred from the October receivables snapshot.

Approved credits, receipts, allocations and reversals are append-only and require references, reasons/evidence and an actor. Database triggers prevent allocations exceeding a receipt or an invoice’s available balance, credits exceeding the residual invoice balance, and reversals exceeding their original allocation. Duplicate references and duplicate allocations are rejected. Any excess receipt remains unallocated for later matching.

The Home Customer **Paid / Unpaid** field is a separately audited review label. Updating it never creates or removes a receipt. A manual Paid label with an outstanding ledger balance is shown as a reconciliation discrepancy. Source status, actual allocations and reviewed labels remain distinguishable. Unknown status remains unknown until source evidence or an authorized review supplies it.

## Data still needed for stronger reporting

The July–October source reports do not provide reliable invoice IDs, invoice dates, due dates, per-store invoice detail, or payment receipt/allocation evidence. These are intentionally not fabricated. Before treating the dashboard as a full accounts-receivable subledger, import validated invoice identifiers and dates plus verified receipts/allocations from the approved accounting source (for example, Zoho if confirmed as authoritative). Google Drive can serve as the shared document source once its approved storage/import workflow is configured; it is not connected by this change.

Run `node app/scripts/test-hosted.mjs` to validate migrations and integration behavior against its disposable PostgreSQL container. The migration is `database/migrations/044_collections_invoice_ledger.sql`; hosted environments must apply it with the existing private owner migration workflow before deploying the corresponding app code.
