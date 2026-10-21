# Business figures in the operational dashboards

The home, collection, processing and distribution summary APIs return two distinct sources: `business` (a source-reported monthly performance report) and the existing operational transaction totals. For a **complete imported calendar month**, the primary business-volume cards use `business.report.totals`. For a partial month, day, or month without an import, they use recorded operations. The figures are never added together. Individual records, farmer categories, quality checks and available batch inventory always remain transaction-based.

| Primary display | Historical field | Limitation |
| --- | --- | --- |
| Milk Collected | `farmers_milk_supply_liters` | No farmer or delivery attribution |
| Milk Available for Pasteurization | `available_for_pasteurization_liters` | Not an accepted quality-control total |
| Pstd + Inc + CF — Source Reported | `pstd_inc_cf_reported_total_liters` | Not confirmed finished batch output |
| Milk Out — Stores / Homes / Raw | `milk_out_stores_liters` / `milk_out_homes_liters` / `milk_out_raw_liters` | Raw is separate from reported total |
| Total Milk Out | `total_milk_out_liters` | Not individual dispatch records |
| Source-Reported Total Sales | `total_sales_source_liters` | Litres, not revenue |

Returns and carry-forward remain source-reported in the existing Returns & Inventory section. Carry-forward is a stock snapshot, never an automatic ledger movement. Accepted/rejected milk, farmer-supplied counts, average delivery, batch output and current stock require individual operational records; source aggregates do not establish them. Historical Week 1–5 labels have no verified calendar dates, so daily charts cannot be derived from them.

The latest month with either an imported report or an actual operational record becomes the initial reporting month. A selected range is stored for the browser session and shared across the three operational modules and home. The current date is always computed in Africa/Nairobi. The shared range controls use the historical source only when the selection covers an entire imported calendar month. An imported month overlapping individual transactions still uses the source-reported volume as its primary business figure and retains the operational figures separately for reconciliation.

For review, run `node app/scripts/test-hosted.mjs` from the repository root using a disposable PostgreSQL container; it supplies the database environment needed by the full Node test suite. Set `MILK_PERFORMANCE_CSV` and `MILK_PERFORMANCE_WORKBOOK` to the private source files to validate the five real months without changing Neon. No database migration is required. After review, deploy the application code through the established Render workflow; verify the September cards and all four summary APIs in both portals. No historical import or ledger posting is part of this change.
