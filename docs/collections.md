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
payments and outstanding balances remain conditional. Missing dates, channel
classification, reconciliation gaps and management-context caveats remain visible.
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
endpoints; they do not gain Admin's operational data or write permissions.
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
