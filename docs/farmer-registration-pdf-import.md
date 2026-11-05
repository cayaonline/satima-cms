# Paper farmer registration import

`app/scripts/import-registration-forms.mjs` is the repeatable importer for reviewed two-page registration forms. The source PDF and manifest are private operator artifacts and must not be committed.

## Workflow

1. Compute the PDF SHA-256 and create a reviewed manifest containing one entry per page pair.
2. Run `node app/scripts/import-registration-forms.mjs /private/manifest.json check`.
3. Confirm the latest encrypted database backup is available and verified.
4. Run the same command with `apply` using the owner database connection.

The apply path takes a transaction/advisory lock, rejects a changed or repeated batch, matches only reviewed identifiers, inserts source provenance, archives the original PDF privately, and records open data-quality issues. It never overwrites non-null profile values with blank source fields.

## Matching rules

- Exact reviewed farmer UUID/phone matches may update only missing profile attributes.
- A name-only or conflicting-identifier match is held for review and remains unassigned in the archive.
- A new profile is inserted as `review_required` with no Farmer ID until the missing registration evidence is verified. This follows the existing database constraint that Farmer IDs are assigned only when registration is completed.
- Consent and payment details are stored only when the form contains the corresponding values; verification checkboxes left blank remain `NULL`.

The original PDF is linked through `farmer_registration_sources` and `registration_archive_batches` / `registration_archive_entries`, so administrators can open the source pages after import.
