-- Align distributor public IDs with the business directory order while
-- preserving store identities and making every store reference unambiguous.
ALTER TABLE distributors DISABLE TRIGGER distributors_identity;

-- Store rows use their S-series public identity for the legacy code column so
-- distributor D-series codes remain reserved for distributor records.
UPDATE distributors
SET distributor_code = store_code,
    name = upper(name),
    updated_at = now()
WHERE record_type = 'store';

UPDATE distributors
SET name = upper(name), updated_at = now()
WHERE record_type = 'distributor';

UPDATE distributors
SET name = 'NAIVAS', distributor_code = 'D9001', updated_at = now()
WHERE record_type = 'distributor' AND upper(name) IN ('NAIVAS', 'NAIVAS-HO');
UPDATE distributors
SET name = 'CHANDARANA', distributor_code = 'D9002', updated_at = now()
WHERE record_type = 'distributor' AND upper(name) IN ('CHANDARANA', 'CHANDARANA-HO');
UPDATE distributors
SET name = 'KAREN PROVISIONAL STORES', distributor_code = 'D9003', updated_at = now()
WHERE record_type = 'distributor' AND upper(name) = 'KAREN PROVISION STORES';
UPDATE distributors
SET name = 'ON THE WAY', distributor_code = 'D9004', updated_at = now()
WHERE record_type = 'distributor' AND upper(name) IN ('ON THE WAY', 'ON THE WAY-HO');
UPDATE distributors
SET name = 'CLEAN SHELF SUPERMARKET', distributor_code = 'D9005', updated_at = now()
WHERE record_type = 'distributor' AND upper(name) IN ('CLEAN SHELF', 'CLEAN SHELF SUPERMARKET');

UPDATE distributors
SET distributor_code = CASE upper(name)
  WHEN 'NAIVAS' THEN 'D0001'
  WHEN 'CHANDARANA' THEN 'D0002'
  WHEN 'KAREN PROVISIONAL STORES' THEN 'D0003'
  WHEN 'ON THE WAY' THEN 'D0004'
  WHEN 'CLEAN SHELF SUPERMARKET' THEN 'D0005'
END,
updated_at = now()
WHERE record_type = 'distributor';

UPDATE distributors store
SET parent_id = parent.id, updated_at = now()
FROM distributors parent
WHERE store.record_type = 'store'
  AND upper(store.name) = 'COVO LAVINGTON'
  AND parent.record_type = 'distributor'
  AND parent.distributor_code = 'D0005';

ALTER TABLE distributors ENABLE TRIGGER distributors_identity;
