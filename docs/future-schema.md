# Future schema and explicit technical debt

No operational profile or transaction table is created in Phase 1.

## Farmer operational profiles (proposal)

Propose `farmer_operational_profiles`: `id uuid` PK; `farmer_id uuid` FK to farmers; `supplier_category text`; `dairy_goat_count integer`; `lactating_goat_count integer`; `estimated_daily_milk_litres numeric(12,3)`; `typical_delivery_litres numeric(12,3)`; `delivery_frequency text` or reference ID; `effective_from date`; nullable `effective_to date`; timestamps. Counts/quantities must be nonnegative, lactating count cannot exceed total count, end must follow start. Agree exclusive date bounds and prohibit overlapping effective intervals per farmer before implementation. These fields deliberately do not belong on the registration form or master table.

## Milk operations direction

Farmer → milk collection → quality test → acceptance/rejection → processing batch → bottling → outbound distribution. Pay only against accepted quantities, subject to agreed pricing and reconciliation policy. Transactions reference `farmers.id`; never join by name or copy farmer details as relational keys. A quality test should reference its collection; derive the farmer through that relationship rather than introducing contradictory farmer references. Batch membership will support combining accepted collections while preserving traceability. Supplier payments and M-Pesa reconciliation come later.

## Staff and authorization

`farmers.registered_by` and `farmer_verifications.verified_by` are required text labels for now. Later add nullable staff UUID foreign keys alongside original labels, map reviewed identities, enforce keys for new records, and retain labels as historical provenance. Do not destructively convert arbitrary text into UUIDs. There is no authentication system yet.

## Other extension points

Payment method is a constrained text discriminator, currently `mpesa`. Add a migration to relax that constraint and introduce method-specific detail tables/nullable M-Pesa fields when another method is actually required. Farmer/profile relationships and profile UUIDs remain stable. Retire old profiles (`is_active=false`) before adding replacements in one transaction. Payment-detail edits automatically clear profile verification; application-controlled re-verification and payment change auditing are required before payments go live.

National ID and KRA PIN uniqueness is enforced for non-null values. Do not weaken global KRA uniqueness for one exception: design a reviewed, documented tax-identity/party association or exception workflow when actual requirements are known. Blank identifiers should be converted to NULL by the future API; KRA PIN must be trimmed uppercase.

Add master-data before/after audit events, actor IDs, least-privilege roles, retention policy and consent-version definitions in the application phase. Current timestamps and historical records support provenance but are not a complete audit trail. Missing normalized phones are intentionally allowed. Use a reviewed phone library and region context, retain raw entries, flag ambiguous input, and only populate E.164 values after validation; do not silently rewrite user input.
