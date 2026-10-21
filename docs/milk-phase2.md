# Phase 2 milk reporting and stock foundation

## Two independent sources

`milk_performance_weeks` stores source-reported weekly business actuals. `performanceReport()` and `monthlyView()` remain the sole historical aggregation path used by the homepage and the three operational modules. Collection displays farmer supply; processing displays milk available for pasteurization and source-reported Pstd + Inc + CF; distribution displays store/home/raw out, reported total out, source-reported sales, returns and inventory snapshots. Raw milk out is separate from reported total out. Carry-forward and in-house are latest readings, not summed flows. Blank cells stay blank. Historical figures do **not** create collections, batches, dispatches or stock.

The existing operational pages continue reading individual collection, quality, batch and distribution records for their live KPIs. The `milk-reconciliation` service reads both datasets without changing either. It calculates a difference only when all weekly values exist, their verified dates cover the complete calendar month without gaps, at least one corresponding transaction is recorded, and the business metric definition is compatible. Otherwise it reports `Incomplete` or `Not Comparable` with a reason. Source warnings remain visible. A reported monthly aggregate cannot be assigned to an individual farmer or recipient. At present, the imported weeks lack verified calendar dates, so they are deliberately not reconciled to live transactions.

## Inventory foundation

Migration `036` adds separate raw and pasteurized opening-balance records and an append-only movement ledger. The Admin distribution page accepts a documented stock proposal with a source reference, physical-count notes and an idempotency key. A named reviewer must approve it. Approval and its single positive ledger entry occur in one database transaction. An approved opening balance is limited to one per stock type. Operations may read approved ledger information but cannot propose or approve balances. Returned pasteurized milk is marked for quarantine in the ledger schema, so it cannot be counted as sellable stock by an available-balance query.

This prospective ledger does not yet mirror existing collection, batch or distribution transactions; its screen explicitly says it is not reconciled to operational stock. Existing batch-level dispatch limits remain authoritative. Do not use a ledger balance to authorize dispatch until each movement type has reviewed source rules, linked operational transactions, stock conservation checks, correction procedures and backfill evidence. Historical carry-forward numbers must never be posted automatically.

## Public store codes

Migration `035` keeps all distributor/store UUIDs and legacy D codes. It assigns existing stores `S0001…` in ascending legacy-code order and leaves parent distributor D codes unchanged. `store_code` is immutable and unique. New stores receive S codes directly; new parent distributors receive D codes. Earlier D numbers consumed by stores remain reserved, so parent D codes retain their historical gaps. API responses include the public code and still accept UUID profile routes. Search accepts both S and legacy D codes. Source-row mappings and parent relationships remain unchanged. One existing store lacked a parent in the read-only pre-migration audit; it needs manual source verification, not a guessed parent.

## Safe release sequence

1. Obtain and verify a fresh encrypted production backup, including checksum and recovery key access. Confirm a maintenance window and review the store-code mapping before changing Neon.
2. Run `node app/scripts/test-hosted.mjs` and focused unit tests on the release commit; this uses disposable PostgreSQL. Compare pre/post distributor and store counts, all UUIDs, parent links, source-row mappings and distribution FKs in staging.
3. Run the versioned hosted migration command with the private Neon schema-owner connection from the trusted workstation. Do not set owner credentials in Render. Verify `035` backfill totals/uniqueness and empty `036` ledger; abort deployment if checks differ.
4. Deploy the tested application revision through the existing manual Render workflow. Check both portal logins, monthly reports, reconciliation explanations, D/S search and profiles, distribution recipient picker and inventory access restrictions. Keep automatic production inventory postings disabled until operational rules are approved.

Production business decisions still needed: verified weekly calendar boundaries, precise equivalence of pasteurization and distribution source metrics to transactions, physical opening stock evidence, returned-product disposition, stock-adjustment approvals and transaction-level ledger posting rules.
