# Production data and operations

The existing Render service, Neon PostgreSQL database and password login remain in use. No paid services are added. Source files are public; records, connection strings, encryption keys and dumps must remain outside Git.

## Directory

`GET /api/farmers` accepts `q`, `scope=registered|demo|all`, `status=pending_verification|active|inactive|suspended`, `review=all|open|clear`, exact case-insensitive `county`/`location`, `sort=created_at|customer_id|full_name|registration_date|status`, `direction=asc|desc`, `page` and `page_size` (1–500; default 50). Unknown values return 400. Free text is literal, case-insensitive substring search: `%`, `_` and backslash are not wildcard operators. Existing review searches such as `3 open` and `No open notes` are supported. All results are reachable through pages; counts are computed over the entire filtered set in the same database snapshot as the page.

The current toolbar retains its search and Show controls, with Needs review as a Show option and a Sort selector using the existing styling. Previous/Next controls appear only for multiple pages. Numeric Farmer ID sorting remains correct beyond four digits. UUID breaks sort ties. The active sort remains in place after edits. There is no 200-record truncation.

The stored search document automatically follows edits and has a PostgreSQL trigram index. Structured predicates are separate from free text. See [PostgreSQL trigram indexing](https://www.postgresql.org/docs/18/pgtrgm.html).

## Classification and verification

Migration 010 adds `record_kind=registered|demo`; all new registrations default to registered. Only the five known fixed-UUID demo fixtures are backfilled as demo. Registered-by text no longer determines classification. Existing Farmer IDs, UUIDs, registration data, contacts, payment records, consent and verification evidence remain intact. Classification and Farmer IDs cannot be changed through ordinary edits.

Active status requires national ID, KRA PIN and registration date, all seven latest verification answers confirmed, a verified active payment profile, explicit current unwithdrawn consent and no high-priority open cleaning notes. Verification captures the exact identity and payment details checked; changing those details makes old verification insufficient. Existing historical verification remains unchanged and can be reaffirmed through Edit farmer, which appends evidence. Communications consent remains optional.

Checks run at transaction end, so the existing form can save status, payment and evidence together. An active farmer's evidence cannot be weakened without also moving the farmer to a non-active status. Failed checks roll back the whole edit and return an actionable message. [PostgreSQL deferred constraint triggers](https://www.postgresql.org/docs/current/sql-createtrigger.html) enforce this even for direct database writes.

## Authentication

The administrator login requires username `admin` and the existing `CMS_PASSWORD`; its `/api/farmers` endpoints and permissions are unchanged. A separate Operations Viewer account requires username `operations` at `/operations/login` and receives its own `satima_viewer_session` cookie. Viewer sessions cannot access administrator APIs; administrator sessions do not automatically grant viewer access. Both session stores expire after eight hours, rotate on repeat login and are revoked on logout. A restart requires signing in again. Cookies are Secure on the hosted site, HttpOnly and SameSite=Strict. Same-origin checks, parameterized queries, restricted database grants, security headers, bounded login/session maps and HTTP timeouts remain enabled. The server does not trust arbitrary forwarded IP headers for rate limiting.

Set `VIEWER_USERNAME=operations` and `VIEWER_PASSWORD_HASH` together as private Render environment variables to enable viewer sign-in. Generate a random password of at least 24 characters and create its salted scrypt hash with `hashViewerPassword` from `app/security.mjs`; keep the plaintext password in an owner-controlled password manager or private file outside Git. Never set a plaintext viewer password in Render or commit either value. If the two variables are missing, `/operations/login` remains available but sign-in returns a configuration error. Updating the hash invalidates old credentials after the service restarts.

Operations Viewer APIs are under `/api/operations`. Directory and detail responses select only approved columns from PostgreSQL, exclude demo records, and omit IDs, KRA PINs, next-of-kin, M-Pesa data, signatures, raw transcriptions, audit events, verification details and cleaning notes. Viewer searches operate only on permitted fields. All viewer mutation requests return 403. The Operations Portal shows Farmers, Customers and Distributors; the latter two remain empty until actual data modules are implemented. Both roles use the same production PostgreSQL database, with no duplicate records or new migration.

Future enhancements: individual named staff accounts, per-user audit identity, finer permissions, MFA, password recovery, durable sessions and shared rate limiting. The current administrator password and single viewer account identify roles, not individual staff members. The application database role still has the grants needed for administrator edits, so viewer read-only access is enforced by server routes and projections; a separate database credential for viewer queries is a future defense-in-depth improvement.

## Encrypted Neon backups

`app/scripts/backup-hosted.mjs` streams PostgreSQL 18 custom-format dumps directly into AES-256-GCM encryption. A private random 32-byte key and unique IV are used; the archive header is authenticated. Plaintext dumps are never written by this tool. A complete decrypt/authentication check and `pg_restore --list` run before a SHA-256 sidecar is created. Files use mode 0600. TLS certificate verification is required for the owner connection.

The Mac's private `data/private/cloud/backup-config.json` identifies the owner connection, key file and backup directory. A user LaunchAgent runs `app/scripts/run-hosted-backup.mjs` every 24 hours while the Mac is available. Docker Desktop must be running. A sleeping, powered-off or offline Mac cannot provide an always-on backup guarantee. Review the private job logs and back up manually before every production migration.

Manual run:

```sh
BACKUP_CONFIG_FILE=/absolute/private/backup-config.json node app/scripts/run-hosted-backup.mjs
```

The key is separate from the encrypted archives. Keep an additional owner-controlled copy of both archives and the key on separate encrypted storage; losing the key makes archives unrecoverable. Do not email keys, place them in GitHub, or store them as frontend/Render application secrets. Current archives are retained; no automatic deletion or paid storage is introduced.

## Recovery procedure

1. Stop planned deployments and preserve the current database; do not reset, overwrite or delete production data.
2. Select a verified `.dump.enc` archive and compare its SHA-256 with its sidecar. Supply its private key through `BACKUP_KEY_FILE` and run `node app/scripts/backup-hosted.mjs verify /private/archive.dump.enc`.
3. Start a disposable local PostgreSQL 18 container named `satima-restore-test-` followed by eight lowercase hexadecimal characters. Wait for TCP readiness, then create an empty `satima_restore` database. Use a private random test password in the environment, not command arguments.
4. Run `node app/scripts/backup-hosted.mjs restore-isolated /private/archive.dump.enc CONTAINER_NAME`. It only targets a disposable local container and does not overwrite a live database.
5. Compare counts and canonical hashes of all data tables, farmer IDs, registration fields, contacts, consent, verification, payments, cleaning notes, audit history and the Farmer ID sequence. Record verification privately. An archive-list check alone is not a restore test.
6. For actual production recovery, prepare a separate empty destination database, transfer the validated restored database over verified TLS, recreate restricted app grants, and apply any later migrations. Verify every table before an owner-approved switch of Render's DATABASE_URL. Keep the original database for investigation. Production replacement is a separate explicit recovery decision.
7. After a successful test, remove only the disposable container and its test volume. Retain the encrypted source backup and private verification report.

The pre-migration production backup was restored in a disposable database and every row across all nine original tables plus the Farmer ID sequence was compared. This exercises recovery without creating test records in production.

## Deployment checks

Run `node app/scripts/test-hosted.mjs`: it creates a disposable database, verifies fresh/repeated migrations and runs all automated suites, including more than 200 registrations, sorting, filters, literal search, activation safeguards, sessions, editing, consent/payment history and role restrictions. Test fixtures never enter the hosted or existing local CMS database.

Before migrations: take and restore-test an encrypted live backup; retain a private baseline. Apply numbered checksum-verified migrations as the schema owner, with lock and statement timeouts. Then deploy reviewed GitHub main to the existing Render service. Compare preserved data to the baseline and verify HTTPS login, pagination, search, sorting, filters, profiles and logout. A code rollback does not undo database writes; migration 010 is additive and the previous frontend can still load against the upgraded schema.
