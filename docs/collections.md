# October Collections

Collections is a native `/collections` page for Admin and Finance and an
`/operations/collections` page for Head of Operations, immediately below Home. It reuses the CMS header, sidebar, collapse preference and mobile
drawer. The supplied dashboard is adapted inside a shadow root (not an iframe)
to preserve its typography, cards, charts and interactions without CSS collisions.
Its section navigation becomes an in-page tab bar. Existing CMS page links retain
their normal full-page navigation behavior.

## Source and isolation

Only the supplied `Receivables October.xlsx` and matching
`Satima_October_Receivables_Dashboard.html` are accepted. Do not commit either file.
The read-only Python extractor uses Decimal arithmetic and preserves original cell
values, types, formulas, sheet references and row numbers. The importer compares
every dashboard record field against the independently extracted workbook and
fails on a mismatch. It never queries CMS customer or financial records.

Migration `039_october_collections.sql` adds two isolated tables:

- `collections_october_sources`: exact source bytes and SHA-256 hashes; no
  application-role access and no workbook download route.
- `collections_october_snapshot`: normalized, traceable records and original
  presentation adapted for authenticated delivery. The app has SELECT only.

Both tables reject UPDATE, DELETE and TRUNCATE. Repeating the import with identical
source hashes is a no-op; different sources require a separately reviewed version.
The original HTML is evidence, not a publicly served asset. The extracted code
uses an authenticated data request instead of embedded account records. Headlines,
status distribution and concentration metrics use the verified source data.

Amounts labelled Paid remain source labels, not confirmed bank receipts. Partial
payments and outstanding balances remain conditional. Missing dates, reconciliation gaps and management-context caveats remain visible.
The owner has classified this workbook as Home Customers; this is recorded separately
from the workbook, which has no channel column.
No aging or Home/Store classification is inferred.

## Permissions

Admin access uses the existing login and session cookie. Optional Finance access
uses that same login, session store, expiry, rate limiter and logout flow, with
`FINANCE_USERNAME` and `FINANCE_PASSWORD_HASH` (the existing salted scrypt format).
The Finance username must differ from `admin`. Provision these private settings
only for an authorized Finance recipient; never commit a password or its hash.
Without those settings, Finance login is disabled. The owner has explicitly authorized the existing Operations portal as the
top-level Head of Operations account. Both configured portal session types
(`viewer` and `registration_viewer`, retained for compatibility) can read Collections
and export through `/api/operations/collections`. These requests use the existing
portal session cookie and logout endpoint. Other Admin-only permissions are
unchanged. The portal login, sidebar and headings are labelled Head of Operations;
existing URLs, usernames and passwords remain valid.

Finance sessions have access only to their Home, Collections and session/logout
endpoints; they do not gain Admin's operational permissions. Authorized Collections users can
append classification reviews through the reviewed workflow below.
Every Collections data/script/export request checks the server-side role and uses
`private, no-store`. CSV exports recheck authorization and neutralize spreadsheet
formula injection while leaving stored source values intact. Page-specific CSP
permits the original inline chart styles but still disallows inline scripts.

## Validation and deployment

Validate locally without a database or changes to the workbook:

```sh
node app/scripts/import-october-collections.mjs /private/Receivables\ October.xlsx /private/Satima_October_Receivables_Dashboard.html --validate-only
node --test app/tests/collections.test.mjs
node app/scripts/test-hosted.mjs
```

The hosted test uses a disposable local PostgreSQL container and fictional records,
including Finance login, Head of Operations access, export denial after logout, missing
source behavior, source-table grants and immutable snapshot checks. An existing
Excel-reader test assumes a checkout path without spaces; run the hosted suite
from such a path if needed.

For the existing Render `satima-cms` service:

1. Take and verify an encrypted backup using the established backup configuration.
2. Verify applied migration checksums and apply migration 039 with the schema
   owner. Do not reset the database or give Render owner credentials.
3. Set the owner connection privately in `ADMIN_DATABASE_URL`, and run the import
   command above without `--validate-only` from the trusted operator machine.
   Python is needed only on that machine, not in Render.
4. Verify both stored source hashes and the imported record totals. Repeat import
   safely to check idempotency if needed.
5. Deploy the reviewed commit manually to the existing service. Build and start
   commands are unchanged; there is no new service or frontend build dependency.
6. Check `/collections` as Admin, data/export denial without a session and after Head of Operations logout, and both existing portal Home pages. Check mobile navigation,
   dashboard filters, reconciliation findings and CSV download.

For a code rollback, deploy the previous Render commit. The additive tables and
expanded session-role constraint remain compatible with the prior code; retain
the immutable evidence rather than deleting it.

Head of Operations access is an explicit owner-authorized permission change.
Anonymous users still cannot retrieve data, dashboard scripts or exports. No
financial data is reimported or edited by this portal update.


## Independent channels and source overdue flags

Migration `040_collections_channels.sql` adds isolated source datasets, Home
Customers metadata, append-only account reviews, separate future invoice records,
and retailer/branch/financial-document/matching/exception tables. Composite foreign
keys prevent Home datasets being used as store financial sources. Only Naivas
configuration is seeded; there are no store financial amounts or branches.
Verified retailer payments require a payment record, verification reference,
reviewer and verification timestamp. Remittances are not verified payments.

The October workbook is a customer receivables snapshot, not October invoices or
sales. Snapshot date, invoice month, invoice dates and due dates stay NULL.
Future dated invoice documents must have their own dataset and source references.
The consolidated overview displays the channels separately and never adds a
company-wide collection rate. Store metrics remain unavailable until a source
import and reconciliation workflow is implemented for the supplied documents.

The source flag extractor reads the original OOXML fills, retains cell/style/fill
references and rejects conditional formatting for manual review. Run:

```sh
node app/scripts/refine-collections-source.mjs /private/Receivables\ October.xlsx --validate-only
```

After a verified backup, apply migration 040 with the owner, then run that command
without `--validate-only`, using the private owner connection in
`ADMIN_DATABASE_URL`. This compares source SHA and every account's row/name/amount
to the immutable snapshot before inserting metadata. Repeating it verifies the
same evidence; it cannot rewrite it. The original source and snapshot remain intact.

The verified direct solid-red fills identify source overdue records. Their cell
references and financial amounts remain in authenticated responses and private evidence. No other unpaid account is deemed
overdue without an explicit staff review. Date unknown is a separate condition.

GET/POST `/api/collections/accounts/:row/reviews` and its Operations equivalent
require the existing authorized session. Writes also require the existing
same-origin protection, a named reviewer, a reason, a valid classification and
an expected revision. Concurrent stale reviews return 409. Database grants and
triggers prohibit rewriting/deleting reviews; signed-in actor, named reviewer and
server timestamp are retained. The form records follow-up/legal review stages;
it does not send messages or initiate legal action. CSV includes source flags,
current classifications, unknown date fields and follow-up stages.

Validation covers direct red fills, missing evidence, independent payment/overdue
states, filtered exports, unauthorized/cross-origin writes, concurrent reviews,
append-only history, immutable source metadata, channel isolation, payment evidence
constraints, and the existing hosted CMS regression suite. Browser checks cover
both channel panels, preserved original sections, filters, exports, review form,
sidebar and responsive widths of 1440, 768, 390 and 320 pixels.
