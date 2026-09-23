# Phase 1 validation

Executed locally on 2026-09-23 using Docker Engine/CLI 29.8.0, Compose v5.5.1, PostgreSQL 18.6 (aarch64), Git 2.53.0. Main database: satima_cms on 127.0.0.1:5433. Existing host services were not changed.

| Requirement | Result |
|---|---|
| Docker PostgreSQL starts | PASS: Compose health check healthy |
| Database exists | PASS: queried satima_cms |
| Migrations execute | PASS: six tracked migrations, transactional application |
| Tables exist | PASS: five domain tables plus schema_migrations |
| Foreign keys work | PASS: all fictional child rows reference farmer UUIDs |
| Invalid references rejected | PASS: insert rejection on all four child tables |
| Customer IDs unique | PASS: duplicate constraint; 24 concurrent sequence requests distinct |
| National ID duplicates | PASS: duplicate rejected; multiple NULL values allowed |
| KRA PIN constraints | PASS: duplicate and lowercase values rejected |
| Seed data | PASS: five complete fictional registrations; rerun kept five rows per domain table |
| Summary view | PASS: five rows, no fanout with multiple historical checks |
| Backup | PASS: custom-format pg_dump created with private permissions |
| Restore | PASS: fresh and repeated pg_restore; all table contents, view and sequence compared exactly |
| Persistence | PASS: container restart retained five registrations and six migration records |

Additional checks: invalid status rejected, one active payment/one primary alternative enforced, verified payment requires a timestamp, payment detail edits clear verification, farmer identity immutable, referenced parent deletion rejected, verification updates/deletes rejected, consent evidence immutable and withdrawal irreversible. Migration rerun skips applied files; simulated checksum mismatch fails. Shell syntax checks passed. Sample queries execute successfully.

`make test` executes SQL assertions in a rolled-back transaction. PostgreSQL sequences are not transactional, so test runs and concurrent allocation checks leave legitimate Customer ID gaps. Seed IDs remain SF-F-0001 through SF-F-0005. Fictional verification results are intentionally incomplete, not claims of verified identity.

An initial test expected SQLSTATE 23503 for a restricted parent deletion; PostgreSQL correctly returned 23001 (restrict_violation). The assertion was corrected and rerun successfully. Port 5432 failed at actual Docker binding; 5433 was checked and used.

Restore testing used a separate database, `satima_restore_validation`, in this project's container. It contains only the fictional backup and remains available for inspection. The restore flags were the same as the production script, including single-transaction and clean/if-exists. The main database was never overwritten. Reset was not executed because it intentionally destroys the volume; its interactive confirmation and shell syntax were reviewed.

Backups are local under database/backups and excluded from Git. No real PII was imported. These checks validate the local foundation, not production application authorization, complete master-data auditing, payment eligibility or legal compliance.
