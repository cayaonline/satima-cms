# Original registration archives

The original PDFs are private PostgreSQL data, stored in `registration_archive_batches.pdf_data`. They are never copied into `app/public`, Git, or Render's temporary filesystem. An unmodified SHA-256 checksum identifies each master PDF. `registration_archive_entries` holds one protected extract per form, so a viewer opening one farmer's pages cannot receive other farmers' pages in the same batch. The existing encrypted PostgreSQL backup includes both the master and protected extracts.

The Admin Panel has a **Registration archives** action beside **Register farmer**. An administrator can upload a PDF (80 MB maximum), identify its page ranges, link each range to an existing farmer, correct associations, review unassigned pages, and download the original or individual extracts. The source PDF itself cannot be replaced or deleted. Changing an association does not change farmer records or historical registration evidence. Archive uploads, association changes, views, and downloads are logged in `registration_archive_events` without copying confidential content into the log.

An administrator can view the assigned extract from the farmer profile. In the Operations Portal, only the existing elevated `registration_viewer` role can see the archive section and open an assigned extract. Ordinary Operations users receive a backend 403 response, including for direct URL requests. Operations users cannot upload, change associations, or download the batch master. A PDF rendered in a browser can be saved by the person viewing it, so elevated viewer accounts must be issued only to staff authorized to retain these records.

The built-in PDF viewer provides page and zoom controls where the browser supports them. The CMS dialog includes a full-screen control. On a browser without embedded PDF controls, the protected PDF URL can be opened directly while the user's session is active. The same authorization applies to direct requests.

## Batch 1 source review

The PDF supplied for `BATCH-001` is **48 pages with 24 two-page forms**, although the expected count is 23. The first 23 forms match the existing `SF-F-0001` through `SF-F-0023` records by exact National ID, phone, name with supporting details, or an already-linked source scan. Pages **47–48** are an additional form with no matching National ID in the existing database. They remain unassigned for manual review. No farmer is created, no existing data is overwritten, and the expected count remains 23 so the discrepancy stays visible.

The private matching manifest and detailed report belong under ignored `data/private/` on the operator's machine. Do not copy them or the source PDF into Git. The import command validates the master checksum and all page ranges before writing. It is a dry run unless `--apply` is specified:

With `DATABASE_URL` supplied by a private environment or secret manager, run the dry run and then the reviewed import. Never paste the connection string into shell history:

```bash
node app/scripts/ingest-registration-archive.mjs /absolute/private/path/batch-manifest.json
node app/scripts/ingest-registration-archive.mjs /absolute/private/path/batch-manifest.json --apply
```

A private manifest uses this shape:

```json
{
  "batch_id": "BATCH-002",
  "batch_name": "Original Farmer Registration — Batch 2",
  "expected_farmer_count": 5,
  "original_filename": "source.pdf",
  "document_path": "/absolute/private/path/source.pdf",
  "sha256": "64-lowercase-hex-characters",
  "forms": [
    {
      "page_start": 1,
      "page_end": 2,
      "expected_customer_id": "SF-F-0001",
      "observed": {
        "full_name": "[transcribed privately]",
        "national_id": "[transcribed privately]",
        "primary_phone": "[transcribed privately]"
      }
    }
  ]
}
```

The observed fields are never written to the archive tables. Matching requires an exact existing identifier, exact phone, or exact full name corroborated by the expected Farmer ID. An `existing_source` object with `document_name`, `first_page`, and `last_page` can confirm a prior document-to-farmer association after visual comparison of the scans. Mark a form `hold_for_review: true` to prevent automatic association. Re-running an identical import skips its already-stored entries; a changed checksum or association stops with an error. For a new batch, no source-code change is needed.

Before applying a migration or import in production, verify a fresh encrypted PostgreSQL backup and its SHA-256 sidecar. Keep the backup key separately. Test restoration to an isolated database on the normal backup schedule. After import, confirm the batch's master checksum, entry counts, links for matched farmers, and that an ordinary Operations account cannot retrieve PDF bytes. The archive increases database and backup size; monitor Neon's free-plan storage before adding further batches.

## Batch 2 paper-form import

`app/scripts/import-batch-registrations.mjs` imports a privately reviewed 24-page, 12-form manifest for `BATCH-002`. It promotes confirmed unregistered directory entries without changing their UUIDs, assigns new Farmer IDs through the existing sequence, creates only independently matched new farmers, saves source transcriptions, and archives the unmodified master with protected two-page extracts in one transaction. A form marked `hold` stays unregistered and its extract is hidden from Operations until an administrator reviews the association. Unmarked consent and verification boxes remain unknown. The script checks the PDF checksum, page pairing, identifier collisions, and current farmer snapshots before writing.

Keep the PDF, manifest, and reconciliation report under ignored `data/private/`. With a separately supplied owner connection, run the dry run first; `apply` is idempotent for a complete batch:

```bash
node app/scripts/import-batch-registrations.mjs /absolute/private/path/batch2-manifest.json
node app/scripts/import-batch-registrations.mjs /absolute/private/path/batch2-manifest.json apply
```

The supplier PDF category and gender reconciliation is separate: `app/scripts/import-supplier-attributes.mjs` accepts a reviewed private row-to-farmer plan and the original PDF. It updates only strong matches, preserves uncertain rows for review, and leaves birth date and language blank when the source leaves them blank. Neither script adds confidential source files to Git.

## Corrected Batch 2 master

The revised 26-page master is stored as `BATCH-002-R2`, with `BATCH-002` retained as immutable history. Its public repository metadata is in `data/reference/batch-002-revision.json`; neither the PDF nor the identifying import manifest is committed. The revised master includes the original 12 two-page scans, shifted by two pages, plus one new two-page form. The previous scans were compared byte-for-byte at the embedded-image level before import. Farmer profiles show only the current archive revision, while administrators can still inspect both masters in Registration Archives.

`app/scripts/import-batch2-revision.mjs` accepts a privately reviewed manifest. It verifies the PDF checksum, prior archive checksum, page counts, complete original associations, existing Farmer ID holder, and potential duplicate identifiers. On `apply`, one owner transaction reassigns the existing `SF-F-0001` holder to the next generated Farmer ID, creates the newly supplied farmer at `SF-F-0001`, records the source and review notes, and archives the corrected master with 13 protected two-page extracts. The UUID and linked records of the existing farmer remain intact. Both Farmer ID changes are captured in the existing audit trail. The identity protection trigger is temporarily disabled only inside that locked owner transaction and is restored before commit. A complete repeated import is a no-op; any conflicting state aborts the transaction.

Run the check first, using an owner connection supplied privately, then apply only after verifying a fresh encrypted production backup and restoring it to an isolated test database:

```bash
node app/scripts/import-batch2-revision.mjs /absolute/private/path/revision-manifest.json
node app/scripts/import-batch2-revision.mjs /absolute/private/path/revision-manifest.json apply
```

The new form's nine-digit primary mobile is retained exactly as supplied and flagged for confirmation. A paper verification checkbox does not update the independent KRA verification workflow. Preserve the original signed PDF and confirm outstanding identity and contact details with the farmer.
