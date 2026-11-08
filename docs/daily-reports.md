# Daily Reports

Daily Reports presents the validated End-of-Day (EOD) delivery report extraction
for 1 July–31 October 2026. Admin uses `/daily-reports`; Head of Operations uses
`/operations/daily-reports`. This is a read-only summary and remains separate from
Home, Milk Distribution and the `business` / milk-performance reports.

## Source and privacy boundary

The source is the Satima Farmhouse Operations WhatsApp group extraction, supplied
as six CSV files: `eod_reports.csv`, `delivery_manifests.csv`,
`store_deliveries.csv`, `home_deliveries.csv`, `daily_summary.csv` and
`missing_report_dates.csv`. The source exports are private operator files. Never
commit them or place them under `app/public`.

The importer reads `home_deliveries.csv` only to calculate month-level distinct
customer counts, delivery counts, litres and month-frequency counts. Customer
names, addresses, phone numbers and customer keys are used transiently in memory
for grouping and are discarded. No customer identifier or PII field is written to
a reporting table or returned by the API. Store outlet names are permitted. Raw
source bytes and SHA-256 hashes are kept in `daily_report_sources`; the
`satima_app` role has no access to that evidence table. API output is built from an
explicit allowlist of reporting columns.

EOD (actual) and Manifest (planned) rows remain separate report types. The page
never sums them. NULL means a value was not reported and is displayed as `—`.
“No report found” describes missing source evidence, not an assertion that there
were no deliveries.

## Schema and grants

Migration `043_daily_eod_reports.sql` creates immutable import metadata,
source-evidence, daily report, store-line and home-month aggregate tables. The
runtime role receives `SELECT` on `daily_report_imports`, `daily_report_days`,
`daily_report_store_lines` and `daily_report_home_monthly` only. It receives no
privilege on `daily_report_sources`. All five tables reject `UPDATE`, `DELETE`
and `TRUNCATE`. The tables have no links to customer or farmer records.

The source SHA set is fixed for import version
`daily-eod-jul-oct-2026-v1`. An identical set is a no-op; changed source files
require a reviewed, separately versioned import. The importer verifies the
provided control totals before either validation or database writes.

## Validate and import

Run from the repository root on the trusted operator machine. Keep the CSV
directory private and outside Git. `--validate-only` parses the files, computes
aggregates and checks the controls without connecting to PostgreSQL.

```sh
node app/scripts/import-daily-reports.mjs /private/path/to/daily-eod-csvs --validate-only
```

After review, import through the private schema-owner connection. Do not use the
Render runtime connection or put credentials in a command line or source file.

```sh
ADMIN_DATABASE_URL="<private owner connection>" node app/scripts/import-daily-reports.mjs /private/path/to/daily-eod-csvs
```

The importer reads only current report versions (`is_current_version` true or
`version_status` beginning with `current`). Bottles are recalculated as 1 L for
each 1 L bottle and 0.5 L for each 500 ml bottle. It refuses a changed source set
under the existing import version.

## Deployment sequence

1. Create and verify an encrypted database backup using the existing backup
   configuration.
2. Check applied migration checksums. Apply migration 043 using the schema-owner
   connection.
3. Run the importer with `--validate-only` against the private exports and review
   its control totals.
4. Import with `ADMIN_DATABASE_URL` from the trusted operator machine.
5. Verify the stored import and report counts against the control totals in the
   task brief, including monthly totals, missing EOD dates, discrepancy count,
   distinct stores, top store and paired Manifest/EOD totals.
6. Manually deploy the reviewed commit to the existing Render `satima-cms`
   service. Do not add a service or runtime dependency.
7. Check Admin `/daily-reports` and Head of Operations
   `/operations/daily-reports`, including each tab, month filtering, print view,
   CSV export, missing days, Finance denial, and export denial after logout.

## Rollback

For a code rollback, redeploy the previous commit. Keep migration 043's additive
tables and immutable source evidence; do not delete or rewrite the imported
records. The previous application can run without reading the new tables.
