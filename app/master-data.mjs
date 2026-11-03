// Shared directory membership and totals. These never depend on a reporting period.
// `registered` is the real-record kind, not a claim that registration is complete.
export const farmerRecordCondition = "f.record_kind='registered'";
// Retain uncategorized real records so they can be assigned through either directory.
export const farmerVisibilityCondition = "(f.master_list_status='current' OR f.category IS NULL)";
export const farmerDirectoryCondition = `${farmerRecordCondition} AND ${farmerVisibilityCondition}`;

export const customerCountQuery = 'SELECT count(*)::int AS total FROM customers';
// Distributors and their stores are separate directory entities in the same table.
export const distributorCountsQuery = `SELECT
 count(*) FILTER (WHERE record_type='distributor')::int AS distributors,
 count(*) FILTER (WHERE record_type='store')::int AS stores,
 (${customerCountQuery}) AS customers FROM distributors`;
export const directoryCountsQuery = `SELECT
 (SELECT count(*)::int FROM farmers f WHERE ${farmerDirectoryCondition}) AS farmers,
 d.customers,d.distributors,d.stores FROM (${distributorCountsQuery}) d`;
