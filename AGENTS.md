# Engineering instructions

## Stack and organization

- Keep the existing architecture: Node.js ES modules in `app/`, browser assets in `app/public/`, PostgreSQL migrations in `database/migrations/`, fictional-only seeds in `database/seeds/`, and shell/Python operational scripts in their existing folders.
- PostgreSQL 18 is the supported database. Local services are defined in the root `docker-compose.yml`; Render deployment is documented separately. Do not add alternate infrastructure without a concrete need.
- Keep dependencies small. Use Node's built-in test runner and Python's standard library unless an existing dependency or specific requirement justifies more.
- Match nearby code style. Prefer small, independently reviewable changes and preserve established Make targets and UI behavior.

## Security and data

- Enforce authorization on the server and in database grants; hiding a control in the browser is not authorization. Preserve the restricted `satima_app` role and audit protections.
- Treat farmer, customer, consent, verification, contact, payment, photograph, archive and audit information as personal or sensitive. Use only synthetic data in tests, fixtures, logs and CI.
- Never commit, print, or place credentials in arguments, source, screenshots, fixtures, or logs. Keep `.env`, backups, and private source documents out of Git. Preserve existing local `.env` values and Docker volumes.
- Local development must target the Compose database on loopback. Never use production Neon credentials, production data, hosted migration scripts, or live Render settings during local development work.
- Do not connect to or modify production unless the user explicitly requests a separate production task. Never deploy as part of ordinary code changes.

## Database changes

- Never edit an applied migration. Add a new numbered migration with safe, transactional and retry-aware behavior where possible; preserve checksum validation.
- Review migration compatibility with the existing schema and database version. Back up before operational restore or migration work. Never reset or delete a database to make tests pass.
- Keep integrity tests rollback-only and use deterministic synthetic records. Do not seed live records.

## Quality and product behavior

- Run the relevant automated tests for changes and report exactly what ran. Database integrity checks require the local Compose database.
- Return actionable errors without exposing secrets or personal data. Keep application and database diagnostics readable.
- Preserve existing Admin and Operations interfaces and established business workflows. Do not silently alter access rules, forms, labels, registration semantics or customer processes.
- Update README/docs when developer commands, environment boundaries, or operational behavior change.
