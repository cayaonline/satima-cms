# Historical milk performance

Migration `034_milk_performance.sql` stores source-reported weekly aggregates in separate import, week-version, and validation-issue tables. These tables do not feed milk inventory or the operational homepage KPIs. Blank source cells remain `NULL`; source workbook cell values and formulas, row references, the original pasteurization expression, file hashes, and previous week revisions remain available for audit.

The original `.xlsx` and normalized `.csv` are private operator files. Keep them outside the public repository and Render filesystem. The import command requires both files; it compares every mapped CSV value with the original worksheet at the declared row. It rejects missing, duplicate, or contradictory rows rather than inventing figures. The original workbook must have the established columns B–P, and the CSV must use the existing normalized header. Week numbers can include a fifth week.

For October or a later month:

1. Prepare the normalized CSV with the same 24 headers, an explicit year/month/week, worksheet, and original workbook row for each weekly row. Keep source blanks blank. Do not invent calendar week dates.
2. Run a fresh encrypted production backup and verify its SHA-256 sidecar and authenticated decryption. Apply migration `034` through the normal hosted migration procedure only after a disposable-database test.
3. Supply the private owner connection through `ADMIN_DATABASE_URL` and run `node app/scripts/import-milk-performance.mjs preview /private/month.csv /private/original.xlsx --actor="Name"`. Review the weekly counts, monthly totals and validation warnings.
4. Run the same command with `apply` to commit the reviewed import. Repeating identical files skips all rows. For corrected figures, use a new source file and `--revision-reason="Reviewed correction reason"`; the previous version and its issues remain in the database.
5. Open the Admin and Operations homepages, select the new month, and compare its reported values and warning count with the preview. A custom calendar-date filter is intentionally unavailable until verified week start/end dates are provided.

The importer uses one serializable transaction and an advisory lock. The Render application role has read-only access to these historical tables; only the private database owner can import or revise them. Never use the importer to create farmer collections, quality assessments, processing batches, or distribution transactions from aggregate figures.
