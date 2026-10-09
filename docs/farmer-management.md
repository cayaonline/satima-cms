# Farmer management — first working version

Implemented 9 October 2026 in the existing local project. The app runs at http://127.0.0.1:3000 and connects to PostgreSQL through Docker's private network using `satima_app`. PostgreSQL remains on host port 5433. Node 24.21.0 and pg 8.16.3 are pinned; npm lockfile is committed. No external fonts, analytics or data services are used.

## What is available

Password-protected directory, name/Customer ID/phone search, real/demo filters, farmer profiles, registration, master/contact/payment editing, data-cleaning notes with resolution explanations, historical consent and verification evidence, source page references, and recent change history. The directory returns up to 200 matches; search narrows larger sets. Mobile tables scroll horizontally.

The API validates text, dates and status; uses parameterized SQL; saves related fields in a transaction; rejects stale edits; maps duplicate identity conflicts to a useful message. Replacing payment details retires the existing profile and creates an unverified replacement. Changing the primary phone clears its normalized value. Existing consent/verification evidence is never overwritten by a profile edit.

## Five forms and deferred cleaning

Five real registrations were imported once from the supplied ten-page PDF. They are provisional, all `pending_verification`. Repeating the import uses the document SHA256 plus first page to skip already-imported records. An advisory transaction lock protects concurrent imports. Customer IDs use the existing sequence; IDs are not reset to reuse fictional fixture numbers. Test/rollback gaps are expected.

There are initially **25 open cleaning notes**, including **11 high-priority notes**. These are deliberately not blockers to browsing and editing. Notes cover:

- All five signed forms have three apparently unticked consent declarations. Their declaration values and overall consent remain NULL, not false or true.
- Some officer verification checklists are partially or wholly unmarked despite confirmation notes. Only visibly marked Yes answers were transcribed as true; no unmarked box was inferred as No.
- The second form's consent date appears later than registration/verification; it is provisional and flagged.
- The fourth form omits the registration year; the year from its dated consent/verification pages was used provisionally, with the original entry preserved and a note.
- Handwriting, identifier digits, names and locations require later confirmation. The second form also leaves sub-county blank.
- Separate M-Pesa names are retained as written, including shortened names.
- Paper dates have no time: evidence timestamps use midnight Africa/Nairobi for storage, not a claim about the event time.

The field list on paper has no Customer ID; CMS IDs are assigned automatically. The unversioned consent text is associated with a source-hash-based version label, not an invented approved policy version.

The original source and private JSON are in `data/private/`. Raw transcription is a provisional reading of handwriting, not OCR-certified truth. The original PDF is authoritative for later review. No signature images were extracted into the database. Staff signatures remain on the PDF; text actor names are retained.

## New database objects

Migration 007 makes consent and verification booleans nullable and adds explicit TRUE checks so unknown declarations cannot satisfy confirmed consent. Existing false values remain unchanged. It adds:

- `farmer_registration_sources`: UUID, farmer FK, document name/hash, first/last page, raw JSON transcription and import timestamp. Unique hash/first page and farmer index. App has SELECT/INSERT only.
- `farmer_data_issues`: UUID, farmer FK, field, description, review/high severity, open/resolved status, resolution note/time and timestamps. Resolution requires a note/time. Indexed by farmer/status.
- `farmer_audit_events`: identity key, farmer FK, table/action/actor, before/after JSON and timestamp. Trigger-written; app can only SELECT. Contains PII.

Migration 008 creates and grants the app role. Credentials are generated locally in `.env`, never migrations. `configure-app.py` reapplies the role grants and sets its password after migration/restore. Database owner remains capable of bypassing triggers; audit is not tamper-proof against administrators.

## Access and current boundaries

All farmer APIs require a local login; POST/PUT/PATCH require the correct Origin. Password comparisons are constant-time, sessions are random, login attempts are limited, and errors do not log personal values. Content Security Policy prevents third-party resources and framing. Both published Docker ports bind to 127.0.0.1. The app container runs non-root with read-only filesystem and dropped capabilities.

One shared local password means audit actor is Local operator, not a named authenticated staff member. Sessions live in memory and end on restart. HTTPS, staff accounts/roles, retention/deletion workflows, and an evidence-correction UI are future work. Resolving a note does not itself correct immutable consent or verification history; append reviewed evidence through a later workflow/migration. The current status field is manually managed and must not be used as automatic payment eligibility.

## Developer commands

`make start`, `make status`, `make copy-password`, `make app-test`, `make test`, `make backup`, `make down`.

Private import (no record values on stdout):

```sh
npm ci --prefix app
python3 app/scripts/local-env.py node app/scripts/import-forms.mjs data/private/initial-forms.json
```

Run only a reviewed private input file whose `document_path` exists and matches its hash. It contains personal data and is not a seed fixture.

## Validation

Database integrity suite passed. Application integration tests passed for valid creation, related updates, payment history, stale-write conflicts, duplicate identity rejection, audit attribution, restricted app role, nullable evidence, confirmed-consent constraints and note resolution. Test writes were rolled back.

HTTP checks passed for login, unauthenticated rejection, same-origin checks, session logout, directory/profile reads, stale edits and invalid input. Browser checks passed for sign-in, five real registrations, evidence panels, edit/new dialogs, cleaning view and mobile layout with zero JavaScript errors. Screenshots are private and ignored. Import replay skipped all five records.

Current schema SQL is in `database/schema/schema.sql`. Earlier database/validation documents describe the Phase 1 baseline; this document records the later changes.
