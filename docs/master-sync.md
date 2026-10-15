# Private master-directory synchronization

Export a future Farmer, Customer, or Distributor workbook as UTF-8 CSV with one header row. Keep the source and generated preview outside Git and the public web directory. Required columns are `full_name,primary_phone` for farmers; `full_name,phone_number` for customers; and `name,phone_number,record_type` for distributors. Optional existing IDs are `customer_id` for farmers and customers, or `distributor_code` for distributors. The supported editable columns are listed in `app/scripts/master-sync-core.mjs`. Use exact CMS category labels. A store needs `parent_code` matching an existing distributor.

With the owner-only `ADMIN_DATABASE_URL` set, run from the repository root:

```
node app/scripts/sync-master.mjs preview customers /private/latest.csv /private/latest-preview.json
node app/scripts/sync-master.mjs apply customers /private/latest.csv /private/latest-preview.json
```

Replace `customers` with `farmers` or `distributors` as needed. The preview file contains private source rows and proposed field-level changes; inspect it before applying. Application rechecks the source checksum and live database snapshot under a transaction lock, then writes an immutable run and row audit. Reapplying the same file does nothing. Blank source cells never clear existing values. A row with ambiguous identity, conflicting ID, repeated name/phone, missing verified phone, or an unknown store parent is recorded for review without changing the directory. Farmer additions stay **Not Registered**; no registration or evidence is inferred.

The import uses the owner connection and does not expose an upload endpoint to ordinary portal users. To resolve a review row, verify its identifiers or correct the private source, then preview the revised file. Existing reviewed reconciliation scripts remain available for the earlier source files.
